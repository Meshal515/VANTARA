import { beforeEach, describe, expect, it, vi } from 'vitest';

// الكاش على الجهاز (IndexedDB) بذاكرة
const kv = new Map();
vi.mock('./chapter-store.js', () => ({
  readKv: async (key) => (kv.has(key) ? kv.get(key) : null),
  writeKv: async (key, value) => void kv.set(key, { value, at: Date.now() }),
}));

const { PAGE_CACHE_TTL_MS, forgetPage, pageCacheKey, pageHashOf, translatePage } = await import('./translate.js');

const page = new Uint8Array([1, 2, 3, 4]);
beforeEach(() => {
  kv.clear();
  vi.stubGlobal('fetch', async () => new Response(page));
});

const saved = (over = {}) => ({
  image: '/files/translated-pages/abc.webp',
  translated: 2,
  engine: 'device',
  regions: [
    { id: 'r1', status: 'pending', source: 'HI', arabic: 'مرحبًا' },
    { id: 'r2', status: 'skipped:sfx', source: '', arabic: null },
  ],
  ...over,
});
// بلا جهاز ولا خادم: أي محاولة ترجمة ترجع device_only، فنعرف أنها حاولت
const noTranslate = {};

it('retains visible v3 output while retrying the corrected chapter context in background', async () => {
  const hash = await pageHashOf('file://p');
  kv.set(`tl4:${hash}`, { value: saved({ engine: 'gpt-6-luna:t3' }), at: 1 });
  const res = await translatePage(noTranslate, 'file://p', {});
  expect(res.image).toBe('/files/translated-pages/abc.webp');
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(kv.get(`tl4:${hash}`)?.value.tries).toBe(1);
});

describe('pages saved before the cache rename come back without translating again', () => {
  it('a complete page from the old cache is shown as is and moved to the current one', async () => {
    const hash = await pageHashOf('file://p');
    kv.set(`tl3:${hash}`, { value: saved(), at: 1 });
    const res = await translatePage(noTranslate, 'file://p', {});
    expect(res).toMatchObject({ image: '/files/translated-pages/abc.webp', translated: 2, from: 'device' });
    expect(kv.get(`tl4:${hash}`)?.value).toMatchObject({ translated: 2, incomplete: false });
  });

  it('an old page with a bubble left in English is never shown as translated', async () => {
    const hash = await pageHashOf('file://p');
    kv.set(`tl3:${hash}`, { value: saved({ regions: [{ id: 'r1', status: 'pending', source: 'HI', arabic: null }] }), at: 1 });
    const res = await translatePage(noTranslate, 'file://p', {});
    // No device/server in this test, so the only acceptable fallback is the
    // original page path rather than the mixed cached rendering.
    expect(res.error).toBe('device_only');
    expect(res.image).toBeUndefined();
  });

  it('never exposes an incomplete cached rendering even after its retry budget is exhausted', async () => {
    const hash = await pageHashOf('file://p');
    kv.set(`tl4:${hash}`, { value: { ...saved(), incomplete: true, at: 0, tries: 3 }, at: 1 });
    const res = await translatePage(noTranslate, 'file://p', {});
    expect(res.error).toBe('device_only');
    expect(res.image).toBeUndefined();
    expect(kv.get(`tl4:${hash}`)?.value.tries).toBe(3);
  });

  it('a page whose image vanished is forgotten in both caches', async () => {
    const hash = await pageHashOf('file://p');
    kv.set(`tl3:${hash}`, { value: saved(), at: 1 });
    kv.set(`tl4:${hash}`, { value: saved(), at: 1 });
    await forgetPage(hash);
    const res = await translatePage(noTranslate, 'file://p', {});
    expect(res.error).toBe('device_only');
  });
});


it('quarantines stable-124 pipelineVersion 2 while preserving older complete cache', async () => {
  const hash = await pageHashOf('file://p');
  kv.set(`tl4:${hash}`, { value: saved({ pipelineVersion: 2 }), at: 1 });
  const bad = await translatePage(noTranslate, 'file://p', {});
  expect(bad.error).toBe('device_only');
  expect(bad.image).toBeUndefined();

  kv.set(`tl4:${hash}`, { value: saved({ pipelineVersion: 1 }), at: 1 });
  const oldButComplete = await translatePage(noTranslate, 'file://p', {});
  expect(oldButComplete).toMatchObject({ from:'device', translated:2, image:'/files/translated-pages/abc.webp' });
});

describe('smart and fast: a fast page is upgraded when you ask for smart, never the reverse', () => {
  it('smart request re-translates a page saved from a fast translation', async () => {
    const hash = await pageHashOf('file://p');
    kv.set(`tl4:${hash}`, { value: saved({ engine: 'gpt-6-luna:t3:fast' }), at: 1 });
    expect((await translatePage(noTranslate, 'file://p', {})).error).toBe('device_only');
    expect((await translatePage(noTranslate, 'file://p', { speed: 'fast' })).from).toBe('device');
  });

  it('fast request takes the smart translation already saved', async () => {
    const hash = await pageHashOf('file://p');
    kv.set(`tl4:${hash}`, { value: saved({ engine: 'gpt-6-luna:t3' }), at: 1 });
    expect((await translatePage(noTranslate, 'file://p', { speed: 'fast' })).from).toBe('device');
    expect((await translatePage(noTranslate, 'file://p', {})).from).toBe('device');
  });
});


describe('stable logical page cache', () => {
  const meta = { seriesRef: 'ext:w', sourceId: 'src-a', chapterKey: 'ext:w#n:9', pageIndex: 0 };

  it('keeps Arabic when a source re-encodes the same logical page into different bytes', async () => {
    const key = pageCacheKey(meta);
    kv.set(key, { value: saved({ at: Date.now(), sourceHash: 'old-byte-hash' }), at: Date.now() });
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([99, 88, 77, 66])));

    const res = await translatePage(noTranslate, 'file://same-page-new-bytes', meta);

    expect(res).toMatchObject({ from: 'device', translated: 2, cacheKey: key });
    expect(res.image).toContain('translated-pages');
  });

  it('does not trust a logical alias forever if the source really changed', async () => {
    const key = pageCacheKey(meta);
    kv.set(key, { value: saved({ at: Date.now() - PAGE_CACHE_TTL_MS - 1 }), at: 1 });
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([12, 34, 56, 78])));

    const res = await translatePage(noTranslate, 'file://changed-page-after-ttl', meta);

    expect(res.error).toBe('device_only');
    expect(kv.get(key)?.value).toBeNull();
  });

  it('different sources never share a logical alias for the same chapter/page', () => {
    expect(pageCacheKey(meta)).not.toBe(pageCacheKey({ ...meta, sourceId: 'src-b' }));
  });
});
