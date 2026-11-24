const { createHash } = require('node:crypto');
const { isMainThread, parentPort, workerData, Worker } = require('node:worker_threads');

// Keep the bridge limits in sync with Android's LocalDiscoveryPlugin.
const MAX_REQUESTS = 8;
const MAX_BATCH = 256;
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_ROW_BYTES = 32 * 1024;
const MAX_ID = 8192;
const MAX_TITLE = 1024;
const MAX_SOURCE_ID = 512;
const MAX_URL = 2048;
const SECTIONS = new Set(['manga', 'anime', 'cinema']);
const KINDS = new Set(['chapter', 'episode', 'movie']);
const SOURCE_FIELDS = ['s', 'u', 't', 'c'];
// Keep the public reference rules in sync with web's discovery-store.js.
const PUBLIC_QUERY = new Set(['id', 'work_id', 'manga_id', 'series_id', 'slug', 'manga', 'series', 'story', 'w', 'h', 'width', 'height', 'format']);
const ROW_FIELDS = ['id', 'work', 'section', 'title', 'firstSeenAt', 'lastCheckedAt'];
const EDITION_FIELDS = [...ROW_FIELDS, 'sourceId', 'source', 'lastChapterCheckAt', 'baselines'];
const EVENT_FIELDS = [...ROW_FIELDS, 'kind', 'number', 'season', 'cover', 'sources', 'at', 'publishedAt', 'updatedAt'];

class DiscoveryInputError extends Error {}

function requireInput(valid) {
  if (!valid) throw new DiscoveryInputError('invalid_discovery_request');
}

function requireSize(valid) {
  if (!valid) throw new DiscoveryInputError('discovery_request_too_large');
}

function isRecord(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function shape(value, required, optional = []) {
  requireInput(isRecord(value));
  const keys = Object.keys(value);
  requireInput(keys.length <= required.length + optional.length &&
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key)));
}

function array(value, maxLength) {
  requireInput(Array.isArray(value));
  requireSize(value.length <= maxLength);
  requireInput(Object.keys(value).length === value.length);
}

function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  requireInput(Number.isSafeInteger(value) && value >= min && value <= max);
}

function unit(value) {
  requireInput(Number.isFinite(value) && value >= 0 && value <= 100_000);
}

function text(value, max, min = 1) {
  requireInput(typeof value === 'string' && value.length >= min && value.length <= max && !value.includes('\0'));
}

const size = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');

function validateRow(row, isEdition) {
  shape(row, isEdition ? EDITION_FIELDS : EVENT_FIELDS);

  // Bound the work needed to serialize each row before measuring its exact size.
  let textLength = 0;
  function rowText(value, max, min) {
    text(value, max, min);
    textLength += value.length;
    requireSize(textLength <= MAX_ROW_BYTES);
  }
  function reference(value) {
    rowText(value, MAX_URL);
    requireInput(isPublicReference(value));
  }
  function source(value) {
    shape(value, [], SOURCE_FIELDS);
    if (Object.hasOwn(value, 's')) rowText(value.s, MAX_SOURCE_ID, 0);
    if (Object.hasOwn(value, 'u')) reference(value.u);
    if (Object.hasOwn(value, 't')) rowText(value.t, MAX_TITLE, 0);
    if (Object.hasOwn(value, 'c')) requireInput(typeof value.c === 'boolean');
  }

  rowText(row.id, MAX_ID);
  rowText(row.work, MAX_TITLE);
  rowText(row.title, MAX_TITLE);
  requireInput(SECTIONS.has(row.section));
  integer(row.firstSeenAt);
  integer(row.lastCheckedAt);
  if (isEdition) {
    rowText(row.sourceId, MAX_SOURCE_ID, 0);
    source(row.source);
    integer(row.lastChapterCheckAt);
    array(row.baselines, 512);
    for (const pair of row.baselines) {
      array(pair, 2);
      requireInput(pair.length === 2);
      integer(pair[0]);
      unit(pair[1]);
    }
  } else {
    requireInput(KINDS.has(row.kind));
    unit(row.number);
    if (row.season !== null) integer(row.season, 1);
    if (row.cover !== null) reference(row.cover);
    integer(row.at);
    if (row.publishedAt !== null) integer(row.publishedAt);
    integer(row.updatedAt);
    array(row.sources, 64);
    for (const entry of row.sources) source(entry);
  }
}

