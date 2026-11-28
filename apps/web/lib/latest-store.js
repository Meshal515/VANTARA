/**
 * مخزن «آخر التحديثات» المحلي الدائم (خطة 27 نوفمبر، المرحلة 2).
 *
 * عقد واحد بثلاث خلفيات بالسلوك نفسه (يثبته latest-store.test.js على اثنتين منها):
 * - ويندوز: SQLite في مجلد بيانات المستخدم عبر `VantaraDesktop.latestStore` (apps/desktop/latest-store.cjs).
 * - أندرويد: SQLite أصلي عبر إضافة `LatestStore` (بالعقد نفسه).
 * - الويب: IndexedDB مع طلب التخزين الدائم. الويب للتتبع فقط فلا يكشف؛ يعرض المهاجَر والخيطين.
 *
 * قواعد لا تُكسر:
 * - **لا تصفير:** لا حذف ولا تقليم في هذا العقد إطلاقًا. المهاجَر `pinned` دائمًا.
 * - هوية الحدث `id` ثابتة. وقت الحدث يُثبَّت عند الإنشاء، وعند الدمج **الأقدم يفوز** (جهازان أو هجرة ثم كشف).
 * - المصادر تُدمج اتحادًا بمعرّفها `s`، والتثبيت لا يُلغى بكتابة لاحقة.
 * - لكل حساب قاعدة منفصلة.
 */

