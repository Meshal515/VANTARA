/**
 * هجرة «آخر التحديثات» إلى المخزن المحلي (خطة 27 نوفمبر، المرحلة 3). قرار المالك: **لا تصفير، حرفيًا**.
 *
 * - كل صفحات `/v1/updates` للأقسام الثلاثة تُنسخ كما يراها المستخدم اليوم: نفس المعرّفات والأوقات والأرقام
 *   والمصادر والأغلفة، **مثبّتة** (`pinned`، `origin: 'migrated'`)، فلا يطالها أي تقليم.
 * - خطوط الأساس تُشتق من الأحداث نفسها: أعلى وحدة لكل عمل ولكل مصدر (ترتفع فقط، لا تنزل أبدًا)، فلا يرى الكشف
 *   المحلي أعمالًا قديمة كأنها جديدة.
 * - لقطات «الأحدث» لكل مصدر (`/v1/source-latest`) تُنسخ كذلك.
 * - نقطة استئناف بعد كل صفحة: انقطاع الشبكة أو قتل التطبيق يكمل من حيث وقف، والاكتمال لا يُعاد.
 * - **قراءة فقط من الخادم:** لا كتابة ولا حذف هناك.
 */

export const MIGRATION_KEY = 'migration.v1';
const SECTIONS = ['manga', 'anime', 'cinema'];
const above = (a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.number ?? 0) - (b.number ?? 0);

/** يرفع خطوط الأساس لكل عمل ولكل مصدر إلى أعلى وحدة في هذه الأحداث، ولا يخفضها أبدًا. */
export async function raiseMarks(store, events, now = Date.now()) {
  const works = new Map(), sources = new Map();
  for (const e of events) {
    if (e?.kind === 'movie' || !Number.isFinite(e?.number)) continue;
    const unit = { season: Number.isInteger(e.season) ? e.season : null, number: e.number };
    const w = works.get(e.work);
    if (!w || above(unit, w) > 0) works.set(e.work, { work: e.work, section: e.section, ...unit });
    for (const s of e.sources ?? []) {
      if (typeof s?.s !== 'string') continue;
      const k = `${e.work}\u0000${s.s}`, cur = sources.get(k);
      if (!cur || above(unit, cur) > 0) sources.set(k, { work: e.work, sourceId: s.s, ...unit });
    }
  }
  if (!works.size) return { marks: 0, sourceMarks: 0 };
  const have = new Map((await store.getMarks([...works.keys()])).map((m) => [m.work, m]));
  const marks = [...works.values()].filter((m) => !have.has(m.work) || above(m, have.get(m.work)) > 0)
    .map((m) => ({ ...m, baselineAt: have.get(m.work)?.baselineAt ?? now, updatedAt: now }));
  if (marks.length) await store.putMarks(marks);
  const srcMarks = [];
  for (const work of new Set([...sources.values()].map((x) => x.work))) {
    const old = new Map((await store.getSourceMarks(work)).map((m) => [m.sourceId, m]));
    for (const m of sources.values()) if (m.work === work && (!old.has(m.sourceId) || above(m, old.get(m.sourceId)) > 0)) srcMarks.push({ ...m, updatedAt: now });
  }
  if (srcMarks.length) await store.putSourceMarks(srcMarks);
  return { marks: marks.length, sourceMarks: srcMarks.length };
}

/**
 * `send(path)` → `{status, body}` (نفس `sync.translation`). ترجع حالة الهجرة المحفوظة.
 * `maxPages` حد للصفحات في الجلسة الواحدة؛ ما بقي يكمل في التشغيل التالي من نقطة الاستئناف.
 */
export async function migrateLatest({ store, send, pageLimit = 100, maxPages = 400, now = () => Date.now() }) {
  const state = (await store.getMeta(MIGRATION_KEY)) ?? { version: 1, startedAt: now(), sections: {}, snapshots: false, done: false };
  if (state.done) return { ...state, skipped: true };
  let pages = 0;
  for (const section of SECTIONS) {
    const s = (state.sections[section] ??= { cursor: null, pages: 0, events: 0, rejected: 0, done: false });
    while (!s.done && pages < maxPages) {
      const q = new URLSearchParams({ section, limit: String(pageLimit), ...(s.cursor ? { before: s.cursor } : {}) });
      const res = await send(`/v1/updates?${q}`);
      if (res?.status !== 200 || !Array.isArray(res.body?.events)) throw Object.assign(new Error('تعذّر قراءة آخر التحديثات من الخادم؛ تكمل الهجرة لاحقًا من حيث وقفت'), { code: 'MIGRATION_PENDING' });
      const events = res.body.events;
      const put = await store.putEvents(events, { pinned: true, origin: 'migrated' });
      await raiseMarks(store, events, now());
      s.events += events.length; s.rejected += put.rejected ?? 0; s.pages++; pages++;
      s.cursor = res.body.next ?? null; s.done = !s.cursor;
      // نقطة الاستئناف بعد كل صفحة مكتوبة
      await store.setMeta(MIGRATION_KEY, state);
    }
  }
  if (!state.snapshots && SECTIONS.every((x) => state.sections[x]?.done)) {
    const res = await send('/v1/source-latest');
    if (res?.status === 200) {
      const rows = (res.body?.sources ?? []).filter((r) => typeof r?.sourceId === 'string')
        .map((r) => ({ sourceId: r.sourceId, payload: r.value ?? null, fetchedAt: Number.isFinite(r.fetchedAt) ? r.fetchedAt : now() }));
      if (rows.length) await store.putSnapshots(rows);
      state.snapshots = true; state.snapshotCount = rows.length;
    }
  }
  state.done = SECTIONS.every((x) => state.sections[x]?.done) && state.snapshots;
  if (state.done) state.finishedAt = now();
  await store.setMeta(MIGRATION_KEY, state);
  return state;
}