function validateRequest(input) {
  requireInput(isRecord(input) && Object.hasOwn(input, 'action'));
  switch (input.action) {
    case 'snapshot':
    case 'commit': {
      const commit = input.action === 'commit';
      shape(input, commit ? ['action', 'editions', 'events', 'rev'] : ['action', 'editions', 'events']);
      if (commit) integer(input.rev);
      array(input.editions, MAX_BATCH);
      array(input.events, MAX_BATCH);
      requireSize(input.editions.length + input.events.length <= MAX_BATCH);
      let bytes = size({ ...input, editions: [], events: [] });
      for (const [rows, isEdition] of [[input.editions, true], [input.events, false]]) {
        if (rows.length) bytes -= 1;
        for (const row of rows) {
          if (commit) validateRow(row, isEdition);
          else text(row, MAX_ID);
          const rowBytes = size(row);
          if (commit) requireSize(rowBytes <= MAX_ROW_BYTES);
          bytes += rowBytes + 1;
          requireSize(bytes <= MAX_REQUEST_BYTES);
        }
      }
      break;
    }
    case 'timeline':
      shape(input, ['action', 'section'], ['cursor', 'limit']);
      requireInput(SECTIONS.has(input.section));
      if (Object.hasOwn(input, 'cursor') && input.cursor !== null) {
        requireInput(Array.isArray(input.cursor) && input.cursor.length === 2);
        array(input.cursor, 2);
        // Legacy archives may have saved fractional publication times.
        const at = input.cursor[0];
        requireInput(Number.isFinite(at) && at >= 0 && at <= Number.MAX_SAFE_INTEGER);
        text(input.cursor[1], MAX_ID);
      }
      if (Object.hasOwn(input, 'limit')) integer(input.limit, 1, 101);
      break;
    case 'known':
      shape(input, ['action', 'sourceId'], ['limit']);
      text(input.sourceId, MAX_SOURCE_ID, 0);
      if (Object.hasOwn(input, 'limit')) integer(input.limit, 1, 101);
      break;
    default:
      requireInput(false);
  }
}

