// جهاز واحد يملك نسخ المصادر وأحداثها. فهارس IndexedDB تقرأ صفحة أو مصدرًا واحدًا.
const DATABASE = 'vantara-local-discovery';
const SECTIONS = new Set(['manga', 'anime', 'cinema']);
const KINDS = new Set(['chapter', 'episode', 'movie']);
const FIRST_LOOKBACK = 14 * 86_400_000;
const EARLIEST_RELEASE = Date.UTC(2000, 0, 1);

function result(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function committed(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('discovery_transaction_aborted'));
  });
}

function publicationTimes(units, checkedAt) {
  const dates = units.map((unit) => {
    const at = unit?.publishedAt;
    return Number.isFinite(at) && at >= EARLIEST_RELEASE && at <= checkedAt ? at : null;
  });
  const dated = dates.filter((at) => at !== null);
  // بعض المصادر تعطي وقت الجلب نفسه لدفعة كبيرة من الفصول.
  if (dated.length >= 10 && Math.max(...dated) - Math.min(...dated) < 60_000) return dates.map(() => null);
  return dates;
}

function newerSourceList(saved, source) {
  if (!source.s) return saved;
  const index = saved.findIndex((prior) => prior.s === source.s);
  if (index < 0) return [...saved, source];
  if (JSON.stringify(saved[index]) === JSON.stringify(source)) return saved;
  return saved.map((prior, i) => i === index ? source : prior);
}

async function applyReports(reports, checkedAt, { getEdition, getEvent, putEdition, putEvent }) {
  for (const report of reports) {
    if (!SECTIONS.has(report?.section) || !KINDS.has(report.kind) || typeof report.work !== 'string' ||
        !report.work || typeof report.title !== 'string' || !report.title) continue;
    const units = Array.isArray(report.units) ? report.units : [];
    const published = publicationTimes(units, checkedAt);
    const source = report.source ?? {};
    const sourceId = String(source.s ?? '');
    const sourceKey = [report.section, sourceId, source.u || report.work];
    const id = JSON.stringify(sourceKey);
    const prior = await getEdition(id);
    const high = new Map(prior?.baselines ?? []);
    const advanced = new Map(high);
    for (const [index, unit] of units.entries()) {
      const number = report.kind === 'movie' ? 0 : unit?.number;
      if (!Number.isFinite(number) || number < 0 || number > 100_000) continue;
      const season = Number.isSafeInteger(unit?.season) && unit.season > 0 ? unit.season : 0;
      const baseline = high.get(season);
      if ((advanced.get(season) ?? -1) < number) advanced.set(season, number);
      const eventId = JSON.stringify([report.section, report.work, report.kind, season, number]);
      const existing = await getEvent(eventId);
      const publishedAt = published[index];
      if (!existing && (publishedAt === null
        ? baseline === undefined || number <= baseline
        : baseline === undefined && publishedAt < checkedAt - FIRST_LOOKBACK)) continue;

      const firstSeenAt = existing?.firstSeenAt ?? checkedAt;
      const release = existing?.publishedAt == null ? publishedAt
        : publishedAt == null ? existing.publishedAt : Math.min(existing.publishedAt, publishedAt);
      const previousSources = existing?.sources ?? [];
      const sources = newerSourceList(previousSources, source);
      const cover = existing?.cover ?? report.cover ?? null;
      const changed = !existing || existing.publishedAt !== release || existing.sources !== sources ||
        existing.title !== report.title || existing.cover !== cover;
      putEvent({
        id: eventId, work: report.work, section: report.section, kind: report.kind, number,
        season: season || null, title: report.title, cover, sources, firstSeenAt,
        at: release ?? firstSeenAt, publishedAt: release,
        lastCheckedAt: Math.max(existing?.lastCheckedAt ?? 0, checkedAt),
        updatedAt: changed ? Math.max(existing?.updatedAt ?? 0, checkedAt) : existing.updatedAt,
      });
    }
    putEdition({
      id, sourceId, work: report.work, section: report.section, title: report.title, source,
      firstSeenAt: prior?.firstSeenAt ?? checkedAt,
      lastCheckedAt: Math.max(prior?.lastCheckedAt ?? 0, checkedAt),
      lastChapterCheckAt: Math.max(prior?.lastChapterCheckAt ?? 0, units.length ? checkedAt : 0),
      baselines: [...advanced],
    });
  }
}

function reportKeys(reports) {
  const editions = new Set(), events = new Set();
  for (const row of reports) {
    if (!SECTIONS.has(row?.section) || !KINDS.has(row.kind) || typeof row.work !== 'string') continue;
    editions.add(JSON.stringify([row.section, String(row.source?.s ?? ''), row.source?.u || row.work]));
    for (const unit of Array.isArray(row.units) ? row.units : []) {
      const number = row.kind === 'movie' ? 0 : unit?.number;
      if (!Number.isFinite(number) || number < 0 || number > 100_000) continue;
      const season = Number.isSafeInteger(unit?.season) && unit.season > 0 ? unit.season : 0;
      events.add(JSON.stringify([row.section, row.work, row.kind, season, number]));
    }
  }
  return { editions: [...editions], events: [...events] };
}

