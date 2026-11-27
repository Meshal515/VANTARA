import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { createIndexedDbBackend, openLatestStore } from './latest-store.js';
import { friendFresh, pullSignals, pushThreads, recordLocalEvents, restoreBackup } from './latest-threads.js';
import { createLatestEngine } from './latest-engine.js';

let acc = 0;
const fresh = () => openLatestStore({ account: `thr-${++acc}`, backend: createIndexedDbBackend(indexedDB) });
const ev = (n, extra = {}) => ({ id: `ext:w|c:${n}`, work: 'ext:w', section: 'manga', kind: 'chapter', season: null, number: n, title: 'عمل', cover: 'https://img/c.jpg', at: 1000 + n, firstSeenAt: 1000 + n, sources: [{ s: 'pkg.ar', u: 'https://site/w', t: 'عمل' }], ...extra });

describe('الخيط الأول: نسخة الحساب', () => {
  it('ما كشفه الجهاز يُرفع بلا روابط، ويُستعاد مرة واحدة في تثبيت جديد مثبّتًا', async () => {
    const a = fresh(); let saved = null;
    const send = vi.fn(async (path, opts) => {
      if (opts?.method === 'POST' && path === '/v1/latest/backup') { saved = opts.body.payload; return { status: 200, body: { ok: true } }; }
      if (path === '/v1/latest/backup') return { status: 200, body: { payload: saved } };
      return { status: 200, body: { accepted: 0 } };
    });
    await recordLocalEvents(a, [ev(5), ev(6)]);
    expect((await pushThreads(a, send)).backup).toBe(true);
    expect(JSON.stringify(saved)).not.toMatch(/https?:/);
    expect(saved.events.map((e) => e.id)).toEqual(['ext:w|c:6', 'ext:w|c:5']);
    // جهاز جديد
    const b = fresh();
    expect(await restoreBackup(b, send)).toMatchObject({ restored: 2, ok: true });
    expect((await b.getEvent('ext:w|c:6')).pinned).toBe(true);
    expect((await b.getMarks(['ext:w']))[0].number).toBe(6);
    send.mockClear();
    expect((await restoreBackup(b, send)).skipped).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('الخيط الثاني: إشارات الأصحاب', () => {
  const server = (signals) => vi.fn(async (path) => (path.startsWith('/v1/latest/signals') ? { status: 200, body: { signals: path.endsWith('after=0') ? signals : [], next: signals.length } } : { status: 404, body: {} }));
  const sig = (n, sourceId = 'pkg.ar') => ({ eventId: `ext:w|c:${n}`, work: 'ext:w', section: 'manga', kind: 'chapter', season: null, number: n, title: 'عمل', sourceId, at: 2000 + n });

  it('تُقبل لمصدر مثبت هنا وبسياسة هذا الجهاز فقط، وتُكتب حدثًا وترفع الخط', async () => {
    const store = fresh();
    const send = server([sig(10), sig(11, 'not.installed'), sig(12, 'pkg.blocked')]);
    const r = await pullSignals(store, send, { installed: new Set(['pkg.ar', 'pkg.blocked']), allow: (section, key) => key !== 'pkg.blocked', now: 5000 });
    expect(r).toEqual({ accepted: 1, rejected: 2 });
    expect((await store.timeline('manga')).events.map((e) => e.id)).toEqual(['ext:w|c:10']);
    expect((await store.getMarks(['ext:w']))[0].number).toBe(10);
    expect(await store.getMeta('signals.after')).toBe(3);
    expect(await friendFresh(store, 'pkg.ar', 'ext:w', 5000)).toBe(true);
    expect(await friendFresh(store, 'pkg.ar', 'ext:w', 5000 + 3 * 3_600_000)).toBe(false);
  });

  it('إشارة صديق تُغني الكاشف عن طلب فصول العمل نفسه من المصدر نفسه', async () => {
    const store = fresh(); let units = 0;
    const p = { key: 'pkg.ar', host: 'h', section: 'manga', latest: async () => ({ items: [{ ref: { title: 'عمل' }, title: 'عمل', url: '/w' }] }), units: async () => { units++; return [{ number: 10, season: null }]; } };
    const engine = createLatestEngine({ store, providers: async () => [p], identify: async () => 'ext:w', now: () => 5000, skipWork: (q, work) => friendFresh(store, q.key, work, 5000) });
    await engine.runCycle();
    await pullSignals(store, server([sig(10)]), { installed: new Set(['pkg.ar']), now: 5000 });
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
