/**
 * سلسلة المانجا من التنزيل حتى القارئ: كل اختبار هنا يمسك عطلًا حقيقيًا رُصد (تقرير MANGA_DOWNLOADS_AUDIT).
 */
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { createDownloadManager } from './manager.js';
import { classifyEngineError, createMangaDriver, imageIntegrity, pageListSignature } from './manga-driver.js';
import { createItem, STATES } from './model.js';
import { readyItemFor, withDownloads } from './offline-engine.js';
import { memoryStore } from './store.js';
import { warmChapter } from '../../v35/reader.js';
import { createScheduler } from '../../v35/reader-core.js';

const JPEG = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 76 }, (_, i) => (i * 5) & 0x7f), 0xff, 0xd9]).buffer;
const nativeError = (code, message = code) => Object.assign(new Error(message), { code });
const ctlOf = () => ({ signal: new AbortController().signal, progress: vi.fn(), update: vi.fn() });
const spec = (over = {}) => ({
  section: 'manga',
  work: { ref: 'ext:solo', title: 'Solo' },
  unit: { key: 'c1', number: 1 },
  source: { mode: 'smart', sourceId: 'a' },
  request: { sourceId: 'a', chapter: { url: '/a/1' } },
  ...over,
});

describe('reader image scheduling is per engine', () => {
  it('a downloaded chapter after an online one asks the local engine, not the first engine (red before)', async () => {
    const online = { pages: vi.fn(async () => [{ index: 0, imageUrl: 'https://x/1.jpg' }]), pageImage: vi.fn(async () => ({ src: 'online-src' })) };
    const local = { pages: vi.fn(async () => [{ index: 0, itemId: 'dl_1' }]), pageImage: vi.fn(async () => ({ src: 'blob:local' })) };
    warmChapter(online, { sourceId: 'a', chapter: { url: '/a/1' } }, 1);
    await vi.waitFor(() => expect(online.pageImage).toHaveBeenCalled());
    warmChapter(local, { sourceId: 'local:dl_1', chapter: { url: '/a/1' } }, 1);
    await vi.waitFor(() => expect(local.pageImage).toHaveBeenCalledTimes(1));
    // محرك الإضافات لم يُسأل عن صفحة محلية
    expect(online.pageImage.mock.calls.every(([sourceId]) => sourceId === 'a')).toBe(true);
  });

  it('forgets a fetched source whose image then failed to display, so a retry fetches again', async () => {
    let n = 0;
    const sch = createScheduler({ run: async () => `src-${++n}` });
    expect(await sch.request('k', {})).toBe('src-1');
    expect(await sch.request('k', {})).toBe('src-1');
    sch.forget('k');
    expect(await sch.request('k', {})).toBe('src-2');
  });
});

describe('downloads-aware reader engine (offline-first)', () => {
  const ready = (over = {}) => ({ ...createItem(spec()), state: 'ready', pagesTotal: 2, pages: 2, ...over });

  it('reads a ready chapter from the device wherever the work was opened, and the rest from the source', async () => {
    const store = memoryStore();
    const item = ready();
    await store.putPage(item.id, 0, { bytes: 82, type: 'image/jpeg', data: JPEG() });
    await store.putPage(item.id, 1, { bytes: 82, type: 'image/jpeg', data: JPEG() });
    const engine = { pages: vi.fn(async () => [{ index: 0 }]), pageImage: vi.fn(async () => ({ src: 'net' })) };
    const hybrid = withDownloads(engine, async () => ({ manager: { list: () => [item] }, store }));
    const pages = await hybrid.pages('a', { url: '/a/1' });
    expect(pages).toHaveLength(2);
    expect(engine.pages).not.toHaveBeenCalled();
    const img = await hybrid.pageImage('a', pages[1]);
    expect(img.local).toBe(true);
    expect(img.src).toMatch(/^blob:/);
    // فصل غير محمّل: من المصدر كما كان
    await hybrid.pages('a', { url: '/a/2' });
    expect(engine.pages).toHaveBeenCalledWith('a', { url: '/a/2' });
  });

  it('a missing stored page is fetched from the source at the same index, not left as a gap', async () => {
    const store = memoryStore();
    const item = ready();
    await store.putPage(item.id, 0, { bytes: 82, type: 'image/jpeg', data: JPEG() });
    const engine = { pages: vi.fn(async () => [{ index: 0, imageUrl: 'u0' }, { index: 1, imageUrl: 'u1' }]), pageImage: vi.fn(async (_s, p) => ({ src: `net-${p.imageUrl}` })) };
    const hybrid = withDownloads(engine, async () => ({ manager: { list: () => [item] }, store }));
    const pages = await hybrid.pages('a', { url: '/a/1' });
    expect((await hybrid.pageImage('a', pages[1])).src).toBe('net-u1');
  });

  it('matches the source a smart download actually completed from', () => {
    const item = ready({ request: { sourceId: 'a', chapter: { url: '/a/1' }, active: { sourceId: 'b', chapter: { url: '/b/1' } } } });
    expect(readyItemFor([item], 'b', { url: '/b/1' })).toBe(item);
    expect(readyItemFor([{ ...item, state: 'downloading' }], 'b', { url: '/b/1' })).toBeNull();
  });
});