function parsePage(before, limit, defaultLimit) {
  let cursor;
  try { cursor = JSON.parse(before); } catch { /* first page */ }
  const valid = Array.isArray(cursor) && cursor.length === 2 &&
    Number.isFinite(cursor[0]) && cursor[0] >= 0 && typeof cursor[1] === 'string';
  return { cursor: valid ? cursor : null, count: Math.max(1, Math.min(100, Math.trunc(Number(limit) || defaultLimit))) };
}

function timelinePage(events, count) {
  const more = events.length > count;
  const visible = more ? events.slice(0, count) : events;
  const last = visible.at(-1);
  return { events: visible, next: more ? JSON.stringify([last.at, last.id]) : null, snapshotAt: Date.now() };
}

/** يحسب الدمج مرة واحدة لكل دفعة. النسخة الأصلية ترفض الالتزام إذا سبقتها نافذة أخرى إلى الكتابة. */
export function createSqliteDiscoveryStore(request) {
  async function record(reports, checkedAt = Date.now()) {
    const keys = reportKeys(reports);
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshot = await request({ action: 'snapshot', ...keys });
      const editions = new Map(snapshot.editions.map((row) => [row.id, row]));
      const events = new Map(snapshot.events.map((row) => [row.id, row]));
      const changedEditions = new Set(), changedEvents = new Set();
      await applyReports(reports, checkedAt, {
        getEdition: (id) => editions.get(id),
        getEvent: (id) => events.get(id),
        putEdition: (row) => { changedEditions.add(row.id); editions.set(row.id, row); },
        putEvent: (row) => { changedEvents.add(row.id); events.set(row.id, row); },
      });
      const reply = await request({
        action: 'commit', rev: snapshot.rev,
        editions: [...changedEditions].map((id) => editions.get(id)),
        events: [...changedEvents].map((id) => events.get(id)),
      });
      if (reply.committed) return;
    }
    throw new Error('discovery_concurrent_write');
  }
  async function timeline(section, { before, limit } = {}) {
    if (!SECTIONS.has(section)) return timelinePage([], 40);
    const { cursor, count } = parsePage(before, limit, 40);
    const reply = await request({ action: 'timeline', section, cursor, limit: count + 1 });
    return timelinePage(reply.rows, count);
  }
  async function knownEditions(sourceId, { limit } = {}) {
    const { count } = parsePage(null, limit, 30);
    const reply = await request({ action: 'known', sourceId: String(sourceId), limit: count });
    return reply.rows;
  }
  return { record, timeline, knownEditions };
}

export function createDiscoveryStore({ factory = globalThis.indexedDB, keyRange = globalThis.IDBKeyRange } = {}) {
  let opening;
  function open() {
    if (!factory) return Promise.reject(new Error('discovery_storage_unavailable'));
    opening ??= new Promise((resolve, reject) => {
      const request = factory.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('editions', { keyPath: 'id' }).createIndex('source', ['sourceId', 'lastChapterCheckAt']);
        db.createObjectStore('events', { keyPath: 'id' }).createIndex('timeline', ['section', 'at', 'id']);
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    }).catch((error) => { opening = null; throw error; });
    return opening;
  }

  async function record(reports, checkedAt = Date.now()) {
    const db = await open();
    const tx = db.transaction(['editions', 'events'], 'readwrite');
    const done = committed(tx);
    void done.catch(() => {});
    const editions = tx.objectStore('editions');
    const events = tx.objectStore('events');
    try {
      await applyReports(reports, checkedAt, {
        getEdition: (id) => result(editions.get(id)),
        getEvent: (id) => result(events.get(id)),
        putEdition: (edition) => editions.put(edition),
        putEvent: (event) => events.put(event),
      });
      await done;
    } catch (error) {
      try { tx.abort(); } catch { /* terminated */ }
      throw error;
    }
  }

  async function timeline(section, { before = null, limit = 40 } = {}) {
    if (!SECTIONS.has(section)) return { events: [], next: null, snapshotAt: Date.now() };
    const db = await open();
    const index = db.transaction('events').objectStore('events').index('timeline');
    const { cursor, count } = parsePage(before, limit, 40);
    const upper = cursor ? [section, ...cursor] : [section, Number.MAX_SAFE_INTEGER, []];
    const range = keyRange.bound([section, 0, ''], upper, false, Boolean(cursor));
    const events = [];
    await new Promise((resolve, reject) => {
      const request = index.openCursor(range, 'prev');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return resolve();
        events.push(cursor.value);
        if (events.length <= count) cursor.continue();
        else resolve();
      };
    });
    return timelinePage(events, count);
  }

  async function knownEditions(sourceId, { limit = 30 } = {}) {
    const db = await open();
    const index = db.transaction('editions').objectStore('editions').index('source');
    const range = keyRange.bound([String(sourceId), 0], [String(sourceId), Number.MAX_SAFE_INTEGER]);
    return result(index.getAll(range, Math.max(1, Math.min(100, Math.trunc(Number(limit) || 30)))));
  }

  return { record, timeline, knownEditions };
}