function isPublicReference(value) {
  if (typeof value !== 'string' || !value || value.length > MAX_URL || Buffer.byteLength(value) > MAX_URL ||
      /[\u0000-\u0020\\#]/.test(value)) return false;
  try {
    const url = new URL(value, 'https://discovery.invalid/');
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password &&
      [...url.searchParams].every(([name, part]) => PUBLIC_QUERY.has(name) && /^[a-z0-9_.-]{1,80}$/i.test(part));
  } catch { return false; }
}

function scrubLegacySource(source) {
  if (!isRecord(source)) return false;
  let changed = false;
  if (Object.hasOwn(source, 'm')) {
    delete source.m;
    source.c = true;
    changed = true;
  }
  if (Object.hasOwn(source, 'u') && !isPublicReference(source.u)) {
    delete source.u;
    changed = true;
  }
  return changed;
}

function removeLegacyPrivateFields(db) {
  for (const table of ['editions', 'events']) {
    const edition = table === 'editions';
    const first = db.prepare(`SELECT rowid,id,payload FROM ${table} ORDER BY rowid LIMIT 32`);
    const next = db.prepare(`SELECT rowid,id,payload FROM ${table} WHERE rowid > ? ORDER BY rowid LIMIT 32`);
    first.setReadBigInts(true);
    next.setReadBigInts(true);
    const update = db.prepare(`UPDATE ${table} SET payload = ? WHERE rowid = ?`);
    const rekey = edition ? db.prepare('UPDATE editions SET id = ?, payload = ? WHERE rowid = ?') : null;
    for (let page = first.all(); page.length; page = next.all(page.at(-1).rowid)) {
      for (const { rowid, id, payload } of page) {
        const row = JSON.parse(payload);
        let changed = false;
        const oldUrl = edition ? row.source?.u : null;
        const sources = edition ? [row.source] : row.sources;
        if (Array.isArray(sources)) for (const source of sources) {
          if (scrubLegacySource(source)) changed = true;
        }
        if (!edition && row.cover != null && !isPublicReference(row.cover)) {
          row.cover = null;
          changed = true;
        }
        if (edition && typeof id === 'string' && typeof oldUrl === 'string' && oldUrl && !row.source.u &&
            (id.includes(oldUrl) || id.includes(JSON.stringify(oldUrl)))) {
          row.id = `legacy:${createHash('sha256').update(id).digest('hex')}`;
          rekey.run(row.id, JSON.stringify(row), rowid);
        } else if (changed) {
          update.run(JSON.stringify(row), rowid);
        }
      }
    }
  }
}

function openDiscovery(filename) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(filename);
  function transaction(verb, task) {
    db.exec(verb);
    try { const result = task(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  try {
    db.exec('PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON');
    const userVersion = db.prepare('PRAGMA user_version');
    const version = userVersion.get().user_version;
    if (version > 2) throw new Error('unsupported_discovery_schema');
    if (version < 2) {
      const migrated = transaction('BEGIN IMMEDIATE', () => {
        const current = userVersion.get().user_version;
        if (current === 2) return false;
        if (current > 2) throw new Error('unsupported_discovery_schema');
        if (current === 0) db.exec(`
          CREATE TABLE IF NOT EXISTS discovery_meta (id INTEGER PRIMARY KEY, rev INTEGER NOT NULL);
          INSERT OR IGNORE INTO discovery_meta VALUES (1, 0);
          CREATE TABLE IF NOT EXISTS editions (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, checked_at INTEGER NOT NULL, payload TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS editions_source ON editions(source_id, checked_at, id);
          CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, section TEXT NOT NULL, at INTEGER NOT NULL, payload TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS events_timeline ON events(section, at DESC, id DESC);
        `);
        if (current === 1) removeLegacyPrivateFields(db);
        db.exec('PRAGMA user_version=2');
        return current === 1;
      });
      if (migrated) {
        // The upgrade is committed. A concurrent reader can delay WAL truncation.
        try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* SQLite can checkpoint later. */ }
      }
    }
  } catch (error) {
    db.close();
    throw error;
  }
  const revision = db.prepare('SELECT rev FROM discovery_meta WHERE id = 1');
  const findEdition = db.prepare('SELECT payload FROM editions WHERE id = ?');
  const findEvent = db.prepare('SELECT payload FROM events WHERE id = ?');
  const upsertEdition = db.prepare('INSERT INTO editions VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_id=excluded.source_id, checked_at=excluded.checked_at, payload=excluded.payload');
  const upsertEvent = db.prepare('INSERT INTO events VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET section=excluded.section, at=excluded.at, payload=excluded.payload');
  const latest = db.prepare('SELECT payload FROM events WHERE section = ? ORDER BY at DESC, id DESC LIMIT ?');
  const older = db.prepare('SELECT payload FROM events WHERE section = ? AND (at,id) < (?,?) ORDER BY at DESC,id DESC LIMIT ?');
  const known = db.prepare('SELECT payload FROM editions WHERE source_id = ? ORDER BY checked_at, id LIMIT ?');
  const advance = db.prepare('UPDATE discovery_meta SET rev = rev + 1 WHERE id = 1');
  const parse = (row) => JSON.parse(row.payload);
  function request(input) {
    validateRequest(input);
    const limit = input.limit ?? 40;
    switch (input.action) {
      case 'snapshot':
        return transaction('BEGIN', () => ({
          rev: revision.get().rev,
          editions: input.editions.map((id) => findEdition.get(id)).filter(Boolean).map(parse),
          events: input.events.map((id) => findEvent.get(id)).filter(Boolean).map(parse),
        }));
      case 'commit':
        return transaction('BEGIN IMMEDIATE', () => {
          if (revision.get().rev !== input.rev) return { committed: false };
          for (const entry of input.editions) upsertEdition.run(entry.id, entry.sourceId, entry.lastChapterCheckAt, JSON.stringify(entry));
          for (const entry of input.events) upsertEvent.run(entry.id, entry.section, entry.at, JSON.stringify(entry));
          advance.run();
          return { committed: true };
        });
      case 'timeline':
        return { rows: (input.cursor ? older.all(input.section, ...input.cursor, limit) : latest.all(input.section, limit)).map(parse) };
      case 'known':
        return { rows: known.all(input.sourceId, limit).map(parse) };
    }
  }
  return { request, close: () => db.close() };
}

function createDiscoveryWorker(filename) {
  const worker = new Worker(__filename, { workerData: filename });
  const pending = new Map();
  let sequence = 0;
  let failure = null;
  function fail(error) {
    failure = error;
    for (const promise of pending.values()) promise.reject(error);
    pending.clear();
  }
  worker.on('message', ({ id, value, error }) => {
    const promise = pending.get(id);
    if (!promise) return;
    pending.delete(id);
    if (!pending.size) worker.unref();
    if (error) promise.reject(new Error(error));
    else promise.resolve(value);
  });
  worker.on('error', () => fail(new Error('discovery_storage_error')));
  worker.on('exit', () => fail(new Error('discovery_worker_exited')));
  worker.unref();
  return (input) => {
    if (failure) return Promise.reject(failure);
    if (pending.size >= MAX_REQUESTS) return Promise.reject(new Error('discovery_busy'));
    try { validateRequest(input); }
    catch (error) {
      return Promise.reject(error instanceof DiscoveryInputError ? error : new Error('invalid_discovery_request'));
    }
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      worker.ref();
      pending.set(id, { resolve, reject });
      try { worker.postMessage({ id, input }); }
      catch {
        pending.delete(id);
        if (!pending.size) worker.unref();
        reject(new Error('discovery_storage_error'));
      }
    });
  };
}

if (!isMainThread) {
  const storage = openDiscovery(workerData);
  parentPort.on('message', ({ id, input }) => {
    try { parentPort.postMessage({ id, value: storage.request(input) }); }
    catch (error) {
      parentPort.postMessage({ id, error: error instanceof DiscoveryInputError ? error.message : 'discovery_storage_error' });
    }
  });
}

module.exports = { openDiscovery, createDiscoveryWorker };
