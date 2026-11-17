import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { createDownloadManager } from './manager.js';
import { createMangaDriver, sniffImageType } from './manga-driver.js';
import { countText, createItem, defaultUnitKey, localCinemaResume, localCinemaSeasons, localWork, mangaUnitNumber, matchesNumberList, onDeviceWorks, parseNumberList, pickUnits, queueSummary, unitLabel, ERROR_LABEL } from './model.js';
import { rankRoutes, unsupportedReason } from './smart.js';
import { memoryStore, openStore } from './store.js';
import { createRateMeter, etaSeconds, formatBytes, formatEta, formatSpeed, progressRatio } from './units.js';
import { batchVideoSource, resolveRoutes, sameRoute } from './video-driver.js';

/** JPEG كامل البنية (SOI … EOI): فحص السلامة يرفض المبتور، فالعيّنة تنتهي بـFFD9 كالملف الحقيقي. */
const JPEG = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 76 }, (_, i) => (i * 7) & 0x7f), 0xff, 0xd9]).buffer;

const mangaSpec = (n, over = {}) => ({
  section: 'manga',
  work: { ref: 'ext:solo', title: 'Solo Leveling', cover: 'https://img/cover.jpg' },
  unit: { key: `c${n}`, number: n },
  request: { sourceId: 'src1', chapter: { url: `/c/${n}` } },
  ...over,
});

const flush = async (n = 6) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

/** محرك وهمي يتحكم فيه الاختبار: كل تنزيل ينتظر حتى يُنهيه. */
function controlledDriver() {
  const runs = new Map();
  return {
    runs,
    run: vi.fn((item, ctl) => new Promise((resolve, reject) => {
      runs.set(item.id, { item, ctl, resolve, reject });
      ctl.signal.addEventListener('abort', () => resolve(null));
    })),
    remove: vi.fn(async () => {}),
  };
}

describe('units', () => {
  it('formats sizes and byte speeds, never bits', () => {
    expect(formatBytes(840 * 1024 * 1024)).toBe('840 MB');
    expect(formatBytes(1.4 * 1024 ** 3)).toBe('1.4 GB');
    expect(formatBytes(-1)).toBeNull();
    expect(formatSpeed(8.2 * 1024 * 1024)).toBe('8.2 MB/s');
    expect(formatSpeed(0)).toBeNull();
  });

  it('has no ratio for an unknown total (indeterminate bar, not a made-up percent)', () => {
    expect(progressRatio(10, null)).toBeNull();
    expect(progressRatio(50, 100)).toBe(0.5);
  });

  it('hides ETA until the rate is stable', () => {
    const m = createRateMeter();
    m.sample(0, 0);
    m.sample(1000, 1_000_000);
    expect(m.stable()).toBe(false);
    m.sample(2000, 2_000_000);
    m.sample(3000, 3_000_000);
    m.sample(4000, 4_000_000);
    expect(m.stable()).toBe(true);
    expect(Math.round(m.rate())).toBe(1_000_000);
    expect(etaSeconds({ done: 4e6, total: 64e6, rate: m.rate(), stable: m.stable() })).toBeCloseTo(60, 0);
    expect(formatEta(60)).toBe('نحو دقيقة');
    // سرعة غير مستقرة ⇒ لا وقت متبقٍ، لا «أقل من دقيقة» عند 2% (خلل ظهر في لقطة المحاكي الحقيقية)
    expect(formatEta(etaSeconds({ done: 9.8e6, total: 452e6, rate: 725000, stable: false }))).toBeNull();
    expect(formatEta(undefined)).toBeNull();
    expect(formatEta(etaSeconds({ done: 9.8e6, total: 452e6, rate: 725000, stable: true }))).toBe('نحو 10 دقائق');
    const jumpy = createRateMeter();
    [0, 100, 5_000_000, 5_000_100, 12_000_000].forEach((b, i) => jumpy.sample(i * 1000, b));
    expect(jumpy.stable()).toBe(false);
  });
});

describe('model', () => {
  it('labels units by their original numbers', () => {
    expect(unitLabel(createItem(mangaSpec(7)))).toBe('الفصل 7');
    expect(unitLabel(createItem({ section: 'cinema', work: { ref: 'cinema:tt1', title: 'Dark' }, unit: { key: 's2e3', number: 3, season: 2 } }))).toBe('م2 · الحلقة 3');
    expect(unitLabel(createItem({ section: 'cinema', kind: 'movie', work: { ref: 'cinema:tt2', title: 'Dune' } }))).toBe('Dune');
  });

  it('groups on-device items per work and ignores failed or pending ones', () => {
    const items = [1, 2, 3, 4, 5, 6].map((n) => ({ ...createItem(mangaSpec(n)), state: 'ready', bytes: 10, finishedAt: n }));
    items.push({ ...createItem(mangaSpec(7)), state: 'failed' });
    items.push({ ...createItem({ section: 'anime', work: { ref: 'anime:1', title: 'Ao no Hako' }, unit: { key: 'e1', number: 1 } }), state: 'ready', finishedAt: 99 });
    const works = onDeviceWorks(items);
    expect(works.map((w) => [w.ref, w.count])).toEqual([['anime:1', 1], ['ext:solo', 6]]);
    expect(countText('manga', 6)).toBe('6 فصول');
    expect(onDeviceWorks(items, { section: 'anime' })).toHaveLength(1);
  });

  it('shows only the downloaded chapters of a 150-chapter work, keeping 1, 4, 7 as 1, 4, 7', () => {
    const items = [7, 1, 4].map((n) => ({ ...createItem(mangaSpec(n)), state: 'ready' }));
    const view = localWork(items, 'ext:solo');
    expect(view.ready.map((i) => i.unit.number)).toEqual([1, 4, 7]);
    expect(view.seasons).toEqual([]);
  });

  it('splits series by the seasons that actually have downloads', () => {
    const ep = (s, n) => ({ ...createItem({ section: 'cinema', work: { ref: 'cinema:tt9', title: 'X' }, unit: { key: `s${s}e${n}`, number: n, season: s } }), state: 'ready' });
    const view = localWork([ep(3, 2), ep(1, 5), ep(1, 1)], 'cinema:tt9');
    expect(view.seasons.map((s) => [s.season, s.items.map((i) => i.unit.number)])).toEqual([[1, [1, 5]], [3, [2]]]);
  });

  it('parses ranges and lists, including Arabic digits', () => {
    const r = parseNumberList('١-٣، 7');
    expect([1, 2, 3, 7].every((n) => matchesNumberList(r, n))).toBe(true);
    expect(matchesNumberList(r, 5)).toBe(false);
    expect(parseNumberList('abc')).toBeNull();
    const units = [1, 2, 3, 4].map((n) => ({ key: `e${n}`, number: n, season: 1 }));
    expect(pickUnits(units, { type: 'range', from: 3, to: 2 }).map((u) => u.number)).toEqual([2, 3]);
  });

  it('summarises the queue with total speed of active rows only', () => {
    const s = queueSummary([{ state: 'downloading', speed: 5 }, { state: 'downloading', speed: 3 }, { state: 'queued' }, { state: 'paused', speed: 9 }]);
    expect(s).toMatchObject({ active: 2, waiting: 1, paused: 1, speed: 8 });
  });
});

