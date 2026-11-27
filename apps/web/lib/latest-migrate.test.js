import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { createIndexedDbBackend, openLatestStore } from './latest-store.js';
import { MIGRATION_KEY, migrateLatest, raiseMarks } from './latest-migrate.js';

let acc = 0;
const fresh = () => openLatestStore({ account: `mig-${++acc}`, backend: createIndexedDbBackend(indexedDB) });
const ev = (section, i, extra = {}) => ({
  id: `${section}-${i}`, work: `${section}-w${i % 4}`, section, kind: section === 'manga' ? 'chapter' : 'episode', season: null, number: 100 - i,
  title: `عمل ${i}`, cover: `https://img/${i}.jpg`, at: 10_000 - i * 10, publishedAt: i % 2 ? 9_000 - i : null, firstSeenAt: 10_000 - i * 10,
  observedAdvance: i % 3 === 0, sources: [{ s: `src.${i % 3}`, u: `https://site/${i}`, t: 'ت' }], ...extra,
});
// خادم وهمي بصفحات حقيقية الشكل (`/v1/updates` و`/v1/source-latest`)
function server({ manga = 250, anime = 30, cinema = 0, failAt = null } = {}) {
  const data = { manga: Array.from({ length: manga }, (_, i) => ev('manga', i)), anime: Array.from({ length: anime }, (_, i) => ev('anime', i)), cinema: Array.from({ length: cinema }, (_, i) => ev('cinema', i)) };
  let calls = 0;
  const send = vi.fn(async (path) => {
    calls++;
    if (failAt && calls === failAt) return { status: 503, body: null };
    const u = new URL(path, 'https://x');
    if (u.pathname === '/v1/source-latest') return { status: 200, body: { sources: [{ sourceId: 'pkg.a', value: { mangas: [{ title: 'x' }] }, fetchedAt: 42 }] } };
    const list = data[u.searchParams.get('section')], limit = Number(u.searchParams.get('limit')), before = u.searchParams.get('before');
    const start = before ? list.findIndex((e) => `${e.at}~${e.id}` === before) + 1 : 0;
    const page = list.slice(start, start + limit);
    return { status: 200, body: { events: page, next: start + limit < list.length ? `${page.at(-1).at}~${page.at(-1).id}` : null } };
  });
  return { data, send };
}
const all = async (store, section) => { const out = []; let before = null; do { const p = await store.timeline(section, { limit: 100, before }); out.push(...p.events); before = p.next; } while (before); return out; };

describe('هجرة آخر التحديثات: لا تصفير، حرفيًا', () => {
  it('ينسخ كل الصفحات كما هي: نفس المعرّفات والأوقات والترتيب والحقول، ومثبّتة', async () => {
    const store = fresh(); const { data, send } = server();
    const st = await migrateLatest({ store, send });
    expect(st.done).toBe(true);
    for (const section of ['manga', 'anime', 'cinema']) {
      const local = await all(store, section);
      expect(local).toEqual(data[section]);
    }
    expect(await store.stats()).toMatchObject({ events: 280, pinned: 280 });
    expect((await store.getEvent('manga-5')).origin).toBe('migrated');
    expect(await store.getSnapshot('pkg.a')).toMatchObject({ payload: { mangas: [{ title: 'x' }] }, fetchedAt: 42 });
  });

  it('اكتملت مرة: لا تُعاد ولا تطلب الخادم من جديد', async () => {
    const store = fresh(); const { send } = server({ manga: 10, anime: 0 });
    await migrateLatest({ store, send });
    send.mockClear();
    const again = await migrateLatest({ store, send });
    expect(again.skipped).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('انقطاع في منتصفها يكمل من آخر صفحة مكتوبة بلا تكرار ولا فقد', async () => {
    const store = fresh(); const { data, send } = server({ manga: 250, failAt: 2 });
    await expect(migrateLatest({ store, send })).rejects.toMatchObject({ code: 'MIGRATION_PENDING' });
    const mid = await store.getMeta(MIGRATION_KEY);
    expect(mid.sections.manga).toMatchObject({ pages: 1, events: 100, done: false });
    const st = await migrateLatest({ store, send });
    expect(st.done).toBe(true);
    expect((await all(store, 'manga')).map((e) => e.id)).toEqual(data.manga.map((e) => e.id));
    expect((await store.stats()).events).toBe(280);
  });

  it('حد الصفحات في الجلسة: ما بقي يكمل في التشغيل التالي', async () => {
    const store = fresh(); const { send } = server({ manga: 250 });
    const first = await migrateLatest({ store, send, maxPages: 2 });
    expect(first.done).toBe(false);
    expect((await store.stats()).events).toBe(200);
    expect((await migrateLatest({ store, send })).done).toBe(true);
    expect((await store.stats()).events).toBe(280);
  });

  it('خطوط الأساس لكل عمل ولكل مصدر من الأحداث، ترتفع فقط ولا تنزل', async () => {
    const store = fresh();
    await raiseMarks(store, [ev('manga', 0, { work: 'W', number: 50 }), ev('manga', 1, { work: 'W', number: 60, sources: [{ s: 'a' }] }), ev('manga', 2, { work: 'W', number: 55, sources: [{ s: 'b' }] })], 1);
    expect(await store.getMarks(['W'])).toMatchObject([{ work: 'W', number: 60, baselineAt: 1 }]);
    await raiseMarks(store, [ev('manga', 3, { work: 'W', number: 10, sources: [{ s: 'a' }] })], 2);
    expect((await store.getMarks(['W']))[0].number).toBe(60);
    const src = Object.fromEntries((await store.getSourceMarks('W')).map((m) => [m.sourceId, m.number]));
    expect(src).toMatchObject({ a: 60, b: 55 });
  });

  it('الكشف المحلي لاحقًا لا يغيّر وقت حدث مهاجَر ولا يلغي تثبيته', async () => {
    const store = fresh(); const { send } = server({ manga: 5, anime: 0 });
    await migrateLatest({ store, send });
    const before = await store.getEvent('manga-2');
    await store.putEvents([{ ...before, at: before.at + 99_999, sources: [{ s: 'new.src' }] }]);
    const after = await store.getEvent('manga-2');
    expect(after.at).toBe(before.at);
    expect(after.pinned).toBe(true);
    expect(after.sources.map((s) => s.s)).toContain('new.src');
  });

  it('لا كتابة على الخادم: كل الطلبات قراءة GET', async () => {
    const store = fresh(); const { send } = server({ manga: 3 });
    await migrateLatest({ store, send });
    for (const [, opts] of send.mock.calls) expect(opts?.method ?? 'GET').toBe('GET');
  });
});
