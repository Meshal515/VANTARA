'use strict';
/**
 * مخزن «آخر التحديثات» في ويندوز: SQLite (`node:sqlite` في Electron) في مجلد بيانات المستخدم، قاعدة لكل حساب.
 * العقد نفسه في apps/web/lib/latest-store.js (IndexedDB) وأندرويد، ويثبت تطابقها اختبار عقد واحد.
 * لا حذف ولا تقليم هنا إطلاقًا (قرار المالك: لا تصفير). كل كتابة داخل معاملة.
 */
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const SCHEMA_VERSION = 1;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, work TEXT NOT NULL, section TEXT NOT NULL, kind TEXT NOT NULL,
  season INTEGER, number REAL, title TEXT NOT NULL, cover TEXT,
  at INTEGER NOT NULL, published_at INTEGER, first_seen_at INTEGER NOT NULL,
  observed_advance INTEGER NOT NULL DEFAULT 0, sources TEXT NOT NULL DEFAULT '[]',
  pinned INTEGER NOT NULL DEFAULT 0, origin TEXT NOT NULL DEFAULT 'local', updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_timeline ON events (section, at DESC, id DESC);
CREATE INDEX IF NOT EXISTS events_work ON events (work, at DESC, id DESC);
CREATE TABLE IF NOT EXISTS marks (work TEXT PRIMARY KEY, section TEXT, season INTEGER, number REAL, baseline_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS source_marks (work TEXT NOT NULL, source_id TEXT NOT NULL, season INTEGER, number REAL NOT NULL, updated_at INTEGER, PRIMARY KEY (work, source_id));
CREATE TABLE IF NOT EXISTS snapshots (source_id TEXT PRIMARY KEY, payload TEXT, fetched_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`;
const METHODS = new Set(['putEvents', 'timeline', 'getEvent', 'getMarks', 'putMarks', 'getSourceMarks', 'putSourceMarks', 'putSnapshots', 'getSnapshot', 'getMeta', 'setMeta', 'stats']);

const toRow = (e) => ({ id: e.id, work: e.work, section: e.section, kind: e.kind, season: e.season ?? null, number: e.number ?? null, title: e.title, cover: e.cover ?? null, at: e.at, published_at: e.publishedAt ?? null, first_seen_at: e.firstSeenAt, observed_advance: e.observedAdvance ? 1 : 0, sources: JSON.stringify(e.sources ?? []), pinned: e.pinned ? 1 : 0, origin: e.origin ?? 'local', updated_at: e.updatedAt });
const fromRow = (r) => r && ({ id: r.id, work: r.work, section: r.section, kind: r.kind, season: r.season, number: r.number, title: r.title, cover: r.cover, at: r.at, publishedAt: r.published_at, firstSeenAt: r.first_seen_at, observedAdvance: r.observed_advance === 1, sources: JSON.parse(r.sources || '[]'), pinned: r.pinned === 1, origin: r.origin, updatedAt: r.updated_at });
// القاعدة نفسها في lib/latest-store.js (mergeEvent): الأقدم وقتًا يفوز، والمصادر اتحاد، والتثبيت لا يسقط
function mergeEvent(old, next) {
  if (!old) return next;
  const sources = [...old.sources];
  for (const s of next.sources) if (!sources.some((x) => x.s === s.s)) sources.push(s);
  return { ...old, title: old.title || next.title, cover: old.cover ?? next.cover, at: Math.min(old.at, next.at), firstSeenAt: Math.min(old.firstSeenAt, next.firstSeenAt), publishedAt: old.publishedAt ?? next.publishedAt, observedAdvance: old.observedAdvance || next.observedAdvance, sources, pinned: old.pinned || next.pinned, origin: old.origin, updatedAt: Math.max(old.updatedAt, next.updatedAt) };
}

function createSqliteLatestStore({ dir, DatabaseSync = require('node:sqlite').DatabaseSync }) {
  fs.mkdirSync(dir, { recursive: true });
  const dbs = new Map();
  const db = (account) => {
    const key = String(account ?? '');
    if (!key) throw new Error('الحساب مطلوب');
    if (dbs.has(key)) return dbs.get(key);
    // اسم الملف بصمة الحساب: لا يظهر معرّف الحساب في مسار على القرص
    const file = path.join(dir, `latest-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 24)}.sqlite`);
    const d = new DatabaseSync(file);
    d.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
    const v = d.prepare('PRAGMA user_version').get().user_version;
    if (v > SCHEMA_VERSION) throw new Error('قاعدة آخر التحديثات أحدث من هذا الإصدار؛ لن تُلمس');
    d.exec(SCHEMA);
    if (v < SCHEMA_VERSION) d.exec(`PRAGMA user_version=${SCHEMA_VERSION}`);
    dbs.set(key, d);
    return d;
  };
  const tx = (d, fn) => { d.exec('BEGIN IMMEDIATE'); try { const out = fn(); d.exec('COMMIT'); return out; } catch (e) { d.exec('ROLLBACK'); throw e; } };
  const api = {
    putEvents({ account, events }) {
      const d = db(account);
      const get = d.prepare('SELECT * FROM events WHERE id = ?');
      const put = d.prepare(`INSERT OR REPLACE INTO events (id, work, section, kind, season, number, title, cover, at, published_at, first_seen_at, observed_advance, sources, pinned, origin, updated_at)
        VALUES (:id, :work, :section, :kind, :season, :number, :title, :cover, :at, :published_at, :first_seen_at, :observed_advance, :sources, :pinned, :origin, :updated_at)`);
      return tx(d, () => {
        let inserted = 0, updated = 0;
        for (const e of events) { const old = fromRow(get.get(e.id)); old ? updated++ : inserted++; put.run(toRow(mergeEvent(old, e))); }
        return { inserted, updated };
      });
    },
    timeline({ account, section, before, limit, work }) {
      const d = db(account);
      const [a, ...rest] = String(before ?? '').split('~'); const at = Number(a), id = rest.join('~');
      const cur = before && Number.isFinite(at) && id;
      const where = ['section = ?'], binds = [section];
      if (work) { where.push('work = ?'); binds.push(work); }
      if (cur) { where.push('(at < ? OR (at = ? AND id < ?))'); binds.push(at, at, id); }
      return d.prepare(`SELECT * FROM events WHERE ${where.join(' AND ')} ORDER BY at DESC, id DESC LIMIT ?`).all(...binds, limit + 1).map(fromRow);
    },
    getEvent({ account, id }) { return fromRow(db(account).prepare('SELECT * FROM events WHERE id = ?').get(id)) ?? null; },
    getMarks({ account, works }) {
      const d = db(account); const q = d.prepare('SELECT work, section, season, number, baseline_at AS baselineAt, updated_at AS updatedAt FROM marks WHERE work = ?');
      return works.map((w) => q.get(w)).filter(Boolean).map((r) => ({ ...r }));
    },
    putMarks({ account, marks }) {
      const d = db(account); const q = d.prepare('INSERT OR REPLACE INTO marks (work, section, season, number, baseline_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
      return tx(d, () => { for (const m of marks) q.run(m.work, m.section ?? null, m.season ?? null, m.number ?? null, m.baselineAt ?? null, m.updatedAt ?? null); return marks.length; });
    },
    getSourceMarks({ account, work }) { return db(account).prepare('SELECT work, source_id AS sourceId, season, number, updated_at AS updatedAt FROM source_marks WHERE work = ? ORDER BY source_id').all(work).map((r) => ({ ...r })); },
    putSourceMarks({ account, marks }) {
      const d = db(account); const q = d.prepare('INSERT OR REPLACE INTO source_marks (work, source_id, season, number, updated_at) VALUES (?, ?, ?, ?, ?)');
      return tx(d, () => { for (const m of marks) q.run(m.work, m.sourceId, m.season ?? null, m.number, m.updatedAt ?? null); return marks.length; });
    },
    putSnapshots({ account, rows }) {
      const d = db(account); const q = d.prepare('INSERT OR REPLACE INTO snapshots (source_id, payload, fetched_at) VALUES (?, ?, ?)');
      return tx(d, () => { for (const r of rows) q.run(r.sourceId, JSON.stringify(r.payload ?? null), r.fetchedAt ?? 0); return rows.length; });
    },
    getSnapshot({ account, sourceId }) { const r = db(account).prepare('SELECT source_id, payload, fetched_at FROM snapshots WHERE source_id = ?').get(sourceId); return r ? { sourceId: r.source_id, payload: JSON.parse(r.payload ?? 'null'), fetchedAt: r.fetched_at } : null; },
    getMeta({ account, key }) { const r = db(account).prepare('SELECT value FROM meta WHERE key = ?').get(key); return r ? JSON.parse(r.value) : null; },
    setMeta({ account, key, value }) { db(account).prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, JSON.stringify(value ?? null)); return true; },
    stats({ account }) {
      const d = db(account);
      return { events: d.prepare('SELECT COUNT(*) n FROM events').get().n, pinned: d.prepare('SELECT COUNT(*) n FROM events WHERE pinned = 1').get().n, marks: d.prepare('SELECT COUNT(*) n FROM marks').get().n };
    },
  };
  return {
    ...api,
    /** مدخل القناة الوحيد من الواجهة: أسماء معروفة فقط. */
    call({ method, args } = {}) { if (!METHODS.has(method)) throw new Error('عملية غير معروفة على مخزن آخر التحديثات'); return api[method](args ?? {}); },
    close() { for (const d of dbs.values()) try { d.close(); } catch {} dbs.clear(); },
  };
}

module.exports = { createSqliteLatestStore, SCHEMA, SCHEMA_VERSION, mergeEvent };