describe('smart selection', () => {
  const route = (over) => ({ id: over.id, sourceId: 'a', server: 's', state: 'READY', probed: true, probeMs: 500, quality: 1080, ...over });
  it('prefers complete probed 1080p over unprobed or failing routes, and skips torrents where unsupported', () => {
    const ranked = rankRoutes([
      route({ id: 'sd', quality: 480 }),
      route({ id: 'hd', quality: 1080 }),
      route({ id: 'bad', probed: false }),
      route({ id: 'wait', state: 'RESOLVING' }),
      route({ id: 'tor', type: 'torrent', quality: 2160 }),
    ], { platform: { torrent: false } });
    expect(ranked.map((r) => r.id)).toEqual(['hd', 'sd']);
  });

  it('refuses DRM and DASH honestly', () => {
    expect(unsupportedReason({ container: 'MP4' })).toBeNull();
    expect(unsupportedReason({ container: 'HLS', drm: true })).toBe('DRM');
    expect(unsupportedReason({ container: 'DASH' })).toBe('UNSUPPORTED');
  });

  it('matches the same server by identity, never another source', () => {
    expect(sameRoute({ sourceId: 'a', server: 'swh', code: 'SWH' }, { sourceId: 'a', server: 'swh' })).toBe(true);
    expect(sameRoute({ sourceId: 'torrentio', server: 'swh' }, { sourceId: 'a', server: 'swh' })).toBe(false);
  });

  it('a chosen torrent is that release, not another of the same addon with the same code or quality', () => {
    const chosen = { sourceId: 'addon|torrentio', server: 'Torrentio', fingerprint: 'btih:bbbb:0', quality: 1080 };
    // الرمز يُعطى بترتيب الوصول في كل جلسة: TRR في الجلسة الثانية قد يكون إصدارًا آخر
    expect(sameRoute({ sourceId: 'addon|torrentio', server: 'Torrentio', code: 'TRR', quality: 1080, fingerprint: 'btih:aaaa:0' }, chosen)).toBe(false);
    expect(sameRoute({ sourceId: 'addon|torrentio', server: 'Torrentio', code: 'TRR7', quality: 1080, fingerprint: 'btih:bbbb:0' }, chosen)).toBe(true);
  });

  it('DL20: a season pack chosen on episode 1 is still that server for episode 2 (same infoHash, another file)', () => {
    const hash = 'c'.repeat(40);
    const chosen = { sourceId: 'addon|torrentio', server: 'Torrentio', fingerprint: `btih:${hash}:0`, mode: 'manual' };
    // الحلقة الثانية من الحزمة نفسها: رقم ملف آخر، والسيرفر هو نفسه
    expect(sameRoute({ sourceId: 'addon|torrentio', server: 'Torrentio', fingerprint: `btih:${hash}:1` }, chosen)).toBe(true);
    expect(sameRoute({ sourceId: 'addon|torrentio', server: 'Torrentio', fingerprint: `btih:${hash}:` }, chosen)).toBe(true);
    // تورنت آخر ليس هو مهما تشابه
    expect(sameRoute({ sourceId: 'addon|torrentio', server: 'Torrentio', fingerprint: `btih:${'d'.repeat(40)}:1` }, chosen)).toBe(false);
    // السيرفرات المباشرة كما هي: بصمة كاملة
    expect(sameRoute({ sourceId: 'a', fingerprint: 'route:x:1' }, { sourceId: 'a', fingerprint: 'route:x:2' })).toBe(false);
  });

  it('smart ranks a torrent swarm by its seeders and size, not by the order the addon listed it', () => {
    const t = (id, label) => ({ id, sourceId: 'addon|torrentio', sourceName: 'Torrentio', server: 'Torrentio', type: 'torrent', state: 'READY', quality: 1080, label });
    const ranked = rankRoutes([
      t('weak', 'Fight.Club.1999.1080p.BluRay\n👤 2 💾 1.1 GB ⚙️ TPB'),
      t('cam', 'Fight.Club.1999.1080p.HDCAM\n👤 900 💾 1.0 GB ⚙️ TPB'),
      t('dead', 'Fight.Club.1999.1080p.WEB\n👤 0 💾 900 MB ⚙️ TPB'),
      t('huge', 'Fight.Club.1999.1080p.REMUX\n👤 300 💾 38 GB ⚙️ TPB'),
      t('good', 'Fight.Club.1999.1080p.BluRay.x265\n👤 289 💾 2.1 GB ⚙️ TPB'),
    ], { platform: { torrent: true } });
    expect(ranked[0].id).toBe('good');
    expect(ranked.map((r) => r.id)).not.toContain('dead');
    expect(ranked.findIndex((r) => r.id === 'cam')).toBeGreaterThan(ranked.findIndex((r) => r.id === 'weak'));
    expect(ranked.findIndex((r) => r.id === 'huge')).toBeGreaterThan(ranked.findIndex((r) => r.id === 'good'));
  });

  it('a failed inspection is a refusal, not a green light', () => {
    expect(unsupportedReason({ container: 'UNKNOWN', error: 'SOURCE', reason: 'HTTP 404' })).toBe('SOURCE');
    expect(unsupportedReason({ container: 'UNKNOWN', error: 'EXPIRED' })).toBe('SOURCE');
  });
});

