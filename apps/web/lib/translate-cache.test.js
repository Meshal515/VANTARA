import { beforeEach, describe, expect, it, vi } from 'vitest';

// الكاش على الجهاز (IndexedDB) بذاكرة
const kv = new Map();
vi.mock('./chapter-store.js', () => ({
  readKv: async (key) => (kv.has(key) ? kv.get(key) : null),
  writeKv: async (key, value) => void kv.set(key, { value, at: Date.now() }),
}));

const { forgetPage, pageHashOf, translatePage } = await import('./translate.js');

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

describe('pages saved before the cache rename come back without translating again', () => {
  it('a complete page from the old cache is shown as is and moved to the current one', async () => {
    const hash = await pageHashOf('file://p');
    kv.set(`tl3:${hash}`, { value: saved(), at: 1 });
    const res = await translatePage(noTranslate, 'file://p', {});
    expect(res).toMatchObject({ image: '/files/translated-pages/abc.webp', translated: 2, from: 'device' });
    expect(kv.get(`tl4:${hash}`)?.value).toMatchObject({ translated: 2, incomplete: false });
  });

  it('an old page with a bubble left in English is asked again', async () => {
    const hash = await pageHashOf('file://p');
    kv.set(`tl3:${hash}`, { value: saved({ regions: [{ id: 'r1', status: 'pending', source: 'HI', arabic: null }] }), at: 1 });
    const res = await translatePage(noTranslate, 'file://p', {});
    expect(res.error).toBe('device_only');
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
