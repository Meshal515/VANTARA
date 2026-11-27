import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { createIndexedDbBackend, openLatestStore } from './latest-store.js';
import { createLatestEngine, runPool } from './latest-engine.js';
import { eventId } from './update-decision.js';

let acc = 0;
const fresh = () => openLatestStore({ account: `eng-${++acc}`, backend: createIndexedDbBackend(indexedDB) });
const norm = (t) => t.toLowerCase().replace(/\s+/g, '');
// مصدر وهمي: صفحة «أحدث» قابلة للتغيير، وفصول لكل عمل، وعدّاد طلبات
function source(key, { host = `${key}.example`, works = {} } = {}) {
  const s = { key, host, section: 'manga', order: Object.keys(works), works, latestCalls: 0, unitCalls: [] };
  s.provider = {
    key, host, section: 'manga',
    latest: vi.fn(async () => { s.latestCalls++; return { items: s.order.map((t) => ({ ref: { title: t }, title: t, url: `/${norm(t)}`, cover: null })), hasNext: false }; }),
    units: vi.fn(async (ref) => { s.unitCalls.push(ref.title); return s.works[ref.title].map((n) => ({ number: n, season: null })); }),
  };
  return s;
}
const engineFor = (store, sources, opts = {}) => createLatestEngine({
  store, providers: async () => sources.map((s) => s.provider), identify: async (p, item) => `ext:${norm(item.title)}`, now: () => 1_000_000, ...opts,
});
const all = async (store) => (await store.timeline('manga', { limit: 100 })).events;