describe('download manager', () => {
  const make = (over = {}) => {
    const store = over.store ?? memoryStore();
    const manga = over.manga ?? controlledDriver();
    const m = createDownloadManager({ store, drivers: { manga, video: over.video ?? null }, settings: { parallel: over.parallel ?? 2 }, timers: over.timers, network: over.network });
    return { m, store, manga };
  };

  it('runs at most N items at once and starts the next when a slot frees', async () => {
    const { m, manga } = make({ parallel: 2 });
    await m.enqueue([1, 2, 3, 4].map((n) => mangaSpec(n)));
    await flush();
    expect(manga.run).toHaveBeenCalledTimes(2);
    const [first] = [...manga.runs.values()];
    first.resolve({ bytes: 5, storage: { bytes: 5 } });
    await flush();
    expect(manga.run).toHaveBeenCalledTimes(3);
    expect(m.get(first.item.id).state).toBe('ready');
  });

  it('never duplicates the same chapter', async () => {
    const { m } = make();
    await m.enqueue([mangaSpec(1)]);
    const out = await m.enqueue([mangaSpec(1), mangaSpec(1)]);
    expect(out.added).toHaveLength(0);
    expect(m.list()).toHaveLength(1);
  });

  it('pause keeps the partial data, resume continues, cancel removes partial data', async () => {
    const { m, manga } = make({ parallel: 1 });
    const { added: [item] } = await m.enqueue([mangaSpec(1)]);
    await flush();
    m.pause(item.id);
    await flush();
    expect(m.get(item.id).state).toBe('paused');
    expect(manga.remove).not.toHaveBeenCalled();
    m.resume(item.id);
    await flush();
    expect(manga.run).toHaveBeenCalledTimes(2);
    await m.cancel(item.id);
    expect(manga.remove).toHaveBeenCalledTimes(1);
    expect(m.get(item.id)).toBeNull();
  });

  it('changing parallelism mid-flight neither kills nor duplicates running items', async () => {
    const { m, manga } = make({ parallel: 1 });
    await m.enqueue([1, 2, 3].map((n) => mangaSpec(n)));
    await flush();
    m.setParallel(3);
    await flush();
    expect(manga.run).toHaveBeenCalledTimes(3);
    m.setParallel(1);
    await flush();
    expect([...manga.runs.values()].every((r) => !r.ctl.signal.aborted)).toBe(true);
  });

  it('retries a network drop on the same item, then fails with a reason', async () => {
    const timers = { setTimeout: (fn) => { queueMicrotask(fn); return 1; }, clearTimeout: () => {} };
    const failing = { run: vi.fn(async () => { const e = new Error('offline'); e.code = 'NETWORK'; e.retryable = true; throw e; }), remove: vi.fn() };
    const { m } = make({ manga: failing, timers, parallel: 1 });
    const { added: [item] } = await m.enqueue([mangaSpec(1)]);
    await flush(30);
    expect(failing.run).toHaveBeenCalledTimes(4);
    expect(m.get(item.id)).toMatchObject({ state: 'failed', error: { code: 'NETWORK' } });
  });

  it('a page that always fails ends in failure even though saved pages report progress on every retry', async () => {
    const timers = { setTimeout: (fn) => { queueMicrotask(fn); return 1; }, clearTimeout: () => {} };
    // كل محاولة تستأنف من الصفحتين المحفوظتين (تقدّم بنفس البايتات) ثم تسقط في الصفحة الثالثة
    const stuck = { run: vi.fn(async (_item, ctl) => { ctl.progress({ bytes: 200, pagesDone: 2, pagesTotal: 4 }); const e = new Error('reset'); e.code = 'NETWORK'; e.retryable = true; throw e; }), remove: vi.fn() };
    const { m } = make({ manga: stuck, timers, parallel: 1 });
    const { added: [item] } = await m.enqueue([mangaSpec(1)]);
    await flush(60);
    expect(stuck.run).toHaveBeenCalledTimes(4);
    expect(m.get(item.id)).toMatchObject({ state: 'failed', error: { code: 'NETWORK' } });
  });

  it('real progress past the last drop earns the retries back', async () => {
    const timers = { setTimeout: (fn) => { queueMicrotask(fn); return 1; }, clearTimeout: () => {} };
    let bytes = 0;
    const flaky = { run: vi.fn(async (_item, ctl) => { bytes += 100; ctl.progress({ bytes }); if (bytes < 600) { const e = new Error('reset'); e.code = 'NETWORK'; e.retryable = true; throw e; } return { bytes, storage: { bytes } }; }), remove: vi.fn() };
    const { m } = make({ manga: flaky, timers, parallel: 1 });
    const { added: [item] } = await m.enqueue([mangaSpec(1)]);
    await flush(80);
    expect(flaky.run).toHaveBeenCalledTimes(6);
    expect(m.get(item.id).state).toBe('ready');
  });

  it('an item handed to the device queue frees its slot for the next one, and keeps being followed', async () => {
    const gates = [];
    const handing = { run: vi.fn((item, ctl) => new Promise((resolve) => { ctl.handoff(); ctl.update({ state: 'scheduled' }); gates.push(() => resolve({ bytes: 1, storage: { bytes: 1 } })); })), remove: vi.fn() };
    const { m } = make({ manga: handing, parallel: 1 });
    await m.enqueue([1, 2, 3].map((n) => mangaSpec(n)));
    await flush(10);
    // التوازي 1 في الواجهة، والثلاثة سُلِّمت للجهاز (هو يطبّق التوازي)
    expect(handing.run).toHaveBeenCalledTimes(3);
    expect(m.list().map((i) => i.state)).toEqual(['scheduled', 'scheduled', 'scheduled']);
    expect(m.summary()).toMatchObject({ active: 0, waiting: 3 });
    gates.forEach((open) => open());
    await flush(10);
    expect(m.list().map((i) => i.state)).toEqual(['ready', 'ready', 'ready']);
  });

  it('an item that was with the device when the app closed returns to the engine on restart', async () => {
    const store = memoryStore();
    const first = make({ store, manga: { run: vi.fn((item, ctl) => new Promise(() => { ctl.handoff(); ctl.update({ state: 'scheduled' }); })), remove: vi.fn() } });
    const { added: [item] } = await first.m.enqueue([mangaSpec(1)]);
    await flush(10);
    expect(first.m.get(item.id).state).toBe('scheduled');
    const again = { run: vi.fn(async () => ({ bytes: 1, storage: { bytes: 1 } })), remove: vi.fn() };
    const second = make({ store, manga: again });
    await second.m.ready;
    await flush(10);
    expect(again.run).toHaveBeenCalledTimes(1);
    expect(second.m.get(item.id).state).toBe('ready');
  });

  it('waits for Wi-Fi when asked, and says so', async () => {
    let metered = true;
    let onChange = () => {};
    const network = { online: () => true, metered: () => metered, onChange: (fn) => { onChange = fn; return () => {}; } };
    const manga = controlledDriver();
    const m = createDownloadManager({ store: memoryStore(), drivers: { manga }, settings: { parallel: 2, wifiOnly: true }, network });
    const { added: [item] } = await m.enqueue([mangaSpec(1)]);
    await flush();
    expect(m.get(item.id).state).toBe('waiting_wifi');
    metered = false;
    onChange();
    await flush();
    expect(manga.run).toHaveBeenCalledTimes(1);
  });

  it('restores after an app restart: active items resume from where they were', async () => {
    const store = memoryStore();
    const first = make({ store, parallel: 1 });
    await first.m.enqueue([mangaSpec(1), mangaSpec(2)]);
    await flush();
    first.m.destroy();
    await flush();
    const saved = await store.allItems();
    // محاكاة إغلاق مفاجئ: العنصر الأول كان «جارٍ التحميل» على القرص
    await store.putItem({ ...saved.find((i) => i.unit.number === 1), state: 'downloading', bytes: 500 });
    const second = make({ store, parallel: 1 });
    await second.m.ready;
    await flush();
    expect(second.manga.run).toHaveBeenCalledTimes(1);
    expect(second.manga.run.mock.calls[0][0]).toMatchObject({ unit: { number: 1 }, bytes: 500 });
  });

  it('deleting the last item of a work removes the work from on-device', async () => {
    const { m, manga } = make({ parallel: 2 });
    const { added } = await m.enqueue([mangaSpec(1), mangaSpec(2)]);
    await flush();
    for (const r of manga.runs.values()) r.resolve({ bytes: 3, storage: { bytes: 3 } });
    await flush();
    expect(onDeviceWorks(m.list())[0].count).toBe(2);
    await m.remove(added[0].id);
    expect(onDeviceWorks(m.list())[0].count).toBe(1);
    expect(await m.remove(added[1].id)).toBe(3);
    expect(onDeviceWorks(m.list())).toEqual([]);
  });
});