export const SCHEMA_VERSION = 1;
const SECTIONS = new Set(['manga', 'anime', 'cinema']);
const KINDS = new Set(['chapter', 'episode', 'movie']);
const str = (v, n) => (typeof v === 'string' && v ? v.slice(0, n) : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const int = (v) => (Number.isSafeInteger(v) ? v : null);

/** حدث كما يُحفظ. يرفض الناقص بدل أن يحفظ نصف حدث. */
export function normalizeEvent(e, { pinned = false, origin = 'local', now = Date.now() } = {}) {
  const id = str(e?.id, 300), work = str(e?.work, 220), title = str(e?.title, 300);
  const at = int(e?.at), firstSeenAt = int(e?.firstSeenAt ?? e?.first_seen_at) ?? at;
  if (!id || !work || !title || !SECTIONS.has(e?.section) || !KINDS.has(e?.kind) || at == null) return null;
  const sources = (Array.isArray(e.sources) ? e.sources : []).filter((x) => x && typeof x.s === 'string').slice(0, 40).map((x) => ({ ...x }));
  return {
    id, work, section: e.section, kind: e.kind, season: int(e.season), number: num(e.number), title,
    cover: str(e.cover, 1000), at, publishedAt: int(e.publishedAt ?? e.published_at), firstSeenAt,
    observedAdvance: Boolean(e.observedAdvance ?? e.observed_advance), sources,
    pinned: Boolean(pinned || e.pinned), origin: str(origin, 20) ?? 'local', updatedAt: now,
  };
}

/** دمج حدثين بنفس الهوية: الأقدم وقتًا يفوز، والمصادر اتحاد، والتثبيت لا يسقط. */
export function mergeEvent(old, next) {
  if (!old) return next;
  const sources = [...old.sources];
  for (const s of next.sources) if (!sources.some((x) => x.s === s.s)) sources.push(s);
  return {
    ...old,
    title: old.title || next.title, cover: old.cover ?? next.cover,
    at: Math.min(old.at, next.at), firstSeenAt: Math.min(old.firstSeenAt, next.firstSeenAt),
    publishedAt: old.publishedAt ?? next.publishedAt, observedAdvance: old.observedAdvance || next.observedAdvance,
    sources, pinned: old.pinned || next.pinned, origin: old.origin, updatedAt: Math.max(old.updatedAt, next.updatedAt),
  };
}

const cursorOf = (e) => `${e.at}~${e.id}`;
const parseCursor = (c) => { const [a, ...rest] = String(c ?? '').split('~'); const at = Number(a), id = rest.join('~'); return c && Number.isFinite(at) && id ? { at, id } : null; };

/** خلفية IndexedDB (الويب، والاحتياط حيث لا SQLite). */
export function createIndexedDbBackend(idb = globalThis.indexedDB) {
  if (!idb) throw new Error('IndexedDB غير متاح');
  const dbs = new Map();
  const open = (account) => {
    if (dbs.has(account)) return dbs.get(account);
    const p = new Promise((resolve, reject) => {
      const req = idb.open(`vantara-latest:${account}`, SCHEMA_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        const ev = db.createObjectStore('events', { keyPath: 'id' });
        ev.createIndex('timeline', ['section', 'at', 'id']);
        ev.createIndex('work', ['work', 'at', 'id']);
        db.createObjectStore('marks', { keyPath: 'work' });
        db.createObjectStore('sourceMarks', { keyPath: ['work', 'sourceId'] });
        db.createObjectStore('snapshots', { keyPath: 'sourceId' });
        db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbs.set(account, p);
    return p;
  };
  const tx = async (account, stores, mode, fn) => {
    const db = await open(account);
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode); let out;
      Promise.resolve(fn(t)).then((v) => { out = v; }, (e) => { try { t.abort(); } catch {} reject(e); });
      t.oncomplete = () => resolve(out); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error ?? new Error('أُلغيت المعاملة'));
    });
  };
  const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  return {
    kind: 'indexeddb',
    async putEvents({ account, events }) {
      return tx(account, ['events'], 'readwrite', async (t) => {
        const s = t.objectStore('events'); let inserted = 0, updated = 0;
        for (const e of events) { const old = await req(s.get(e.id)); old ? updated++ : inserted++; s.put(mergeEvent(old, e)); }
        return { inserted, updated };
      });
    },
    async timeline({ account, section, before, limit, work }) {
      return tx(account, ['events'], 'readonly', (t) => new Promise((resolve, reject) => {
        const s = t.objectStore('events'), c = parseCursor(before), out = [];
        const range = work
          ? IDBKeyRange.bound([work, -Infinity, ''], c ? [work, c.at, c.id] : [work, Infinity, '￿'], false, !!c)
          : IDBKeyRange.bound([section, -Infinity, ''], c ? [section, c.at, c.id] : [section, Infinity, '￿'], false, !!c);
        const r = s.index(work ? 'work' : 'timeline').openCursor(range, 'prev');
        r.onsuccess = () => { const cur = r.result; if (!cur || out.length > limit) { resolve(out); return; } if (!work || cur.value.section === section) out.push(cur.value); cur.continue(); };
        r.onerror = () => reject(r.error);
      }));
    },
    async getEvent({ account, id }) { return tx(account, ['events'], 'readonly', (t) => req(t.objectStore('events').get(id))); },
    async getMarks({ account, works }) { return tx(account, ['marks'], 'readonly', async (t) => (await Promise.all(works.map((w) => req(t.objectStore('marks').get(w))))).filter(Boolean)); },
    async putMarks({ account, marks }) { return tx(account, ['marks'], 'readwrite', (t) => { for (const m of marks) t.objectStore('marks').put(m); return marks.length; }); },
    async getSourceMarks({ account, work }) { return tx(account, ['sourceMarks'], 'readonly', (t) => req(t.objectStore('sourceMarks').getAll(IDBKeyRange.bound([work, ''], [work, '￿'])))); },
    async putSourceMarks({ account, marks }) { return tx(account, ['sourceMarks'], 'readwrite', (t) => { for (const m of marks) t.objectStore('sourceMarks').put(m); return marks.length; }); },
    async putSnapshots({ account, rows }) { return tx(account, ['snapshots'], 'readwrite', (t) => { for (const r of rows) t.objectStore('snapshots').put(r); return rows.length; }); },
    async getSnapshot({ account, sourceId }) { return tx(account, ['snapshots'], 'readonly', (t) => req(t.objectStore('snapshots').get(sourceId))); },
    async getMeta({ account, key }) { return tx(account, ['meta'], 'readonly', async (t) => (await req(t.objectStore('meta').get(key)))?.value ?? null); },
    async setMeta({ account, key, value }) { return tx(account, ['meta'], 'readwrite', (t) => { t.objectStore('meta').put({ key, value }); return true; }); },
    async stats({ account }) {
      return tx(account, ['events', 'marks'], 'readonly', async (t) => {
        const all = await req(t.objectStore('events').getAll());
        return { events: all.length, pinned: all.filter((e) => e.pinned).length, marks: await req(t.objectStore('marks').count()) };
      });
    },
    close() { for (const p of dbs.values()) p.then((d) => d.close()).catch(() => {}); dbs.clear(); },
  };
}