describe('محرك آخر التحديثات المحلي: لا جلب أعمى', () => {
  it('أول دورة لمصدر: طلب «الأحدث» وحده، بلا أي طلب فصول وبلا أي حدث', async () => {
    const store = fresh(); const a = source('a', { works: { 'ون بيس': [1, 2, 3], 'بليتش': [5] } });
    const st = await engineFor(store, [a]).runCycle();
    expect(st).toMatchObject({ latestCalls: 1, unitCalls: 0, events: 0, firstSeen: 1 });
    expect(await all(store)).toEqual([]);
  });

  it('صفحة مطابقة لسابقتها: أعلى K فقط، وأول رؤية لكل عمل خط أساس بلا أحداث', async () => {
    const store = fresh(); const works = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`عمل ${i}`, [10]]));
    const a = source('a', { works }); const e = engineFor(store, [a], { topK: 3 });
    await e.runCycle();
    const st = await e.runCycle();
    expect(st.unitCalls).toBe(3);
    expect(a.unitCalls).toEqual(['عمل 0', 'عمل 1', 'عمل 2']);
    expect(st).toMatchObject({ events: 0, baselined: 3 });
  });

  it('عمل يبقى أول القائمة وينزل له فصل: يُكتشف (حالة المالك)', async () => {
    const store = fresh(); const a = source('a', { works: { 'ون بيس': [1118, 1119], 'بليتش': [5] } }); const e = engineFor(store, [a]);
    await e.runCycle(); await e.runCycle();
    a.works['ون بيس'] = [1118, 1119, 1120];
    const st = await e.runCycle();
    expect(st.events).toBe(1);
    const [ev] = await all(store);
    expect(ev).toMatchObject({ id: eventId('ext:ونبيس', 'chapter', null, 1120), number: 1120, at: 1_000_000, sources: [{ s: 'a', u: '/ونبيس', t: 'ون بيس' }] });
  });

  it('عمل جديد في القائمة يُفحص، ورقم شاذ لا يصير حدثًا ولا خطًا', async () => {
    const store = fresh(); const a = source('a', { works: { 'ون بيس': [100] } }); const e = engineFor(store, [a], { topK: 1 });
    await e.runCycle();
    a.works['جديد'] = [1, 2, 3, 9999]; a.order = ['ون بيس', 'جديد'];
    let st = await e.runCycle();
    expect(a.unitCalls).toContain('جديد');
    expect(st.events).toBe(0);
    expect((await store.getMarks(['ext:جديد']))[0].number).toBe(3);
    a.works['جديد'] = [1, 2, 3, 4, 9999]; a.order = ['جديد', 'ون بيس'];
    st = await e.runCycle();
    expect((await all(store)).map((x) => x.number)).toEqual([4]);
    expect((await store.getMarks(['ext:جديد']))[0].number).toBe(4);
  });

  it('الكشف مرة ثم الانتشار: فصول العمل من مصادره الأخرى مرة واحدة، ولا شيء غيره', async () => {
    const store = fresh();
    const a = source('a', { works: { 'ون بيس': [10], 'بليتش': [1] } }), b = source('b', { works: { 'ون بيس': [10], 'ناروتو': [7] } });
    const e = engineFor(store, [a, b], { topK: 1 });
    await e.runCycle(); await e.runCycle();
    a.works['ون بيس'] = [10, 11]; b.works['ون بيس'] = [10, 11];
    a.unitCalls.length = 0; b.unitCalls.length = 0;
    const st = await e.runCycle();
    const [ev] = await all(store);
    expect(ev.sources.map((s) => s.s).sort()).toEqual(['a', 'b']);
    expect(b.unitCalls.filter((t) => t === 'ون بيس').length).toBeLessThanOrEqual(2);
    expect(b.unitCalls).not.toContain('ناروتو');
    expect(st.events).toBe(1);
  });

  it('الميزانية: ما لا يتسع يُرحَّل للدورة التالية بأولويته ولا يضيع', async () => {
    const store = fresh(); const works = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`ع${i}`, [1]]));
    const a = source('a', { works }); const e = engineFor(store, [a], { topK: 0, unitBudget: 2 });
    await e.runCycle();
    a.order = [...a.order].reverse();
    const st = await e.runCycle();
    expect(st.unitCalls).toBe(2);
    expect(st.carried).toBeGreaterThan(0);
    const next = await e.runCycle();
    expect(next.unitCalls).toBe(st.carried);
    // الصاعدون الثلاثة فُحصوا كلهم على دورتين، والنازلون لا يُفحصون (لا جلب أعمى)
    expect(new Set(a.unitCalls).size).toBe(3);
  });

  it('يندمج بالحدث المهاجَر نفسه بلا تكرار: الوقت الأقدم والتثبيت باقيان', async () => {
    const store = fresh(); const a = source('a', { works: { 'ون بيس': [10] } }); const e = engineFor(store, [a]);
    await e.runCycle(); await e.runCycle();
    await store.putEvents([{ id: eventId('ext:ونبيس', 'chapter', null, 11), work: 'ext:ونبيس', section: 'manga', kind: 'chapter', number: 11, title: 'ون بيس', at: 500, firstSeenAt: 500, sources: [{ s: 'server.src' }] }], { pinned: true, origin: 'migrated' });
    a.works['ون بيس'] = [10, 11];
    await e.runCycle();
    const list = await all(store);
    expect(list).toHaveLength(1);
    expect(list[0].at).toBe(500);
    expect((await store.getEvent(list[0].id)).pinned).toBe(true);
    expect(list[0].sources.map((s) => s.s)).toEqual(['server.src', 'a']);
  });

  it('ما لا تُعرف هويته لا ينشئ حدثًا، والسياسة تمنع قبل أي طلب فصول', async () => {
    const store = fresh(); const a = source('a', { works: { 'مجهول': [1], 'ممنوع': [1] } });
    const e = engineFor(store, [a], { identify: async (p, i) => (i.title === 'مجهول' ? null : 'ext:x'), allow: (p, i) => i.title !== 'ممنوع' });
    await e.runCycle(); const st = await e.runCycle();
    expect(st).toMatchObject({ unidentified: 1, skipped: 1, unitCalls: 0, events: 0 });
  });

  it('مصدر يفشل أو يعلق لا يوقف غيره', async () => {
    const store = fresh(); const a = source('a', { works: { 'ون بيس': [1] } }), bad = source('bad', { works: {} });
    bad.provider.latest = () => new Promise(() => {});
    const st = await engineFor(store, [bad, a], { timeoutMs: 30 }).runCycle();
    expect(st).toMatchObject({ errors: 1, firstSeen: 1 });
  });
});

describe('تجمّع الطلبات', () => {
  it('لا يتجاوز الحد العام ولا حد المضيف، وكلما انتهى طلب دخل التالي', async () => {
    let active = 0, max = 0; const perHost = new Map(), hostMax = new Map();
    const jobs = Array.from({ length: 40 }, (_, i) => ({ host: `h${i % 3}`, run: async () => {
      active++; max = Math.max(max, active); const h = `h${i % 3}`; perHost.set(h, (perHost.get(h) ?? 0) + 1); hostMax.set(h, Math.max(hostMax.get(h) ?? 0, perHost.get(h)));
      await new Promise((r) => setTimeout(r, 2)); active--; perHost.set(h, perHost.get(h) - 1);
    } }));
    await runPool(jobs, { concurrency: 12, perHost: 2 });
    expect(max).toBeLessThanOrEqual(6);
    for (const v of hostMax.values()) expect(v).toBeLessThanOrEqual(2);
    const free = Array.from({ length: 30 }, (_, i) => ({ host: `x${i}`, run: async () => { active++; max = Math.max(max, active); await new Promise((r) => setTimeout(r, 2)); active--; } }));
    max = 0; await runPool(free, { concurrency: 12, perHost: 2 });
    expect(max).toBe(12);
  });
});