describe('manga driver', () => {
  const engine = (pages, { fail = new Set() } = {}) => ({
    pages: vi.fn(async () => pages.map((p) => ({ index: p }))),
    pageImage: vi.fn(async (_s, page) => ({ src: `page-${page.index}` })),
    fail,
  });
  const fetchBytes = (eng, calls) => async (src) => {
    calls.push(src);
    const n = Number(src.split('-')[1]);
    if (eng.fail.has(n)) throw new TypeError('Failed to fetch');
    return { bytes: JPEG(), type: 'image/jpeg' };
  };

  it('downloads every page in order, verifies, and reports pages and bytes', async () => {
    const store = memoryStore();
    const eng = engine([0, 1, 2, 3, 4]);
    const calls = [];
    const driver = createMangaDriver({ store, engine: () => eng, fetchBytes: fetchBytes(eng, calls), wait: async () => {} });
    const item = createItem(mangaSpec(1));
    const ctl = { signal: new AbortController().signal, progress: vi.fn(), update: vi.fn() };
    const out = await driver.run(item, ctl);
    expect(out).toMatchObject({ pages: 5, pagesTotal: 5, storage: { verified: true } });
    for (let i = 0; i < 5; i++) expect((await store.getPage(item.id, i)).type).toBe('image/jpeg');
    expect(calls).toHaveLength(5);
  });

  it('resumes without re-downloading saved pages, and fails rather than leaving a gap', async () => {
    const store = memoryStore();
    const eng = engine([0, 1, 2, 3], { fail: new Set([2]) });
    const calls = [];
    const driver = createMangaDriver({ store, engine: () => eng, fetchBytes: fetchBytes(eng, calls), wait: async () => {} });
    const item = createItem(mangaSpec(1));
    const ctl = { signal: new AbortController().signal, progress: vi.fn(), update: vi.fn() };
    await expect(driver.run(item, ctl)).rejects.toMatchObject({ code: 'NETWORK' });
    eng.fail.clear();
    calls.length = 0;
    const out = await driver.run(item, ctl);
    expect(out.pages).toBe(4);
    // الصفحتان 0 و1 محفوظتان من المحاولة الأولى: لا تُطلبان ثانية
    expect(calls).toContain('page-2');
    expect(calls.some((c) => c === 'page-0' || c === 'page-1')).toBe(false);
  });

  it('rejects a page that is not an image (an HTML error page is not a chapter)', async () => {
    const store = memoryStore();
    const eng = engine([0]);
    const driver = createMangaDriver({ store, engine: () => eng, wait: async () => {}, fetchBytes: async () => ({ bytes: new TextEncoder().encode('<html>').buffer, type: 'text/html' }) });
    await expect(driver.run(createItem(mangaSpec(1)), { signal: new AbortController().signal, progress() {}, update() {} })).rejects.toMatchObject({ code: 'VERIFY' });
    expect(sniffImageType(JPEG())).toBe('image/jpeg');
  });
});

