// جهاز واحد يملك نسخ المصادر وأحداثها. فهارس IndexedDB تقرأ صفحة أو مصدرًا واحدًا.
const DATABASE = 'vantara-local-discovery';
const SECTIONS = new Set(['manga', 'anime', 'cinema']);
const KINDS = new Set(['chapter', 'episode', 'movie']);
const FIRST_LOOKBACK = 14 * 86_400_000;
const EARLIEST_RELEASE = Date.UTC(2000, 0, 1);
const PUBLIC_QUERY = new Set(['id', 'work_id', 'manga_id', 'series_id', 'slug', 'manga', 'series', 'story', 'w', 'h', 'width', 'height', 'format']);
const encoder = new TextEncoder();
const jsonBytes = (value) => encoder.encode(JSON.stringify(value)).length;

function publicReference(value) {
  if (typeof value !== 'string' || !value || value.length > 2048 || encoder.encode(value).length > 2048 || /[\u0000-\u0020\\#]/.test(value)) return null;
  try {
    const url = new URL(value, 'https://discovery.invalid/');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) return null;
    if ([...url.searchParams].some(([name, part]) => !PUBLIC_QUERY.has(name) || !/^[a-z0-9_.-]{1,80}$/i.test(part))) return null;
    return value;
  } catch { return null; }
}

function archivedSource(raw) {
  const { s, u, t, m, c } = raw ?? {};
  const url = publicReference(u);
  const needsContext = c === true || (typeof m === 'string' && Boolean(m.trim()) && !/^\{\s*\}$/.test(m.trim()));
  return {
    ...(typeof s === 'string' && s.length > 0 && s.length <= 512 ? { s } : {}),
    ...(url ? { u: url } : {}),
    ...(typeof t === 'string' && t ? { t: t.slice(0, 320) } : {}),
    ...(needsContext ? { c: true } : {}),
  };
}

function discoveryContext() {
  const context = new Map();
  const runtimeSource = (raw) => {
    const source = archivedSource(raw);
    const memo = context.get(JSON.stringify([source.s, source.u]));
    return memo ? { ...source, m: memo } : source;
  };
  return {
    reports(rows) {
      return rows.flatMap((row) => {
        if (!SECTIONS.has(row?.section) || !KINDS.has(row.kind) || typeof row.work !== 'string' || !row.work ||
            row.work.length > 1024 || typeof row.title !== 'string' || !row.title) return [];
        const source = archivedSource(row.source);
        const { s, u, c } = source;
        const m = row.source?.m;
        if (s && u && c && typeof m === 'string' && m.length <= 4096) {
          const key = JSON.stringify([s, u]);
          context.delete(key);
          context.set(key, m);
          if (context.size > 256) context.delete(context.keys().next().value);
        }
        return [{ ...row, title: row.title.slice(0, 320), source, cover: publicReference(row.cover), units: Array.isArray(row.units) ? row.units : [] }];
      });
    },
    forScan(row) {
      return { ...row, source: runtimeSource(row.source ?? {}) };
    },
    forTimeline(row) {
      return { ...row, cover: publicReference(row.cover), sources: (row.sources ?? []).map(runtimeSource) };
    },
  };
}

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
  let min = Infinity, max = -Infinity, count = 0;
  const dates = units.map((unit) => {
    const at = unit?.publishedAt;
    if (!Number.isFinite(at) || at < EARLIEST_RELEASE || at > checkedAt) return null;
    min = Math.min(min, at);
    max = Math.max(max, at);
    count++;
    return Math.trunc(at);
  });
  // بعض المصادر تعطي وقت الجلب نفسه لدفعة كبيرة من الفصول.
  if (count >= 10 && max - min < 60_000) return dates.map(() => null);
  return dates;
}

function newerSourceList(saved, source) {
  if (!source.s) return saved;
  const index = saved.findIndex((prior) => prior.s === source.s);
  if (index >= 0 && JSON.stringify(saved[index]) === JSON.stringify(source)) return saved;
  const next = index < 0 ? [...saved, source] : saved.map((prior, i) => i === index ? source : prior);
  while (next.length > 1 && (next.length > 64 || jsonBytes(next) > 16 * 1024)) next.splice(next[0] === source ? 1 : 0, 1);
  return next;
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
      const priorPublication = Number.isFinite(existing?.publishedAt) ? Math.trunc(existing.publishedAt) : null;
      const release = priorPublication == null ? publishedAt
        : publishedAt == null ? priorPublication : Math.min(priorPublication, publishedAt);
      const previousSources = (existing?.sources ?? []).map(archivedSource);
      const sources = newerSourceList(previousSources, source);
      const cover = publicReference(existing?.cover) ?? report.cover ?? null;
      const changed = !existing || existing.publishedAt !== release || JSON.stringify(existing.sources) !== JSON.stringify(sources) ||
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
    Number.isFinite(cursor[0]) && cursor[0] >= 0 && cursor[0] <= Number.MAX_SAFE_INTEGER && typeof cursor[1] === 'string' &&
    cursor[1].length > 0 && cursor[1].length <= 8192 && !cursor[1].includes('\u0000');
  return { cursor: valid ? cursor : null, count: Math.max(1, Math.min(100, Math.trunc(Number(limit) || defaultLimit))) };
}

