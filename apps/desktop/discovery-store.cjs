const { isMainThread, parentPort, workerData, Worker } = require('node:worker_threads');

function openDiscovery(filename) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 1) throw new Error('unsupported_discovery_schema');
  if (version === 0) db.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS discovery_meta (id INTEGER PRIMARY KEY, rev INTEGER NOT NULL);
    INSERT OR IGNORE INTO discovery_meta VALUES (1, 0);
    CREATE TABLE IF NOT EXISTS editions (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, checked_at INTEGER NOT NULL, payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS editions_source ON editions(source_id, checked_at, id);
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, section TEXT NOT NULL, at INTEGER NOT NULL, payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS events_timeline ON events(section, at DESC, id DESC);
    PRAGMA user_version=1;
    COMMIT;
  `);
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
  const limit = (value) => Math.max(1, Math.min(101, Number.isSafeInteger(value) ? value : 40));
  function transaction(verb, task) {
    db.exec(verb);
    try { const result = task(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function request(input) {
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
        return { rows: (input.cursor ? older.all(input.section, ...input.cursor, limit(input.limit)) : latest.all(input.section, limit(input.limit))).map(parse) };
      case 'known':
        return { rows: known.all(input.sourceId, limit(input.limit)).map(parse) };
      default:
        throw new Error('invalid_discovery_action');
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
    if (error) promise.reject(new Error(error));
    else promise.resolve(value);
  });
  worker.on('error', fail);
  worker.on('exit', () => fail(new Error('discovery_worker_exited')));
  worker.unref();
  return (input) => {
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, input });
    });
  };
}

if (!isMainThread) {
  const storage = openDiscovery(workerData);
  parentPort.on('message', ({ id, input }) => {
    try { parentPort.postMessage({ id, value: storage.request(input) }); }
    catch (error) { parentPort.postMessage({ id, error: error.message }); }
  });
}

module.exports = { openDiscovery, createDiscoveryWorker };