describe('indexeddb store', () => {
  it('persists items and pages across reopen, and deletes only what is asked', async () => {
    const a = await openStore({ name: 'dl-test-1' });
    const item = createItem(mangaSpec(1));
    await a.putItem(item);
    await a.putPage(item.id, 0, { bytes: 12, type: 'image/jpeg', data: JPEG() });
    await a.putPage(item.id, 1, { bytes: 12, type: 'image/jpeg', data: JPEG() });
    const b = await openStore({ name: 'dl-test-1' });
    expect((await b.allItems()).map((i) => i.id)).toEqual([item.id]);
    expect(await b.pageBytes(item.id)).toBe(24);
    await b.deletePages(item.id);
    expect(await b.hasPage(item.id, 0)).toBe(false);
    expect((await b.allItems())).toHaveLength(1);
  });
});

describe('video route resolution', () => {
  it('waits for the manually chosen server only, and stops early', async () => {
    const listeners = {};
    const engine = {
      prepare: vi.fn(async () => ({ session: 's1', routes: [{ id: 'r1', sourceId: 'a', server: 'x', state: 'RESOLVING' }], done: false })),
      routes: vi.fn(async () => ({ routes: [{ id: 'r1', sourceId: 'a', server: 'x', state: 'READY', probed: true }], done: false })),
      upsertRoute: (list, r) => [...list.filter((x) => x.id !== r.id), r],
      on: (name, fn) => { listeners[name] = fn; return () => {}; },
    };
    const out = await resolveRoutes(engine, { copies: [], episode: 1 }, { wanted: (r) => sameRoute(r, { sourceId: 'a', server: 'x' }), settleMs: 5000 });
    expect(out.routes.find((r) => r.id === 'r1').state).toBe('READY');
  });

  it('reports each ready server as it arrives, before the slowest source settles', async () => {
    let calls = 0;
    const engine = {
      prepare: vi.fn(async () => ({ session: 's1', routes: [{ id: 'fast', state: 'READY' }, { id: 'slow', state: 'RESOLVING' }], done: false })),
      routes: vi.fn(async () => ({ routes: ++calls < 2 ? [] : [{ id: 'slow', state: 'READY' }], done: calls >= 2 })),
      upsertRoute: (list, r) => [...list.filter((x) => x.id !== r.id), r],
      on: () => () => {},
    };
    const seen = [];
    await resolveRoutes(engine, { copies: [], episode: 1 }, { settleMs: 10_000, onRoutes: (routes) => seen.push(routes.filter((r) => r.state === 'READY').map((r) => r.id).sort().join(',')) });
    expect(seen[0]).toBe('fast');
    expect(seen.at(-1)).toBe('fast,slow');
  });
});

describe('on-device chapters', () => {
  it('MG5: an English chapter opened from the device keeps its language, so the reader can translate it', async () => {
    const { localRows } = await import('./local-reader.js');
    const items = [
      { id: 'dl_en', unit: { key: 'n:5', number: 5 }, request: { sourceId: 'mangadex@en', chapter: { url: '/c/5' } } },
      { id: 'dl_ar', unit: { key: 'n:4', number: 4 }, request: { sourceId: 'teamx', chapter: { url: '/c/4' } } },
    ];
    const rows = localRows(items, { isFiller: (id) => String(id).includes('@') });
    expect(rows.find((r) => r.number === 5).lang).toBe('en');
    expect(rows.find((r) => r.number === 4).lang).toBe('ar');
  });

  it('are listed newest first like source chapters, whatever the download order', async () => {
    const { localRows } = await import('./local-reader.js');
    const { startChapter } = await import('../../v35/reading.js');
    const item = (n) => ({ id: `dl_${n}x`, unit: { key: `n:${n}`, number: n }, request: { chapter: { url: `/c/${n}` } } });
    const rows = localRows([1, 2, 3, 5, 6, 4, 7].map(item));
    expect(rows.map((r) => r.number)).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect(startChapter(rows, () => false).number).toBe(1);
  });
});

