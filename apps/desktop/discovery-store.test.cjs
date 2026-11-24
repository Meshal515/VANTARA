const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');
const { createDiscoveryWorker, openDiscovery } = require('./discovery-store.cjs');

test('SQLite keeps old releases after reopening and rejects a stale concurrent transaction', async () => {
  const { createSqliteDiscoveryStore } = await import("../web/lib/discovery-store.js");
  const dir = mkdtempSync(path.join(tmpdir(), 'vantara-discovery-'));
  const filename = path.join(dir, 'discovery.sqlite');
  let connection = openDiscovery(filename);
  try {
    let store = createSqliteDiscoveryStore((input) => connection.request(input));
    const first = Date.UTC(2026, 10, 20);
    const last = Date.UTC(2031, 10, 20);
    const base = { section: 'manga', work: 'ext:book', kind: 'chapter', title: 'Book', source: { s: 'book#7', u: '/book' } };
    await store.record([{ ...base, units: [{ number: 1, publishedAt: first - 1000 }] }], first);
    const stale = connection.request({ action: 'snapshot', events: [], editions: [] });
    const other = openDiscovery(filename);
    try {
      await createSqliteDiscoveryStore((input) => other.request(input))
        .record([{ ...base, units: [{ number: 2, publishedAt: last - 1000 }] }], last);
      assert.deepEqual(connection.request({ action: 'commit', rev: stale.rev, editions: [], events: [] }), { committed: false });
    } finally { other.close(); }
    connection.close();
    connection = openDiscovery(filename);
    store = createSqliteDiscoveryStore((input) => connection.request(input));
    const page = await store.timeline('manga', { limit: 1 });
    assert.equal(page.events[0].number, 2);
    assert.equal((await store.timeline('manga', { before: page.next })).events[0].publishedAt, first - 1000);
    assert.equal((await store.knownEditions('book#7'))[0].lastCheckedAt, last);
  } finally {
    connection.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

const edition = {
  id: 'edition', sourceId: 'source', work: 'ext:book', section: 'manga', title: 'Book',
  source: { s: 'source', u: '/book', c: true }, firstSeenAt: 10, lastCheckedAt: 10,
  lastChapterCheckAt: 10, baselines: [[0, 1.5]],
};
const event = {
  id: 'chapter', work: 'ext:book', section: 'manga', kind: 'chapter', number: 1.5, season: null,
  title: 'Book', cover: null, sources: [edition.source], firstSeenAt: 10, at: 10,
  publishedAt: null, lastCheckedAt: 10, updatedAt: 10,
};

test('SQLite rejects a malformed commit before changing the archive', () => {
  const storage = openDiscovery(':memory:');
  try {
    for (const badEvent of [
      { ...event, at: null },
      { ...event, number: '1.5' },
      { ...event, sources: [{ s: 'source', m: 'private context' }] },
      { ...event, sources: [{ s: 'source', c: 'true' }] },
      { ...event, sources: [{ s: 'source', u: '/book?token=private' }] },
      { ...event, cover: 'https://reader.example/cover#private' },
      { ...event, detail: {} },
    ]) {
      assert.throws(() => storage.request({
        action: 'commit', rev: 0, editions: [edition], events: [badEvent],
      }), { message: 'invalid_discovery_request' });
    }
    assert.deepEqual(storage.request({ action: 'snapshot', editions: ['edition'], events: ['chapter'] }),
      { rev: 0, editions: [], events: [] });
    assert.deepEqual(storage.request({ action: 'commit', rev: 0, editions: [edition], events: [event] }),
      { committed: true });
  } finally { storage.close(); }
});

test('SQLite validates arguments for each read operation', () => {
  const storage = openDiscovery(':memory:');
  try {
    for (const input of [
      { action: 'unrecognized' },
      { action: 'snapshot', editions: [14], events: [] },
      { action: 'timeline', section: 'other', limit: 10 },
      { action: 'timeline', section: 'manga', cursor: [10] },
      { action: 'timeline', section: 'manga', cursor: ['10', 'chapter'] },
      { action: 'timeline', section: 'manga', cursor: [10, ''] },
      { action: 'known', sourceId: 14 },
      { action: 'known', sourceId: 'source', limit: '10' },
      { action: 'known', sourceId: 'source', limit: 102 },
      { action: 'known', sourceId: 's'.repeat(513) },
    ]) {
      assert.throws(() => storage.request(input), { message: 'invalid_discovery_request' });
    }
    assert.deepEqual(storage.request({ action: 'timeline', section: 'manga', cursor: [10.5, 'chapter'] }), { rows: [] });
  } finally { storage.close(); }
});

test('SQLite enforces combined batch and UTF-8 byte limits', () => {
  const storage = openDiscovery(':memory:');
  try {
    assert.throws(() => storage.request({
      action: 'snapshot', editions: Array(128).fill('edition'), events: Array(129).fill('chapter'),
    }), { message: 'discovery_request_too_large' });
    const wideSource = { u: `/${'界'.repeat(680)}`, t: '界'.repeat(1024) };
    assert.throws(() => storage.request({
      action: 'commit', rev: 0, editions: [], events: [{ ...event, sources: Array(7).fill(wideSource) }],
    }), { message: 'discovery_request_too_large' });
    assert.throws(() => storage.request({
      action: 'commit', rev: 0, editions: [],
      events: Array.from({ length: 72 }, (_, n) => ({ ...event, id: `chapter-${n}`, sources: Array(3).fill(wideSource) })),
    }), { message: 'discovery_request_too_large' });
    assert.equal(storage.request({ action: 'snapshot', editions: [], events: [] }).rev, 0);
  } finally { storage.close(); }
});

test('desktop worker bounds outstanding requests and can accept more after replies', async () => {
  const request = createDiscoveryWorker(':memory:');
  const input = { action: 'timeline', section: 'manga', limit: 5 };
  await assert.rejects(request({ ...input, limit: 0 }), { message: 'invalid_discovery_request' });
  const replies = await Promise.allSettled(Array.from({ length: 9 }, () => request(input)));
  assert.deepEqual(replies.slice(0, 8), Array(8).fill({ status: 'fulfilled', value: { rows: [] } }));
  assert.equal(replies[8].status, 'rejected');
  assert.equal(replies[8].reason.message, 'discovery_busy');
  assert.deepEqual(await request(input), { rows: [] });
});

test('SQLite upgrades old source context without changing saved releases or revision', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vantara-discovery-upgrade-'));
  const filename = path.join(dir, 'discovery.sqlite');
  try {
    openDiscovery(filename).close();
    const legacy = new DatabaseSync(filename);
    try {
      legacy.exec('PRAGMA user_version=1; UPDATE discovery_meta SET rev=7');
      const source = { s: 'source', u: '/book', m: 'old private context' };
      legacy.prepare('INSERT INTO editions VALUES (?,?,?,?)')
        .run(edition.id, edition.sourceId, edition.lastChapterCheckAt, JSON.stringify({ ...edition, source }));
      legacy.prepare('INSERT INTO events VALUES (?,?,?,?)')
        .run(event.id, event.section, event.at, JSON.stringify({ ...event, sources: [source, { s: 'other' }] }));
    } finally { legacy.close(); }
    const storage = openDiscovery(filename);
    try {
      assert.deepEqual(storage.request({ action: 'snapshot', editions: ['edition'], events: ['chapter'] }), {
        rev: 7, editions: [edition], events: [{ ...event, sources: [edition.source, { s: 'other' }] }],
      });
      assert.equal(statSync(`${filename}-wal`).size, 0);
      assert.doesNotMatch(readFileSync(filename).toString('latin1'), /old private context/);
    } finally { storage.close(); }
    const reopened = new DatabaseSync(filename);
    try {
      assert.equal(reopened.prepare('PRAGMA user_version').get().user_version, 2);
      assert.doesNotMatch(reopened.prepare('SELECT payload FROM events').get().payload, /old private context/);
    } finally { reopened.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('SQLite removes sensitive legacy references while preserving history and public query IDs', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vantara-discovery-references-'));
  const filename = path.join(dir, 'discovery.sqlite');
  const unsafe = 'https://reader.example/book?token=old-private-query';
  const safe = 'https://reader.example/book?manga_id=book-2';
  const unsafeId = JSON.stringify(['manga', 'source', unsafe]);
  const safeId = JSON.stringify(['manga', 'source', safe]);
  const oldCover = 'https://reader:old-private-password@reader.example/cover.jpg';
  try {
    openDiscovery(filename).close();
    const legacy = new DatabaseSync(filename);
    try {
      legacy.exec('PRAGMA user_version=1; UPDATE discovery_meta SET rev=7');
      const insertEdition = legacy.prepare('INSERT INTO editions VALUES (?,?,?,?)');
      for (const [id, u] of [[unsafeId, unsafe], [safeId, safe]]) {
        insertEdition.run(id, edition.sourceId, edition.lastChapterCheckAt, JSON.stringify({ ...edition, id, source: { s: 'source', u } }));
      }
      legacy.prepare('INSERT INTO events VALUES (?,?,?,?)').run(event.id, event.section, event.at, JSON.stringify({
        ...event, cover: oldCover, sources: [{ s: 'source', u: unsafe }, { s: 'other', u: `${safe}#old-private-fragment` }],
      }));
    } finally { legacy.close(); }
    const storage = openDiscovery(filename);
    try {
      const { rows } = storage.request({ action: 'known', sourceId: 'source' });
      const retained = rows.find(({ id }) => id !== safeId);
      assert.match(retained.id, /^legacy:[a-f0-9]{64}$/);
      assert.deepEqual(retained, { ...edition, id: retained.id, source: { s: 'source' } });
      const data = storage.request({ action: 'snapshot', editions: [unsafeId, safeId, retained.id], events: [event.id] });
      assert.equal(data.rev, 7);
      assert.deepEqual(data.editions, [{ ...edition, id: safeId, source: { s: 'source', u: safe } }, retained]);
      assert.deepEqual(data.events, [{ ...event, sources: [{ s: 'source' }, { s: 'other' }] }]);
      assert.doesNotMatch(readFileSync(filename).toString('latin1'), /old-private-/);
    } finally { storage.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('catch-up preserves every saved row across page boundaries and equal publication times', async () => {
  const { createSqliteDiscoveryStore } = await import('../web/lib/discovery-store.js');
  const database = openDiscovery(':memory:');
  const store = createSqliteDiscoveryStore((input) => database.request(input));
  const started = Date.UTC(2026, 10, 16, 12);
  const resumed = started + 7 * 86_400_000;
  const work = (index, number, publishedAt) => ({
    section: 'manga', kind: 'chapter', work: `ext:work-${index}`, title: `Work ${index}`,
    source: { s: 'repo.example#9', u: `/works/${index}` }, units: [{ number, publishedAt }],
  });
  try {
    for (let offset = 0; offset < 240; offset += 40) {
      await store.record(Array.from({ length: 40 }, (_, index) => work(offset + index, 4, started - 1000)), started);
    }
    await store.record(Array.from({ length: 20 }, (_, index) => work(index, 5, resumed - 600_000)), resumed);
    let before;
    const all = [];
    do {
      const page = await store.timeline('manga', { limit: 43, before });
      all.push(...page.events);
      before = page.next;
    } while (before);
    assert.equal(new Set(all.map((event) => event.id)).size, 260);
    assert.equal(all.length, 260);
    assert.ok(all.slice(0, 20).every((event) => event.publishedAt === resumed - 600_000 && event.firstSeenAt === resumed));
    assert.ok(all.slice(20).every((event) => event.publishedAt === started - 1000 && event.firstSeenAt === started));
  } finally { database.close(); }
});

test('week-long lifecycle renders saved events before probing and catches up independently as sources recover', async () => {
  const { createSqliteDiscoveryStore } = await import('../web/lib/discovery-store.js');
  const { scanDiscovery } = await import('../web/lib/discovery-scan.js');
  const dir = mkdtempSync(path.join(tmpdir(), 'vantara-discovery-week-'));
  const filename = path.join(dir, 'discovery.sqlite');
  const day = 86_400_000;
  const start = Date.UTC(2026, 10, 16, 12);
  const returned = start + 7 * day;
  const a = { id: 'provider.alpha#8929911308540155494' };
  const b = { id: 'provider.beta#123' };
  const aWork = { url: '/alpha', title: 'Alpha' };
  const bWork = { url: '/beta', title: 'Beta' };
  const fresh = { url: '/new-title', title: 'New Title' };
  const key = (manga) => `ext:${manga.title.toLowerCase()}`;
  const makeReport = (source, manga, units) => ({
    section: 'manga', kind: 'chapter', work: key(manga), title: manga.title,
    source: { s: source.id, u: manga.url }, units,
  });
  const scheduler = new Map();
  const calls = [];
  const opts = {
    readState: (id) => scheduler.get(id),
    writeState: (id, value) => scheduler.set(id, value),
  };
  let db = openDiscovery(filename);
  try {
    let store = createSqliteDiscoveryStore((input) => db.request(input));
    await scanDiscovery([a, b], {
      ...opts, now: start, knownEditions: store.knownEditions,
      catalogue: async (source) => ({ mangas: [source === a ? aWork : bWork] }),
      latest: async () => ({ mangas: [] }),
      chapters: (source, manga) => store.record([makeReport(source, manga, [
        { number: 5, publishedAt: start - 1000 }, { number: 4 },
      ])], start),
    });
    db.close();
    db = openDiscovery(filename);
    store = createSqliteDiscoveryStore((input) => db.request(input));
    // No adapter has been invoked in this session. The old first page already exists on disk.
    const cached = await store.timeline('manga');
    assert.equal(calls.length, 0);
    assert.deepEqual(cached.events.map((e) => e.number), [5, 5]);

    let betaAvailable = false;
    const pass = (now) => scanDiscovery([a, b], {
      ...opts, now, knownEditions: store.knownEditions,
      catalogue: async (source) => {
        calls.push(['catalogue', source.id]);
        if (source === b && !betaAvailable) throw new Error('offline');
        return { mangas: source === a ? [fresh] : [bWork] };
      },
      latest: async () => { throw new Error('unsupported'); },
      chapters: async (source, manga) => {
        calls.push(['chapters', manga.url]);
        if (source === b && !betaAvailable) throw new Error('offline');
        const units = manga.url === fresh.url
          ? [{ number: 1, publishedAt: returned - day }]
          : source === a
            ? [{ number: 7 }, { number: 6, publishedAt: returned - 3 * day }]
            : [{ number: 6, publishedAt: returned - 4 * day }];
        await store.record([makeReport(source, manga, units)], now);
      },
    });
    await pass(returned);
    const partial = (await store.timeline('manga')).events;
    assert.equal(partial.find((e) => e.work === 'ext:alpha' && e.number === 6).publishedAt, returned - 3 * day);
    assert.equal(partial.find((e) => e.work === 'ext:alpha' && e.number === 7).publishedAt, null);
    assert.equal(partial.find((e) => e.work === 'ext:alpha' && e.number === 7).firstSeenAt, returned);
    assert.ok(partial.some((e) => e.work === 'ext:new title'));
    assert.ok(partial.some((e) => e.work === 'ext:beta' && e.number === 5));
    const failed = calls.filter(([, id]) => id === b.id).length;
    await pass(returned + 1000);
    assert.equal(calls.filter(([, id]) => id === b.id).length, failed, 'failure backs off per source');

    betaAvailable = true;
    await pass(returned + 3 * 60_000);
    const restored = (await store.timeline('manga')).events;
    assert.ok(restored.some((e) => e.work === 'ext:beta' && e.number === 6 && e.publishedAt === returned - 4 * day));
    assert.deepEqual(restored.filter((e) => e.number === 5).map((e) => e.id), cached.events.map((e) => e.id));
    assert.equal(new Set(restored.map((e) => e.id)).size, restored.length);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
