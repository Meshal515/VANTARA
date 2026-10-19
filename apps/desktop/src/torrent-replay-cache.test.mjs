import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cacheNamespace } from './torrent-cache.mjs';
import { createTorrentReplayCache } from './torrent-replay-cache.mjs';

const hash = 'a'.repeat(40), otherHash = 'b'.repeat(40);
async function setup(t, options = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'vantara-replay-'));
  const userData = path.join(base, 'profile'), root = path.join(base, 'volume');
  await fs.mkdir(userData); await fs.mkdir(root);
  const opts = { userData, freeBytes: async () => 2n ** 40n, ...options };
  const cache = createTorrentReplayCache(opts);
  t.after(async () => { await cache.close(); await fs.rm(base, { recursive: true, force: true }); });
  return { base, userData, root, opts, cache, dir: path.join(root, cacheNamespace(userData) + '-replay-v1') };
}
async function remember(s, extra = {}) {
  return s.cache.remember({ root: s.root, infoHash: hash, fileIdx: 2, fileLength: 100, filename: 'film.mp4', ...extra });
}

test('restart replays only committed bytes, preserves arbitrary tail and returns contiguous prefix across adjacent writes', async t => {
  const s = await setup(t), entry = await remember(s);
  assert.equal(await entry.read(0, 4), null);
  assert.equal(await entry.write(0, Buffer.from('abcd')), true);
  await entry.write(4, Buffer.from('efgh'));
  await entry.write(96, Buffer.from('moov'));
  assert.equal((await entry.read(2, 10)).toString(), 'cdefgh');
  assert.equal(await entry.read(8, 10), null);
  await s.cache.close();
  const next = createTorrentReplayCache(s.opts); t.after(() => next.close());
  const restored = await next.lookup({ infoHash: hash, fileIdx: 2 });
  assert.equal(restored.descriptor.fileLength, 100);
  assert.equal((await restored.read(96, 4)).toString(), 'moov');
  assert.equal(await restored.read(90, 10), null);
  assert.equal(await next.lookup({ infoHash: hash, fileIdx: 3 }), null);
  assert.equal(await next.lookup({ infoHash: hash, filename: 'wrong.mp4' }), null);
});

test('corrupt and truncated extents become misses, never zero-filled responses', async t => {
  const s = await setup(t), entry = await remember(s);
  await entry.write(0, Buffer.from('verified'));
  const extents = (await fs.readdir(s.dir)).filter(v => v.endsWith('.bin'));
  await fs.writeFile(path.join(s.dir, extents[0]), 'modified');
  assert.equal(await entry.read(0, 8), null);
  await entry.write(0, Buffer.from('verified'));
  const next = (await fs.readdir(s.dir)).filter(v => v.endsWith('.bin'));
  await fs.truncate(path.join(s.dir, next[0]), 3);
  assert.equal(await entry.read(0, 8), null);
});

test('bounded LRU bytes, entry limits, age and extent counts preserve recent data', async t => {
  let now = 1000;
  const s = await setup(t, { maxBytes: 12, maxEntryBytes: 8, maxExtentBytes: 4, maxExtents: 3, maxEntryExtents: 2, maxAgeMs: 100, now: () => now });
  const a = await remember(s), b = await remember(s, { infoHash: otherHash });
  await a.write(0, Buffer.from('aaaa')); now++;
  await a.write(10, Buffer.from('bbbb')); now++;
  await b.write(0, Buffer.from('cccc')); now++;
  await a.read(0, 4); now++;
  await b.write(10, Buffer.from('dddd'));
  assert.equal(await a.read(10, 4), null);
  assert.equal((await a.read(0, 4)).toString(), 'aaaa');
  now += 101; await s.cache.cleanup();
  assert.equal(await a.read(0, 4), null);
  assert.equal((await fs.readdir(s.dir)).filter(v => v.endsWith('.bin')).length, 0);
});

test('space reservation, failed disk check and cancellation decline persistence safely', async t => {
  const s = await setup(t, { freeBytes: async () => 56n * 1024n * 1024n });
  const entry = await remember(s);
  assert.equal(await entry.write(0, Buffer.from('abcd')), false);
  assert.equal(await entry.read(0, 4), null);
  const enough = await setup(t);
  const other = await remember(enough), controller = new AbortController(); controller.abort();
  assert.equal(await other.write(0, Buffer.from('abcd'), { signal: controller.signal }), false);
  assert.equal(await other.read(0, 4), null);
});