describe('video driver and the device queue (Android)', () => {
  const itemOf = () => ({ id: 'dl_x1', kind: 'episode', section: 'anime', work: { title: 'W' }, unit: { number: 1 }, source: { sourceId: 'a', locked: true }, request: { copies: [], episode: 1 } });
  const ctlOf = () => ({ signal: new AbortController().signal, update: vi.fn(), progress: vi.fn(), handoff: vi.fn(), settings: () => ({ parallel: 2, wifiOnly: false }) });
  it('a job the device finished while the app was closed is taken as ready, with no server resolved again', async () => {
    const { createVideoDriver } = await import('./video-driver.js');
    const engine = { prepare: vi.fn() };
    const native = { status: vi.fn(async () => ({ exists: true, state: 'ready', bytes: 9, path: '/x/video.mkv', verified: true })) };
    const driver = createVideoDriver({ engine: () => engine, native: () => native, platform: () => ({ platform: 'android', torrent: true }) });
    const out = await driver.run(itemOf(), ctlOf());
    expect(out).toMatchObject({ bytes: 9, storage: { path: '/x/video.mkv', verified: true } });
    expect(engine.prepare).not.toHaveBeenCalled();
  });
  it('a job still waiting in the device queue is followed, not started twice', async () => {
    const { createVideoDriver } = await import('./video-driver.js');
    let emit;
    const engine = { prepare: vi.fn() };
    const native = {
      status: vi.fn(async () => ({ exists: true, state: 'queued', queued: true })),
      start: vi.fn(),
      addListener: vi.fn(async (_n, fn) => { emit = fn; return { remove() {} }; }),
    };
    const driver = createVideoDriver({ engine: () => engine, native: () => native, platform: () => ({ platform: 'android', torrent: true }) });
    const ctl = ctlOf();
    const run = driver.run(itemOf(), ctl);
    await vi.waitFor(() => expect(emit).toBeTypeOf('function'));
    expect(ctl.handoff).toHaveBeenCalled();
    expect(ctl.update).toHaveBeenCalledWith({ state: 'scheduled' });
    emit({ id: 'dl_x1', state: 'ready', bytes: 5, path: '/y' });
    await expect(run).resolves.toMatchObject({ bytes: 5 });
    expect(native.start).not.toHaveBeenCalled();
    expect(engine.prepare).not.toHaveBeenCalled();
  });
});

