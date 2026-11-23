const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { openDiscovery } = require('./discovery-store.cjs');

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

test('SQLite rolls back the whole batch when a later row cannot be saved', () => {
  const storage = openDiscovery(':memory:');
  try {
    assert.throws(() => storage.request({
      action: 'commit', rev: 0,
      editions: [{ id: 'edition', sourceId: 'source', lastChapterCheckAt: 10 }],
      events: [{ id: 'chapter', section: 'manga', at: null }],
    }));
    assert.deepEqual(storage.request({ action: 'snapshot', editions: ['edition'], events: ['chapter'] }),
      { rev: 0, editions: [], events: [] });
  } finally { storage.close(); }
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