function timelinePage(events, count) {
  const more = events.length > count;
  const visible = more ? events.slice(0, count) : events;
  const last = visible.at(-1);
  return { events: visible, next: more ? JSON.stringify([last.at, last.id]) : null, snapshotAt: Date.now() };
}

function* bridgePages(first, second) {
  let page = { editions: [], events: [] }, bytes = 0, count = 0;
  for (const [key, values] of [first, second]) {
    for (const value of values) {
      const size = jsonBytes(value) + 1;
      if (count && (count === 128 || bytes + size > 400 * 1024)) {
        yield page;
        page = { editions: [], events: [] }; bytes = 0; count = 0;
      }
      page[key].push(value);
      count++;
      bytes += size;
    }
  }
  if (count) yield page;
}

/** يحسب الدمج مرة واحدة لكل دفعة. النسخة الأصلية ترفض الالتزام إذا سبقتها نافذة أخرى إلى الكتابة. */
export function createSqliteDiscoveryStore(request) {
  const context = discoveryContext();
  async function record(input, checkedAt = Date.now()) {
    const reports = context.reports(input);
    if (!reports.length) return;
    const keys = reportKeys(reports);
    for (let attempt = 0; attempt < 3; attempt++) {
      let rev, conflicted = false;
      const editions = new Map(), events = new Map();
      for (const keysPage of bridgePages(['editions', keys.editions], ['events', keys.events])) {
        const snapshot = await request({ action: 'snapshot', ...keysPage });
        if (rev !== undefined && snapshot.rev !== rev) { conflicted = true; break; }
        rev = snapshot.rev;
        for (const row of snapshot.editions) editions.set(row.id, row);
        for (const row of snapshot.events) events.set(row.id, row);
      }
      if (conflicted) continue;
      const changedEditions = new Set(), changedEvents = new Set();
      await applyReports(reports, checkedAt, {
        getEdition: (id) => editions.get(id),
        getEvent: (id) => events.get(id),
        putEdition: (row) => { changedEditions.add(row.id); editions.set(row.id, row); },
        putEvent: (row) => { changedEvents.add(row.id); events.set(row.id, row); },
      });
      // Save events before their edition baselines so a retry can recover an interrupted large batch.
      for (const page of bridgePages(['events', [...changedEvents].map((id) => events.get(id))],
        ['editions', [...changedEditions].map((id) => editions.get(id))])) {
        const reply = await request({ action: 'commit', rev, ...page });
        if (!reply.committed) { conflicted = true; break; }
        rev++;
      }
      if (!conflicted) return;
    }
    throw new Error('discovery_concurrent_write');
  }
  async function timeline(section, { before, limit } = {}) {
    if (!SECTIONS.has(section)) return timelinePage([], 40);
    const { cursor, count } = parsePage(before, limit, 40);
    const reply = await request({ action: 'timeline', section, cursor, limit: count + 1 });
    return timelinePage(reply.rows.map(context.forTimeline), count);
  }
  async function knownEditions(sourceId, { limit } = {}) {
    const { count } = parsePage(null, limit, 30);
    const reply = await request({ action: 'known', sourceId: String(sourceId), limit: count });
    return reply.rows.map(context.forScan);
  }
  return { record, timeline, knownEditions };
}

export function createDiscoveryStore({ factory = globalThis.indexedDB, keyRange = globalThis.IDBKeyRange } = {}) {
  let opening;
  const context = discoveryContext();
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

  async function record(input, checkedAt = Date.now()) {
    const reports = context.reports(input);
    if (!reports.length) return;
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
    return timelinePage(events.map(context.forTimeline), count);
  }

  async function knownEditions(sourceId, { limit = 30 } = {}) {
    const db = await open();
    const index = db.transaction('editions').objectStore('editions').index('source');
    const range = keyRange.bound([String(sourceId), 0], [String(sourceId), Number.MAX_SAFE_INTEGER]);
    const rows = await result(index.getAll(range, Math.max(1, Math.min(100, Math.trunc(Number(limit) || 30)))));
    return rows.map(context.forScan);
  }

  return { record, timeline, knownEditions };
}