describe('video driver: the server the user chose is the one downloaded', () => {
  const torrent = (id, fp, label) => ({ id, sourceId: 'addon|torrentio', sourceName: 'Torrentio', server: 'Torrentio', code: 'TRR', type: 'torrent', state: 'READY', quality: 1080, fingerprint: fp, label });
  const engineWith = (routes) => ({
    prepare: vi.fn(async ({ session }) => ({ session, routes, done: true })),
    routes: vi.fn(async () => ({ routes, done: true })),
    upsertRoute: (list, r) => [...list.filter((x) => x.id !== r.id), r],
    on: () => () => {},
    pick: vi.fn(async (_s, routeId) => `cand-${routeId}`),
    closeSession: vi.fn(async () => {}),
  });
  const ctlOf = () => ({ signal: new AbortController().signal, update: vi.fn(), progress: vi.fn(), handoff: vi.fn(), settings: () => ({ parallel: 2, wifiOnly: false }) });
  /** جهاز وهمي: حالة كل عمل محفوظة كما في JobStore، فما يسبق الاشتراك يُقرأ بـstatus كالجهاز الحقيقي. */
  const fakeDevice = (outcomeOf, inspectInfo = { container: 'TORRENT', transport: 'torrent', resumable: true }) => {
    const jobs = new Map();
    let emit;
    return {
      status: vi.fn(async ({ id }) => jobs.get(id) ?? { exists: false }),
      inspect: vi.fn(async () => inspectInfo),
      start: vi.fn(async (args) => {
        const end = { id: args.id, ...outcomeOf(args) };
        jobs.set(args.id, { exists: true, ...end });
        queueMicrotask(() => emit?.(end));
      }),
      addListener: vi.fn(async (_n, fn) => { emit = fn; return { remove() {} }; }),
    };
  };
  const nativeReady = () => fakeDevice(() => ({ state: 'ready', bytes: 7, path: '/v.mkv' }));

  it('resolves separate episode hashes in a manually selected source and keeps the anchor exact', async () => {
    const a = torrent('ep-9', `btih:${'a'.repeat(40)}:0`, 'release 1');
    const b = torrent('ep-10', `btih:${'b'.repeat(40)}:0`, 'release 2');
    const other = { ...b, id: 'other', sourceId: 'addon|different', quality: 2160 };
    const engine = engineWith([]);
    engine.prepare.mockImplementation(async ({ session, episode }) => ({
      session, done: true, routes: episode === 9 ? [a] : [b, other],
    }));
    const device = nativeReady();
    const { createVideoDriver } = await import('./video-driver.js');
    const driver = createVideoDriver({ engine: () => engine, native: () => device, platform: () => ({ torrent: true }) });
    for (const episode of [9, 10]) {
      const unitKey = `s2e${episode}`;
      const source = batchVideoSource(a, { unitKey, anchorKey: 's2e9', sourceName: 'Torrentio' });
      await driver.run({ id: `dl_${episode}`, request: { episode }, source, unit: { key: unitKey, number: episode }, work: { title: 'fixture' } }, ctlOf());
    }
    expect(device.start.mock.calls.map(([x]) => [x.candidate, x.episode])).toEqual([['cand-ep-9', 9], ['cand-ep-10', 10]]);
    expect(sameRoute({ ...a, fingerprint: `btih:${'a'.repeat(40)}:1` }, { sourceId: a.sourceId, fingerprint: a.fingerprint, locked: true })).toBe(false);
  });

  it('manual: the 200 MB release the user picked, not the 1.1 GB best of the same addon', async () => {
    const { createVideoDriver } = await import('./video-driver.js');
    const routes = [
      torrent('s|a', 'btih:aaaa:0', 'Big.1080p\n👤 289 💾 1.1 GB'),
      torrent('s|b', 'btih:bbbb:0', 'Small.1080p\n👤 68 💾 200 MB'),
    ];
    const engine = engineWith(routes);
    const native = nativeReady();
    const driver = createVideoDriver({ engine: () => engine, native: () => native, platform: () => ({ platform: 'android', torrent: true }) });
    const item = { id: 'dl_fc', kind: 'movie', section: 'cinema', work: { title: 'Fight Club' }, unit: { number: null }, request: { copies: [], episode: -1 },
      source: { mode: 'manual', sourceId: 'addon|torrentio', server: 'Torrentio', routeCode: 'TRR2', fingerprint: 'btih:bbbb:0', quality: 1080 } };
    await driver.run(item, ctlOf());
    expect(native.start).toHaveBeenCalledTimes(1);
    expect(native.start.mock.calls[0][0]).toMatchObject({ candidate: 'cand-s|b', sourceKey: 'addon|torrentio|btih:bbbb:0' });
    // جلسة التنزيل معروفة البادئة (لا تسخين تورنتات أخرى)، وتُغلق بعده
    expect(engine.prepare.mock.calls[0][0].session).toMatch(/^dl-/);
    expect(engine.closeSession).toHaveBeenCalled();
  });

  it('manual: a release the user picked is honored even if its description says 0 seeders', async () => {
    const { createVideoDriver } = await import('./video-driver.js');
    const engine = engineWith([torrent('s|a', 'btih:aaaa:0', 'Big\\n👤 289'), torrent('s|z', 'btih:zzzz:0', 'Rare.Cut\\n👤 0 💾 700 MB')]);
    const native = nativeReady();
    const driver = createVideoDriver({ engine: () => engine, native: () => native, platform: () => ({ platform: 'android', torrent: true }) });
    const item = { id: 'dl_r', kind: 'movie', section: 'cinema', work: { title: 'W' }, unit: { number: null }, request: { copies: [], episode: -1 },
      source: { mode: 'manual', sourceId: 'addon|torrentio', server: 'Torrentio', fingerprint: 'btih:zzzz:0' } };
    await driver.run(item, ctlOf());
    expect(native.start.mock.calls[0][0].candidate).toBe('cand-s|z');
  });

  it('manual: a picked release that did not come back fails honestly instead of downloading another', async () => {
    const { createVideoDriver } = await import('./video-driver.js');
    const engine = engineWith([torrent('s|a', 'btih:aaaa:0', 'Big\n👤 289')]);
    const native = nativeReady();
    const driver = createVideoDriver({ engine: () => engine, native: () => native, platform: () => ({ platform: 'android', torrent: true }) });
    const item = { id: 'dl_fc', kind: 'movie', section: 'cinema', work: { title: 'Fight Club' }, unit: { number: null }, request: { copies: [], episode: -1 },
      source: { mode: 'manual', sourceId: 'addon|torrentio', server: 'Torrentio', fingerprint: 'btih:bbbb:0' } };
    await expect(driver.run(item, ctlOf())).rejects.toMatchObject({ code: 'NO_ROUTE' });
    expect(native.start).not.toHaveBeenCalled();
  });

  it('a job that fails before the listener is attached is not lost (no endless «preparing»)', async () => {
    const { createVideoDriver } = await import('./video-driver.js');
    const engine = engineWith([{ id: 'r1', sourceId: 'src', server: 'mp4', state: 'READY', probed: true, quality: 720 }]);
    let jobState = { exists: false };
    const native = {
      status: vi.fn(async () => jobState),
      inspect: vi.fn(async () => ({ container: 'MP4', transport: 'http', resumable: true })),
      // يفشل فورًا داخل الجهاز قبل أي اشتراك، والحدث يضيع
      start: vi.fn(async () => { jobState = { exists: true, state: 'failed', code: 'SOURCE', message: 'الملف غير موجود عند المصدر (HTTP 404)' }; }),
      addListener: vi.fn(async () => ({ remove() {} })),
    };
    const driver = createVideoDriver({ engine: () => engine, native: () => native, platform: () => ({ platform: 'windows', torrent: false }) });
    const item = { id: 'dl_ar', kind: 'episode', section: 'cinema', work: { title: 'Arcane' }, unit: { number: 1 }, request: { copies: [], episode: 1 }, source: { mode: 'manual', sourceId: 'src', server: 'mp4' } };
    await expect(driver.run(item, ctlOf())).rejects.toMatchObject({ code: 'SOURCE', message: expect.stringContaining('404') });
  });

  it('smart: a server that refuses mid-download is swapped for the next one, on a fresh file', async () => {
    const { createVideoDriver } = await import('./video-driver.js');
    const routes = [
      { id: 'r1', sourceId: 'src', server: 'one', state: 'READY', probed: true, probeMs: 100, quality: 1080 },
      { id: 'r2', sourceId: 'src', server: 'two', state: 'READY', probed: true, probeMs: 300, quality: 1080 },
    ];
    const engine = engineWith(routes);
    const native = fakeDevice(({ candidate }) => (candidate === 'cand-r1'
      ? { state: 'failed', code: 'SOURCE', message: 'HTTP 404' }
      : { state: 'ready', bytes: 9, path: '/ok.mp4' }), { container: 'MP4', transport: 'http', resumable: true });
    const driver = createVideoDriver({ engine: () => engine, native: () => native, platform: () => ({ platform: 'windows', torrent: false }) });
    const item = { id: 'dl_s', kind: 'episode', section: 'anime', work: { title: 'W' }, unit: { number: 3 }, request: { copies: [], episode: 3 }, source: { mode: 'smart' } };
    const out = await driver.run(item, ctlOf());
    expect(out).toMatchObject({ bytes: 9 });
    expect(native.start.mock.calls.map((c) => c[0].candidate)).toEqual(['cand-r1', 'cand-r2']);
    expect(native.start.mock.calls[0][0].sourceKey).not.toBe(native.start.mock.calls[1][0].sourceKey);
  });

  it('smart stops waiting for slow sources once enough is ready', async () => {
    const engine = {
      prepare: vi.fn(async ({ session }) => ({ session, routes: [{ id: 'fast', state: 'READY', probed: true }, { id: 'slow', state: 'RESOLVING' }], done: false })),
      routes: vi.fn(async () => ({ routes: [], done: false })),
      upsertRoute: (list, r) => [...list.filter((x) => x.id !== r.id), r],
      on: () => () => {},
    };
    const t0 = Date.now();
    const out = await resolveRoutes(engine, { copies: [], episode: 1 }, { settleMs: 30_000, enough: (rs) => rs.some((r) => r.state === 'READY') });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(out.routes.some((r) => r.id === 'fast')).toBe(true);
  });

  it('an aborted wait returns its session to the caller instead of leaking it', async () => {
    const ac = new AbortController();
    const engine = {
      prepare: vi.fn(async ({ session }) => ({ session, routes: [{ id: 'slow', state: 'RESOLVING' }], done: false })),
      routes: vi.fn(async () => ({ routes: [], done: false })),
      upsertRoute: (list, r) => [...list.filter((x) => x.id !== r.id), r],
      on: () => () => {},
    };
    setTimeout(() => ac.abort('closed'), 50);
    const out = await resolveRoutes(engine, { copies: [], episode: 1 }, { settleMs: 30_000, signal: ac.signal });
    expect(out.session).toMatch(/^dl-/);
  });
});