/** الخلفية المناسبة لهذه المنصة: SQLite في ويندوز وأندرويد، وإلا IndexedDB. */
export function pickBackend({ desktop = globalThis.VantaraDesktop, plugins = globalThis.Capacitor?.Plugins, idb = globalThis.indexedDB } = {}) {
  const call = typeof desktop?.latestStore === 'function' ? (method, args) => desktop.latestStore({ method, args })
    : typeof plugins?.LatestStore?.call === 'function' ? (method, args) => plugins.LatestStore.call({ method, args }).then((r) => r?.value) : null;
  if (call) {
    const m = (name) => (args) => call(name, args);
    return { kind: desktop?.latestStore ? 'sqlite-desktop' : 'sqlite-android', putEvents: m('putEvents'), timeline: m('timeline'), getEvent: m('getEvent'), getMarks: m('getMarks'), putMarks: m('putMarks'), getSourceMarks: m('getSourceMarks'), putSourceMarks: m('putSourceMarks'), putSnapshots: m('putSnapshots'), getSnapshot: m('getSnapshot'), getMeta: m('getMeta'), setMeta: m('setMeta'), stats: m('stats'), close() {} };
  }
  return createIndexedDbBackend(idb);
}

/** واجهة المخزن لحساب واحد. كل ما يدخل يُطبَّع، وما يخرج بشكل `/v1/updates` نفسه. */
export function openLatestStore({ account, backend = pickBackend() } = {}) {
  const acc = String(account ?? '').slice(0, 160);
  if (!acc) throw new Error('الحساب مطلوب لمخزن آخر التحديثات');
  // الويب: اطلب ألا يُطرد التخزين تحت الضغط (أفضل المتاح في المتصفح)
  if (backend.kind === 'indexeddb') void globalThis.navigator?.storage?.persist?.().catch?.(() => {});
  return {
    account: acc, kind: backend.kind,
    async putEvents(events, opts = {}) {
      const rows = (events ?? []).map((e) => normalizeEvent(e, opts)).filter(Boolean);
      if (!rows.length) return { inserted: 0, updated: 0, rejected: (events ?? []).length };
      const out = await backend.putEvents({ account: acc, events: rows });
      return { ...out, rejected: (events ?? []).length - rows.length };
    },
    async timeline(section, { before = null, limit = 40, work = null } = {}) {
      if (!SECTIONS.has(section)) throw new Error('قسم غير معروف');
      const n = Math.min(100, Math.max(1, Number(limit) || 40));
      const rows = await backend.timeline({ account: acc, section, before, limit: n, work });
      const page = rows.slice(0, n), last = page[page.length - 1];
      return { events: page.map(({ pinned, origin, updatedAt, ...e }) => e), next: rows.length > n && last ? cursorOf(last) : null };
    },
    getEvent: (id) => backend.getEvent({ account: acc, id }),
    getMarks: (works) => backend.getMarks({ account: acc, works: [...new Set(works)] }),
    putMarks: (marks) => backend.putMarks({ account: acc, marks }),
    getSourceMarks: (work) => backend.getSourceMarks({ account: acc, work }),
    putSourceMarks: (marks) => backend.putSourceMarks({ account: acc, marks }),
    putSnapshots: (rows) => backend.putSnapshots({ account: acc, rows }),
    getSnapshot: (sourceId) => backend.getSnapshot({ account: acc, sourceId }),
    getMeta: (key) => backend.getMeta({ account: acc, key }),
    setMeta: (key, value) => backend.setMeta({ account: acc, key, value }),
    stats: () => backend.stats({ account: acc }),
  };
}
