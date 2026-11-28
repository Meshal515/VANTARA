import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { createIndexedDbBackend, openLatestStore } from './latest-store.js';
import { friendFresh, pullSignals, pushThreads, recordLocalEvents, restoreBackup } from './latest-threads.js';
import { createLatestEngine } from './latest-engine.js';

let acc = 0;
const fresh = () => openLatestStore({ account: `thr-${++acc}`, backend: createIndexedDbBackend(indexedDB) });
const ev = (n, extra = {}) => ({ id: `ext:w|c:${n}`, work: 'ext:w', section: 'manga', kind: 'chapter', season: null, number: n, title: 'عمل', cover: 'https://img/c.jpg', at: 1000 + n, firstSeenAt: 1000 + n, sources: [{ s: 'pkg.ar', u: 'https://site/w', t: 'عمل' }], ...extra });

/** خادم النسخة كما في latest-threads.ts: صف لكل حدث لكل حساب، دمج بالمعرّف، وصفحات. */
function backupServer({ page = 500 } = {}) {
  const rows = new Map();
  const calls = [];
  const send = vi.fn(async (path, opts) => {
    calls.push([path, opts?.method ?? 'GET']);
    if (opts?.method === 'POST' && path === '/v1/latest/backup/events') { for (const e of opts.body.events) rows.set(e.id, e); return { status: 200, body: { ok: true, events: opts.body.events.length } }; }
    if (path.startsWith('/v1/latest/backup')) {
      const after = new URL(path, 'http://x').searchParams.get('after');
      const all = [...rows.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
      const from = after ? all.findIndex((e) => `${e.at}|${e.id}` === after) + 1 : 0;
      const list = all.slice(from, from + page);
      return { status: 200, body: { payload: list.length ? { v: 2, events: list } : null, next: from + page < all.length ? `${list.at(-1).at}|${list.at(-1).id}` : null } };
    }
    return { status: 200, body: { accepted: 0 } };
  });
  return { send, rows, calls };
}

describe('الخيط الأول: نسخة الحساب', () => {
  it('ما كشفه الجهاز يُرفع بلا روابط، ويُستعاد مرة واحدة في تثبيت جديد مثبّتًا', async () => {
    const a = fresh(); const srv = backupServer();
    await recordLocalEvents(a, [ev(5), ev(6)]);
    expect((await pushThreads(a, srv.send)).backup).toBe(true);
    expect(JSON.stringify([...srv.rows.values()])).not.toMatch(/https?:/);
    // جهاز جديد
    const b = fresh();
    expect(await restoreBackup(b, srv.send)).toMatchObject({ restored: 2, ok: true });
    expect((await b.getEvent('ext:w|c:6')).pinned).toBe(true);
    expect((await b.getMarks(['ext:w']))[0].number).toBe(6);
    srv.send.mockClear();
    expect((await restoreBackup(b, srv.send)).skipped).toBe(true);
    expect(srv.send).not.toHaveBeenCalled();
  });

  it('جهازان لا يمحو أحدهما نسخة الآخر: الخادم يدمج بالمعرّف، وتثبيت جديد يستعيد الاثنين', async () => {
    const srv = backupServer();
    const phone = fresh(), pc = fresh();
    await recordLocalEvents(phone, [ev(1), ev(2)]);
    await recordLocalEvents(pc, [ev(3, { id: 'ext:x|c:3', work: 'ext:x' })]);
    await pushThreads(phone, srv.send); await pushThreads(pc, srv.send);
    expect([...srv.rows.keys()].sort()).toEqual(['ext:w|c:1', 'ext:w|c:2', 'ext:x|c:3']);
    const fresh3 = fresh();
    expect((await restoreBackup(fresh3, srv.send)).restored).toBe(3);
  });

  it('الرفع تفاضلي: الجديد فقط، ولا رفع إن لم يتغير شيء', async () => {
    const a = fresh(); const srv = backupServer();
    await recordLocalEvents(a, [ev(1), ev(2)]);
    await pushThreads(a, srv.send);
    srv.calls.length = 0;
    await pushThreads(a, srv.send);
    expect(srv.calls.filter(([p]) => p === '/v1/latest/backup/events')).toEqual([]);
    await recordLocalEvents(a, [ev(3)]);
    const before = srv.send.mock.calls.length;
    await pushThreads(a, srv.send);
    const sent = srv.send.mock.calls.slice(before).filter(([p]) => p === '/v1/latest/backup/events').flatMap(([, o]) => o.body.events.map((e) => e.id));
    expect(sent).toEqual(['ext:w|c:3']);
  });

  it('لا تقليم صامت: أكثر من 1500 حدث كلها تُحفظ وتُرفع وتُستعاد، صفحة صفحة', async () => {
    const a = fresh(); const srv = backupServer({ page: 500 });
    const many = Array.from({ length: 1800 }, (_, i) => ev(i, { id: `ext:w|c:${i}` }));
    await recordLocalEvents(a, many);
    await pushThreads(a, srv.send);
    expect(srv.rows.size).toBe(1800);
    expect((await restoreBackup(fresh(), srv.send)).restored).toBe(1800);
  });

  it('فشل الرفع لا يفقد شيئًا: ما لم يُرفع يبقى للمرة التالية', async () => {
    const a = fresh(); const srv = backupServer();
    await recordLocalEvents(a, [ev(1)]);
    const down = vi.fn(async () => ({ status: 503, body: {} }));
    expect((await pushThreads(a, down)).backup).toBe(false);
    expect((await pushThreads(a, srv.send)).events).toBe(1);
    expect(srv.rows.has('ext:w|c:1')).toBe(true);
  });

  it('إشارات تراكمت بلا شبكة لا يسقط منها شيء (كان slice(-500))، ولا تتكرر', async () => {
    const a = fresh();
    for (let i = 0; i < 7; i++) await recordLocalEvents(a, Array.from({ length: 100 }, (_, j) => ev(i * 100 + j, { id: `ext:w|c:${i * 100 + j}` })));
    await recordLocalEvents(a, [ev(1, { id: 'ext:w|c:1' })]);
    expect(((await a.getMeta('signals.outbox')) ?? []).length).toBe(700);
  });
});

describe('الخيط الثاني: إشارات الأصحاب', () => {
  const server = (signals) => vi.fn(async (path) => (path.startsWith('/v1/latest/signals') ? { status: 200, body: { signals: path.endsWith('after=0') ? signals : [], next: signals.length } } : { status: 404, body: {} }));
  const sig = (n, sourceId = 'pkg.ar') => ({ eventId: `ext:w|c:${n}`, work: 'ext:w', section: 'manga', kind: 'chapter', season: null, number: n, title: 'عمل', sourceId, at: 2000 + n });

  it('تظهر ولو لم يُثبَّت مصدرها هنا (قرار المالك)، والسياسة وحدها تمنع، وتُكتب حدثًا وترفع الخط', async () => {
    const store = fresh();
    const send = server([sig(10), sig(11, 'not.installed'), sig(12, 'pkg.blocked')]);
    const r = await pullSignals(store, send, { allow: (section, key) => key !== 'pkg.blocked', now: 5000 });
    expect(r).toEqual({ accepted: 2, rejected: 1 });
    expect((await store.timeline('manga')).events.map((e) => e.id)).toEqual(['ext:w|c:11', 'ext:w|c:10']);
    expect((await store.getMarks(['ext:w']))[0].number).toBe(11);
    expect(await store.getMeta('signals.after')).toBe(3);
    expect(await friendFresh(store, 'pkg.ar', 'ext:w', 5000)).toBe(true);
    expect(await friendFresh(store, 'pkg.ar', 'ext:w', 5000 + 3 * 3_600_000)).toBe(false);
  });

  it('إشارة صديق تُغني الكاشف عن طلب فصول العمل نفسه من المصدر نفسه', async () => {
    const store = fresh(); let units = 0;
    const p = { key: 'pkg.ar', host: 'h', section: 'manga', latest: async () => ({ items: [{ ref: { title: 'عمل' }, title: 'عمل', url: '/w' }] }), units: async () => { units++; return [{ number: 10, season: null }]; } };
    const engine = createLatestEngine({ store, providers: async () => [p], identify: async () => 'ext:w', now: () => 5000, skipWork: (q, work) => friendFresh(store, q.key, work, 5000) });
    await engine.runCycle();
    await pullSignals(store, server([sig(10)]), { now: 5000 });
    const st = await engine.runCycle();
    expect(st.friendSkip).toBe(1);
    expect(units).toBe(0);
  });

  it('ما يكشفه الجهاز يُنشر إشارةً بمعرّف المصدر فقط', async () => {
    const store = fresh(); const sent = [];
    await recordLocalEvents(store, [ev(7)]);
    await pushThreads(store, async (path, opts) => { if (path === '/v1/latest/signals') sent.push(...opts.body.signals); return { status: 200, body: {} }; });
    expect(sent).toEqual([{ eventId: 'ext:w|c:7', work: 'ext:w', section: 'manga', kind: 'chapter', season: null, number: 7, title: 'عمل', sourceId: 'pkg.ar', at: 1007 }]);
    expect(await store.getMeta('signals.outbox')).toEqual([]);
  });
});