describe('work art on the device', () => {
  it('a manga cover the WebView cannot fetch (no CORS, needs Referer) is saved through the source engine', async () => {
    const { saveWorkArt, artUrl } = await import('./art.js');
    const store = memoryStore();
    const fetchImpl = vi.fn(async (src) => {
      if (src.startsWith('https://')) throw new TypeError('Failed to fetch'); // CORS/Referer من الواجهة
      return { ok: true, blob: async () => new Blob([JPEG()], { type: 'image/jpeg' }) };
    });
    const local = vi.fn(async () => 'http://localhost/_capacitor_file_/files/covers/a.jpg');
    const saved = await saveWorkArt(store, { ref: 'ext:solo', cover: 'https://site.example/wp/cover.jpg', coverSource: 'src1' }, { fetchImpl, local });
    expect(saved).toBe(1);
    expect(local).toHaveBeenCalledWith('https://site.example/wp/cover.jpg', 'cover');
    globalThis.URL.createObjectURL ??= () => 'blob:x';
    expect(await artUrl(store, 'ext:solo', 'cover')).toBeTruthy();
  });
});

describe('manga: the chapter the sheet starts on, and a source that returns no pages', () => {
  it('an unnumbered row (-1: announcement/prologue) is unknown and never the default chapter', () => {
    expect(mangaUnitNumber(-1)).toBeNull();
    expect(mangaUnitNumber(0)).toBe(0);
    expect(mangaUnitNumber('12.5')).toBe(12.5);
    expect(mangaUnitNumber(null)).toBeNull();
    const units = [{ key: 'u:ad', number: null }, { key: 'n:0', number: 0 }, { key: 'n:1', number: 1 }, { key: 'n:2', number: 2 }];
    // بلا سجل قراءة: أول فصل حقيقي (1) لا الإعلان ولا الفصل 0 الترويجي
    expect(defaultUnitKey(units)).toBe('n:1');
    // ما تقرؤه تاليًا يغلب
    expect(defaultUnitKey(units, 'n:2')).toBe('n:2');
    // عمل أوله 0 فقط: يبقى 0، وبلا أرقام: الأول
    expect(defaultUnitKey([{ key: 'n:0', number: 0 }])).toBe('n:0');
    expect(defaultUnitKey([{ key: 'a', number: null }])).toBe('a');
  });

});

describe('cinema on device', () => {
  it('uses the downloaded second season and ignores first-season watch history', () => {
    const items = [{ unit: { key: 's2e3', title: 'Third' } }, { unit: { key: 's2e9' } }];
    const saved = [{ n: 1, episodes: [{ n: 1 }] }, { n: 2, episodes: [{ n: 3, name: 'Metadata' }, { n: 4 }] }];
    const seasons = localCinemaSeasons(items, saved);
    expect(seasons.map((s) => [s.n, s.episodes.map((e) => e.n)])).toEqual([[2, [3, 9]]]);
    expect(seasons[0].episodes[0].name).toBe('Metadata');
    expect(localCinemaResume(seasons, 1, { season: 1, episode: 1, episodes: { '1:1': { position: 9000 } } })).toMatchObject({ season: 2, episode: 3, position: 0 });
    expect(localCinemaResume(seasons, 2, { season: 2, episode: 9, episodes: { '2:9': { position: 21000 } } })).toMatchObject({ season: 2, episode: 9, position: 21000 });
  });
});

it('records a failed artwork request and recovers it after the backoff without touching downloaded media', async () => {
  const { saveWorkArt, artUrl, dropWorkArt } = await import('./art.js');
  const store = memoryStore();
  const work = { ref: 'cinema:offline-art-test', cover: 'https://images.test/poster.png' };
  const key = `${work.ref}|cover`;
  const input = { fetchImpl: vi.fn(async () => ({ ok: false, status: 503 })) };
  expect(await saveWorkArt(store, work, input)).toBe(0);
  const failed = await store.getArt(key);
  expect(failed).toMatchObject({ attempts: 1, error: 'HTTP 503' });
  expect(await artUrl(store, work.ref, 'cover')).toBeNull();
  await saveWorkArt(store, work, input);
  expect(input.fetchImpl).toHaveBeenCalledTimes(1);
  await store.putArt(key, { ...failed, retryAt: 0 });
  input.fetchImpl.mockResolvedValue({ ok: true, blob: async () => new Blob([JPEG()], { type: 'image/jpeg' }) });
  expect(await saveWorkArt(store, work, input)).toBe(1);
  expect(await artUrl(store, work.ref, 'cover')).toMatch(/^blob:/);
  await dropWorkArt(store, work.ref);
  expect(await artUrl(store, work.ref, 'cover')).toBeNull();
});