describe('manga driver against real failure shapes', () => {
  const engineFor = (bySource) => ({
    pages: vi.fn(async (sourceId) => {
      const v = bySource[sourceId];
      if (v instanceof Error) throw v;
      return v.map((name, index) => ({ index, imageUrl: `https://${sourceId}/${name}` }));
    }),
    pageImage: vi.fn(async (sourceId, page) => ({ src: page.imageUrl })),
  });
  const okBytes = async () => ({ bytes: JPEG(), type: 'image/jpeg' });

  it('smart: a chapter with zero pages at the first source completes from another edition (red before)', async () => {
    const store = memoryStore();
    const eng = engineFor({ a: [], b: ['1.jpg', '2.jpg', '3.jpg'] });
    const driver = createMangaDriver({ store, engine: () => eng, fetchBytes: okBytes, wait: async () => {} });
    const item = createItem(spec({ request: { sourceId: 'a', chapter: { url: '/a/1' }, alternates: [{ sourceId: 'b', chapter: { url: '/b/1' }, sourceName: 'B' }] } }));
    const out = await driver.run(item, ctlOf());
    expect(out).toMatchObject({ pages: 3, source: { sourceId: 'b', fallbackFrom: ['a'] } });
  });

  it('manual choice is respected: no silent switch, and the reason is EMPTY not «source rejected»', async () => {
    const store = memoryStore();
    const eng = engineFor({ a: [], b: ['1.jpg'] });
    const driver = createMangaDriver({ store, engine: () => eng, fetchBytes: okBytes, wait: async () => {} });
    const item = createItem(spec({ source: { mode: 'manual', sourceId: 'a' }, request: { sourceId: 'a', chapter: { url: '/a/1' }, alternates: [{ sourceId: 'b', chapter: { url: '/b/1' } }] } }));
    await expect(driver.run(item, ctlOf())).rejects.toMatchObject({ code: 'EMPTY' });
    expect(eng.pages).toHaveBeenCalledTimes(1);
  });

  it('a truncated JPEG (connection cut mid-body) is never saved as a page', async () => {
    const full = new Uint8Array(JPEG());
    expect(imageIntegrity(full.buffer, 'image/jpeg')).toBeNull();
    expect(imageIntegrity(full.slice(0, 70).buffer, 'image/jpeg')).toBe('jpeg-truncated');
    const store = memoryStore();
    const eng = engineFor({ a: ['1.jpg'] });
    const driver = createMangaDriver({ store, engine: () => eng, fetchBytes: async () => ({ bytes: full.slice(0, 70).buffer, type: 'image/jpeg' }), wait: async () => {} });
    await expect(driver.run(createItem(spec({ source: { mode: 'manual', sourceId: 'a' } })), ctlOf())).rejects.toMatchObject({ code: 'VERIFY' });
    expect(await store.getPage(createItem(spec()).id, 0)).toBeNull();
  });

  it('a page that does not decode is rejected even when its structure looks fine', async () => {
    const store = memoryStore();
    const eng = engineFor({ a: ['1.jpg'] });
    const driver = createMangaDriver({ store, engine: () => eng, fetchBytes: okBytes, decode: async () => ({ ok: false, reason: 'bad huffman' }), wait: async () => {} });
    await expect(driver.run(createItem(spec({ source: { mode: 'manual', sourceId: 'a' } })), ctlOf())).rejects.toMatchObject({ code: 'VERIFY' });
  });

  it('a transient page failure is retried in place; the chapter does not fail for one blip', async () => {
    const store = memoryStore();
    const eng = engineFor({ a: ['1.jpg', '2.jpg', '3.jpg'] });
    let blips = 1;
    const driver = createMangaDriver({ store, engine: () => eng, wait: async () => {}, fetchBytes: async (src) => {
      if (src.endsWith('2.jpg') && blips-- > 0) throw nativeError('SITE_NETWORK');
      return okBytes();
    } });
    expect((await driver.run(createItem(spec()), ctlOf())).pages).toBe(3);
  });

  it('rate limiting drops the chapter to one request at a time', async () => {
    const store = memoryStore();
    const eng = engineFor({ a: Array.from({ length: 9 }, (_, i) => `${i}.jpg`) });
    let inFlight = 0;
    let peakAfterLimit = 0;
    let limited = false;
    const driver = createMangaDriver({ store, engine: () => eng, wait: async () => {}, fetchBytes: async (src) => {
      inFlight++;
      if (limited) peakAfterLimit = Math.max(peakAfterLimit, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      if (src.endsWith('/0.jpg') && !limited) { limited = true; throw nativeError('SITE_HTTP_429'); }
      return okBytes();
    } });
    expect((await driver.run(createItem(spec()), ctlOf())).pages).toBe(9);
    // بعد 429 لا يتجاوز الطلب الواحد إلا ما كان قد بدأ قبله
    expect(peakAfterLimit).toBeLessThanOrEqual(3);
  });

  it('resume discards pages saved from a page list that changed at the source', async () => {
    const store = memoryStore();
    let names = ['a.jpg', 'b.jpg', 'c.jpg'];
    const eng = { pages: vi.fn(async () => names.map((n, index) => ({ index, imageUrl: `https://a/${n}` }))), pageImage: vi.fn(async (_s, p) => ({ src: p.imageUrl })) };
    const fetched = [];
    let failAt = 'c.jpg';
    const driver = createMangaDriver({ store, engine: () => eng, wait: async () => {}, fetchBytes: async (src) => {
      fetched.push(src);
      if (failAt && src.endsWith(failAt)) throw nativeError('SITE_HTTP_404');
      return okBytes();
    } });
    const item = createItem(spec({ source: { mode: 'manual', sourceId: 'a' } }));
    const ctl = { ...ctlOf(), update: (c) => Object.assign(item, c) };
    await expect(driver.run(item, ctl)).rejects.toMatchObject({ code: 'SOURCE' });
    names = ['x.jpg', 'y.jpg', 'z.jpg'];
    failAt = null;
    fetched.length = 0;
    const out = await driver.run(item, ctl);
    expect(out.pages).toBe(3);
    expect(fetched).toHaveLength(3);
    expect(pageListSignature(names.map((n) => ({ imageUrl: `https://a/${n}?token=1` })))).toBe(pageListSignature(names.map((n) => ({ imageUrl: `https://cdn2/${n}?token=2` }))));
  });

  it('classifies native engine codes into honest reasons', () => {
    expect(classifyEngineError(nativeError('SITE_HTTP_404')).code).toBe('SOURCE');
    expect(classifyEngineError(nativeError('SITE_HTTP_404')).retryable).toBe(false);
    expect(classifyEngineError(nativeError('SITE_HTTP_429')).code).toBe('RATE_LIMIT');
    expect(classifyEngineError(nativeError('SITE_NOT_IMAGE')).code).toBe('RATE_LIMIT');
    expect(classifyEngineError(nativeError('SITE_TIMEOUT')).code).toBe('NETWORK');
    expect(classifyEngineError(nativeError('eu.kanade.tachiyomi.network.interceptor.CloudflareBypassException')).code).toBe('VERIFICATION');
    expect(classifyEngineError(nativeError('UNSUPPORTED_CAPABILITY')).code).toBe('UNSUPPORTED');
    expect(classifyEngineError(nativeError('EXTENSION_PARSE')).code).toBe('EXTENSION');
    expect(classifyEngineError(new Error('anything'), { online: false }).code).toBe('NETWORK');
  });
});

describe('manager while the network is gone', () => {
  it('waits for the network without burning retries, then resumes by itself (red before)', async () => {
    let up = true;
    const listeners = new Set();
    const network = { online: () => up, metered: () => false, onChange: (fn) => (listeners.add(fn), () => listeners.delete(fn)) };
    const runs = [];
    const driver = {
      run: vi.fn((item, ctl) => new Promise((resolve, reject) => runs.push({ resolve, reject, ctl }))),
    };
    const m = createDownloadManager({ store: memoryStore(), drivers: { manga: driver, video: null }, network, settings: { parallel: 1 } });
    const { added: [item] } = await m.enqueue([spec()]);
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    up = false;
    for (let i = 0; i < 5; i++) {
      runs.at(-1).reject(Object.assign(new Error('offline'), { code: 'NETWORK', retryable: true }));
      await new Promise((r) => setTimeout(r, 0));
      expect(m.get(item.id).state).toBe(STATES.waitingNetwork);
      // بلا شبكة لا يبدأ من جديد
      expect(runs).toHaveLength(1 + i);
      if (i < 4) { up = true; listeners.forEach((fn) => fn()); await vi.waitFor(() => expect(runs).toHaveLength(2 + i)); up = false; }
    }
    expect(m.get(item.id).attempts).toBeLessThanOrEqual(1);
    up = true;
    listeners.forEach((fn) => fn());
    await vi.waitFor(() => expect(runs).toHaveLength(6));
    runs.at(-1).resolve({ pages: 1, pagesTotal: 1 });
    await vi.waitFor(() => expect(m.get(item.id).state).toBe(STATES.ready));
    m.destroy();
  });
});

describe('image integrity rules on real JPEG shapes', () => {
  const jpeg = (...parts) => new Uint8Array(parts.flat()).buffer;
  const head = [0xff, 0xd8, 0xff, 0xe0, ...Array(20).fill(1)];
  const scan = [0xff, 0xda, ...Array(40).fill(0x22), 0xff, 0x00, ...Array(20).fill(0x33)];
  it('accepts a complete JPEG with data appended after EOI (watermark, padding)', () => {
    expect(imageIntegrity(jpeg(head, scan, [0xff, 0xd9], Array(500).fill(7)), 'image/jpeg')).toBeNull();
  });
  it('rejects a JPEG cut inside its scan even if an EXIF thumbnail has its own EOI', () => {
    const thumb = [0xff, 0xda, 1, 2, 3, 0xff, 0xd9];
    expect(imageIntegrity(jpeg(head, thumb, scan), 'image/jpeg')).toBe('jpeg-truncated');
  });
});

describe('manga downloads keep the app process alive in background', () => {
  it('holds the native foreground service while a chapter downloads, and releases it after', async () => {
    const { keepAliveWhileManga } = await import('./index.js');
    const calls = [];
    const native = { keepAlive: vi.fn(async (o) => calls.push(o)) };
    let runs = [];
    const driver = { run: vi.fn((item, ctl) => new Promise((resolve) => runs.push({ resolve, ctl }))) };
    const m = createDownloadManager({ store: memoryStore(), drivers: { manga: driver, video: null }, settings: { parallel: 1 } });
    keepAliveWhileManga(m, native);
    await m.enqueue([spec()]);
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    expect(calls.at(-1)).toMatchObject({ key: 'manga', on: true });
    runs[0].resolve({ pages: 1, pagesTotal: 1 });
    await vi.waitFor(() => expect(calls.at(-1)).toEqual({ key: 'manga', on: false }));
    m.destroy();
  });
});

describe('queue management (pro-level bulk actions)', () => {
  const make = () => {
    const runs = new Map();
    // كالمحرك الحقيقي: الإجهاض (إيقاف/إلغاء) ينهي التشغيل
    const driver = { run: vi.fn((item, ctl) => new Promise((resolve, reject) => { runs.set(item.id, { resolve, reject, ctl }); ctl.signal.addEventListener('abort', () => resolve(null)); })), remove: vi.fn(async () => {}) };
    const m = createDownloadManager({ store: memoryStore(), drivers: { manga: driver, video: null }, settings: { parallel: 1 } });
    return { m, runs, driver };
  };
  const unit = (n) => spec({ unit: { key: `c${n}`, number: n } });

  it('prioritize moves chosen items to the head of the queue in their order', async () => {
    const { m } = make();
    const { added } = await m.enqueue([1, 2, 3, 4].map(unit));
    m.prioritize([added[3].id, added[2].id]);
    const order = m.list().map((i) => i.unit.number);
    expect(order.slice(0, 2)).toEqual([4, 3]);
    m.destroy();
  });

  it('retryFailed requeues every failed item with full attempts', async () => {
    const { m, runs } = make();
    const { added } = await m.enqueue([unit(1)]);
    await vi.waitFor(() => expect(runs.size).toBe(1));
    runs.get(added[0].id).reject(Object.assign(new Error('gone'), { code: 'SOURCE' }));
    await vi.waitFor(() => expect(m.get(added[0].id).state).toBe(STATES.failed));
    expect(m.retryFailed()).toBe(1);
    expect(['queued', 'resolving']).toContain(m.get(added[0].id).state);
    m.destroy();
  });

  it('cancelMany removes unfinished items and their partial data', async () => {
    const { m, driver } = make();
    const { added } = await m.enqueue([1, 2, 3].map(unit));
    expect(await m.cancelMany(added.map((i) => i.id))).toBe(3);
    expect(m.list()).toHaveLength(0);
    expect(driver.remove).toHaveBeenCalledTimes(3);
    m.destroy();
  });
});