test('concurrent writes serialize and contained retransmissions do not multiply extents', async t => {
  const s = await setup(t), entry = await remember(s);
  assert.deepEqual(await Promise.all([entry.write(0, Buffer.from('abcd')), entry.write(4, Buffer.from('efgh'))]), [true, true]);
  await entry.write(2, Buffer.from('cd'));
  assert.equal((await entry.read(0, 8)).toString(), 'abcdefgh');
  assert.equal((await fs.readdir(s.dir)).filter(v => v.endsWith('.bin')).length, 1);
});

test('invalid identity, index traversal and symlink roots never read or delete outside owned namespace', async t => {
  const s = await setup(t);
  assert.equal(await remember(s, { infoHash: '../x' }), null);
  assert.equal(await remember(s, { fileIdx: -1 }), null);
  assert.equal(await remember(s, { fileLength: Infinity }), null);
  assert.equal(await remember(s, { filename: '../secret' }), null);
  const outside = path.join(s.base, 'outside'); await fs.mkdir(outside);
  const linked = path.join(s.base, 'linked'); await fs.symlink(outside, linked, 'dir');
  assert.equal(await remember(s, { root: linked }), null);
  const entry = await remember(s); await entry.write(0, Buffer.from('abcd')); await s.cache.close();
  const sentinel = path.join(outside, 'sentinel'); await fs.writeFile(sentinel, 'keep');
  const indexPath = path.join(s.dir, 'index.json');
  const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  index.entries[0].extents[0].file = '../../outside/sentinel';
  await fs.writeFile(indexPath, JSON.stringify(index));
  const next = createTorrentReplayCache(s.opts); t.after(() => next.close());
  const restored = await next.lookup({ infoHash: hash, fileIdx: 2 });
  assert.equal(restored && await restored.read(0, 4), null);
  await next.cleanup();
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'keep');
});

test('profile namespaces do not share bytes; concurrent cache owners cannot overwrite index', async t => {
  const s = await setup(t), entry = await remember(s); await entry.write(0, Buffer.from('aaaa'));
  const competing = createTorrentReplayCache(s.opts); t.after(() => competing.close());
  const shared = await competing.lookup({ infoHash: hash, fileIdx: 2 });
  assert.equal((await shared.read(0, 4)).toString(), 'aaaa');
  assert.equal(await shared.write(10, Buffer.from('bbbb')), false);
  const profile = path.join(s.base, 'second-profile'); await fs.mkdir(profile);
  const isolated = createTorrentReplayCache({ ...s.opts, userData: profile }); t.after(() => isolated.close());
  assert.equal(await isolated.lookup({ infoHash: hash, fileIdx: 2 }), null);
});

test('lookup without file index requires an unambiguous filename match', async t => {
  const s = await setup(t); await remember(s);
  assert.equal((await s.cache.lookup({ infoHash: hash, filename: 'film.mp4' })).descriptor.fileIdx, 2);
  await remember(s, { fileIdx: 3 });
  assert.equal(await s.cache.lookup({ infoHash: hash, filename: 'film.mp4' }), null);
  assert.equal(await s.cache.lookup({ infoHash: hash }), null);
});

test('cleanup after a namespace directory is replaced by a symlink cannot unlink outside files', async t => {
  let now = 1000;
  const s = await setup(t, { maxAgeMs: 10, now: () => now });
  const entry = await remember(s); await entry.write(0, Buffer.from('aaaa'));
  const extent = (await fs.readdir(s.dir)).find(x => x.endsWith('.bin'));
  const outside = path.join(s.base, 'outside'); await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, extent), 'keep');
  await fs.rename(s.dir, s.dir + '-moved'); await fs.symlink(outside, s.dir, 'dir');
  now += 100; await s.cache.cleanup();
  assert.equal(await fs.readFile(path.join(outside, extent), 'utf8'), 'keep');
});

test('unwritable root, overlarge write, expired restart and queued cancellation preserve misses', async t => {
  const s = await setup(t);
  const blocker = path.join(s.base, 'not-a-directory'); await fs.writeFile(blocker, 'keep');
  assert.equal(await remember(s, { root: blocker }), null);
  const entry = await remember(s);
  assert.equal(await entry.write(0, Buffer.alloc(4 * 1024 * 1024 + 1)), false);
  const cancelled = new AbortController();
  const pending = entry.write(0, Buffer.from('aaaa'), { signal: cancelled.signal }); cancelled.abort();
  assert.equal(await pending, false);
  assert.equal(await entry.read(0, 4), null);
  const errors = await setup(t, { freeBytes: async () => { throw new Error('disk unavailable'); } });
  assert.equal(await (await remember(errors)).write(0, Buffer.from('aaaa')), false);
});
