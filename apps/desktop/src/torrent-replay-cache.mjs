// Replay copies of bytes already emitted by rqbit's verified HTTP reader.
// This does not restore rqbit's piece-completion state or bypass torrent verification.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, join, parse, resolve } from 'node:path';
import { hostname, userInfo } from 'node:os';
import { cacheNamespace, cacheFreeBytes, TORRENT_FREE_RESERVE } from './torrent-cache.mjs';

const MiB = 1024 * 1024;
const extentName = /^extent-[a-f0-9-]{36}\.bin$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const integer = n => Number.isSafeInteger(n) && n >= 0;
function identity(value, requireIndex = true) {
  if (!value || typeof value.infoHash !== 'string' || !/^[a-f\d]{40}$|^[a-f\d]{64}$/i.test(value.infoHash)) return null;
  if ((requireIndex || value.fileIdx !== undefined) && (!integer(value.fileIdx) || value.fileIdx > 1_000_000)) return null;
  if (value.filename !== undefined && (typeof value.filename !== 'string' || !value.filename || value.filename.length > 512 || /[\\/\x00-\x1f]/.test(value.filename) || value.filename === '.' || value.filename === '..')) return null;
  return { infoHash: value.infoHash.toLowerCase(), ...(value.fileIdx === undefined ? {} : { fileIdx: value.fileIdx }), ...(value.filename === undefined ? {} : { filename: value.filename }) };
}
const key = value => `${value.infoHash}:${value.fileIdx}`;
async function safeDirectory(directory, create = false) {
  if (typeof directory !== 'string' || !isAbsolute(directory) || directory.includes('\0')) throw new Error('Invalid directory');
  const absolute = resolve(directory), root = parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    if (create) await fs.mkdir(current).catch(e => { if (e.code !== 'EEXIST') throw e; });
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Unsafe directory');
  }
  return absolute;
}
async function readFile(file, maxLength, exactLength) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxLength || (exactLength !== undefined && stat.size !== exactLength)) throw new Error('Unsafe file');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== stat.size) throw new Error('Changed file');
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error('Incomplete file');
      offset += bytesRead;
    }
    return bytes;
  } finally { await handle.close(); }
}
async function readJson(file, limit = 512 * 1024) { return JSON.parse((await readFile(file, limit)).toString('utf8')); }
async function atomicWrite(directory, name, bytes) {
  await safeDirectory(directory);
  const temp = join(directory, `pending-${randomUUID()}.tmp`);
  try {
    const handle = await fs.open(temp, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temp, join(directory, name));
  } finally { await fs.unlink(temp).catch(() => {}); }
}

/** All input roots come from the main-process disk selector, never renderer input.
 * Persistence is best effort: unavailable storage, contention and cancellation return false/null.
 * Await writes for backpressure. A bounded queue declines excess work rather than retaining it.
 */
export function createTorrentReplayCache({
  userData, ownerId = 'guest', maxBytes = 512 * MiB, maxEntryBytes = 256 * MiB, maxAgeMs = 24 * 60 * 60 * 1000,
  maxExtentBytes = 4 * MiB, maxExtents = 256, maxEntryExtents = 64,
  freeBytes = cacheFreeBytes, reserveBytes = TORRENT_FREE_RESERVE, now = Date.now,
} = {}) {
  if (typeof userData !== 'string' || !isAbsolute(userData)) throw new Error('Invalid userData');
  if (typeof ownerId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(ownerId)) throw new Error('Invalid ownerId');
  for (const value of [maxBytes, maxEntryBytes, maxAgeMs, maxExtentBytes, maxExtents, maxEntryExtents])
    if (!integer(value) || value === 0) throw new Error('Invalid cache limit');
  maxExtentBytes = Math.min(maxExtentBytes, 4 * MiB);
  maxExtents = Math.min(maxExtents, 256); maxEntryExtents = Math.min(maxEntryExtents, 64);
  const ownerHash = digest(ownerId).slice(0, 16);
  const profile = resolve(userData), namespace = cacheNamespace(profile) + '-replay-v1-' + ownerHash;
  const account = userInfo();
  const principal = digest(`${hostname()}\0${account.username}\0${account.homedir}`);
  const pointer = `torrent-replay-root-v1-${ownerHash}.json`, ownerToken = randomUUID();
  let directory, root, loaded = false, closed = false, lockOwned = false, readOnly = false, queuedBytes = 0;
  let entries = [], chain = Promise.resolve();
  const serial = operation => { const work = chain.then(operation); chain = work.catch(() => {}); return work; };
  const unlink = async file => {
    try { await safeDirectory(directory); await fs.unlink(join(directory, file)); } catch { /* unsafe or unavailable volume */ }
  };
  async function lock() {
    if (lockOwned) return true;
    if (readOnly) return false;
    const file = join(directory, 'writer.lock');
    try {
      const handle = await fs.open(file, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, token: ownerToken })); } finally { await handle.close(); }
      lockOwned = true; return true;
    } catch (error) {
      if (error.code !== 'EEXIST') return false;
      try {
        const old = await readJson(file, 1024);
        if (!integer(old.pid) || old.pid === 0 || typeof old.token !== 'string') return false;
        try { process.kill(old.pid, 0); readOnly = true; return false; } catch (e) { if (e.code !== 'ESRCH') return false; }
        // Only a dead process's unchanged lock may be removed.
        if ((await readJson(file, 1024)).token !== old.token) return false;
        await fs.unlink(file);
        const handle = await fs.open(file, 'wx', 0o600);
        try { await handle.writeFile(JSON.stringify({ pid: process.pid, token: ownerToken })); } finally { await handle.close(); }
        lockOwned = true; return true;
      } catch { return false; }
    }
  }
  async function openRoot(selectedRoot, create) {
    const checkedRoot = await safeDirectory(selectedRoot);
    const target = join(checkedRoot, namespace);
    let fresh = false;
    if (create) { try { await fs.mkdir(target, { mode: 0o700 }); fresh = true; } catch (e) { if (e.code !== 'EEXIST') throw e; } }
    await safeDirectory(target);
    if (fresh) await atomicWrite(target, 'owner.json', JSON.stringify({ version: 1, namespace, principal, ownerHash }));
    const owner = await readJson(join(target, 'owner.json'), 1024);
    if (owner.version !== 1 || owner.namespace !== namespace || owner.principal !== principal || owner.ownerHash !== ownerHash) throw new Error('Unowned cache');
    root = checkedRoot; directory = target;
    // Own the writer lock before taking an index snapshot; contended readers remain read-only.
    await lock();
    let index;
    try { index = await readJson(join(target, 'index.json')); } catch { return; }
    if (index.version !== 1 || !Array.isArray(index.entries) || index.entries.length > 256) return;
    const seen = new Set(); let count = 0;
    for (const item of index.entries) {
      const descriptor = identity(item.descriptor);
      if (!descriptor || !integer(item.descriptor.fileLength) || !item.descriptor.fileLength || !Array.isArray(item.extents) || item.extents.length > maxEntryExtents || seen.has(key(descriptor))) continue;
      descriptor.fileLength = item.descriptor.fileLength;
      const record = { descriptor, extents: [] }; let end = 0;
      for (const x of [...item.extents].sort((a, b) => a.start - b.start)) {
        if (count >= maxExtents || !x || !integer(x.start) || !integer(x.length) || !x.length || x.length > maxExtentBytes || x.start < end || x.start + x.length > descriptor.fileLength || !extentName.test(x.file) || !/^[a-f0-9]{64}$/.test(x.sha256) || !integer(x.used) || !integer(x.created)) continue;
        record.extents.push({ start: x.start, length: x.length, file: x.file, sha256: x.sha256, used: x.used, created: x.created }); count++; end = x.start + x.length;
      }
      entries.push(record); seen.add(key(descriptor));
    }
  }
  async function initialize() {
    if (loaded) return; loaded = true;
    try {
      await safeDirectory(profile);
      const value = await readJson(join(profile, pointer), 4096);
      if (value.version === 1 && value.namespace === namespace) await openRoot(value.root, false);
    } catch { directory = undefined; root = undefined; entries = []; }
  }
  async function save() {
    await safeDirectory(directory);
    await atomicWrite(directory, 'index.json', JSON.stringify({ version: 1, entries }));
  }
  function allExtents() { return entries.flatMap(entry => entry.extents.map(extent => ({ entry, extent }))); }
  async function remove(entry, extent) {
    entry.extents = entry.extents.filter(value => value !== extent); await unlink(extent.file);
  }
  async function trim() {
    const time = now();
    for (const { entry, extent } of allExtents()) if (time - extent.created > maxAgeMs) await remove(entry, extent);
    for (const entry of entries) {
      const sorted = [...entry.extents].sort((a, b) => a.used - b.used);
      let bytes = sorted.reduce((n, x) => n + x.length, 0), count = sorted.length;
      for (const extent of sorted) {
        if (bytes <= maxEntryBytes && count <= maxEntryExtents) break;
        await remove(entry, extent); bytes -= extent.length; count--;
      }
    }
    const sorted = allExtents().sort((a, b) => a.extent.used - b.extent.used);
    let bytes = sorted.reduce((n, x) => n + x.extent.length, 0), count = sorted.length;
    for (const { entry, extent } of sorted) {
      if (bytes <= maxBytes && count <= maxExtents) break;
      await remove(entry, extent); bytes -= extent.length; count--;
    }
    // Bound descriptors as well as byte extents; prefer descriptors with live bytes.
    while (entries.length > 256) {
      const disposable = entries.find(x => !x.extents.length) ?? entries[0];
      for (const extent of [...disposable.extents]) await remove(disposable, extent);
      entries = entries.filter(x => x !== disposable);
    }
  }
  async function checkedBytes(entry, extent) {
    try {
      if (now() - extent.created > maxAgeMs) throw new Error('Expired');
      await safeDirectory(directory);
      const bytes = await readFile(join(directory, extent.file), maxExtentBytes, extent.length);
      if (digest(bytes) !== extent.sha256) throw new Error('Corrupt extent');
      return bytes;
    } catch {
      if (lockOwned) await remove(entry, extent);
      else entry.extents = entry.extents.filter(x => x !== extent);
      return null;
    }
  }
  function handle(record) {
    const descriptor = Object.freeze({ ...record.descriptor, root });
    return {
      descriptor,
      read(start, length) {
        if (closed || !integer(start) || !integer(length) || !length) return Promise.resolve(null);
        return serial(async () => {
          if (!entries.includes(record)) return null;
          const pieces = []; let position = start, remaining = Math.min(length, maxExtentBytes);
          for (const extent of [...record.extents].sort((a, b) => a.start - b.start)) {
            if (extent.start + extent.length <= position) continue;
            if (extent.start > position || !remaining) break;
            const bytes = await checkedBytes(record, extent);
            if (!bytes) break;
            const offset = position - extent.start, size = Math.min(remaining, bytes.length - offset);
            pieces.push(bytes.subarray(offset, offset + size)); position += size; remaining -= size; extent.used = now();
          }
          if (lockOwned) await save().catch(() => {});
          return pieces.length ? Buffer.concat(pieces) : null;
        }).catch(() => null);
      },
      write(start, bytes, { signal } = {}) {
        if (closed || signal?.aborted || !integer(start) || !Buffer.isBuffer(bytes) || !bytes.length || bytes.length > maxExtentBytes || start + bytes.length > record.descriptor.fileLength || queuedBytes + bytes.length > 2 * maxExtentBytes) return Promise.resolve(false);
        const copy = Buffer.from(bytes); queuedBytes += copy.length;
        return serial(async () => {
          if (!entries.includes(record) || signal?.aborted || !(await lock())) return false;
          await safeDirectory(directory);
          const available = BigInt(await freeBytes(root));
          if (available < BigInt(reserveBytes) + BigInt(copy.length + maxExtentBytes + 65536)) return false;
          // Existing verified ranges win; write only missing intervals.
          let gaps = [{ start, bytes: copy }];
          for (const extent of [...record.extents]) {
            if (extent.start >= start + copy.length || extent.start + extent.length <= start) continue;
            if (!(await checkedBytes(record, extent))) continue;
            gaps = gaps.flatMap(gap => {
              const end = gap.start + gap.bytes.length, cutStart = Math.max(gap.start, extent.start), cutEnd = Math.min(end, extent.start + extent.length);
              if (cutStart >= cutEnd) return [gap];
              const result = [];
              if (cutStart > gap.start) result.push({ start: gap.start, bytes: gap.bytes.subarray(0, cutStart - gap.start) });
              if (cutEnd < end) result.push({ start: cutEnd, bytes: gap.bytes.subarray(cutEnd - gap.start) });
              return result;
            });
          }
          const oldExtents = [...record.extents], created = [];
          try {
            for (const gap of gaps) {
              if (signal?.aborted) throw new Error('Cancelled');
              const merged = [];
              for (const extent of [...record.extents].sort((a, b) => a.start - b.start)) {
                if (extent.length + gap.bytes.length > maxExtentBytes) continue;
                if (extent.start + extent.length !== gap.start && gap.start + gap.bytes.length !== extent.start) continue;
                const previous = await checkedBytes(record, extent); if (!previous) continue;
                gap.bytes = extent.start < gap.start ? Buffer.concat([previous, gap.bytes]) : Buffer.concat([gap.bytes, previous]);
                gap.start = Math.min(gap.start, extent.start); merged.push(extent);
              }
              const file = `extent-${randomUUID()}.bin`;
              await atomicWrite(directory, file, gap.bytes); created.push(file);
              record.extents = record.extents.filter(x => !merged.includes(x));
              record.extents.push({ start: gap.start, length: gap.bytes.length, file, sha256: digest(gap.bytes), created: now(), used: now() });
            }
            if (signal?.aborted) throw new Error('Cancelled');
            await save();
          } catch (error) {
            record.extents = oldExtents;
            for (const file of created) await unlink(file);
            throw error;
          }
          for (const extent of oldExtents) if (!record.extents.includes(extent)) await unlink(extent.file);
          await trim(); await save();
          return true;
        }).catch(() => false).finally(() => { queuedBytes -= copy.length; });
      },
    };
  }
  return {
    lookup(query) {
      const id = identity(query, false);
      if (closed || !id || (id.fileIdx === undefined && !id.filename)) return Promise.resolve(null);
      return serial(async () => {
        await initialize();
        const matches = entries.filter(x => x.descriptor.infoHash === id.infoHash && (id.fileIdx === undefined || x.descriptor.fileIdx === id.fileIdx) && (id.filename === undefined || x.descriptor.filename === id.filename));
        return matches.length === 1 ? handle(matches[0]) : null;
      }).catch(() => null);
    },
    remember(value) {
      const id = identity(value);
      if (closed || !id || !integer(value.fileLength) || !value.fileLength) return Promise.resolve(null);
      return serial(async () => {
        await initialize();
        if (!directory) {
          await safeDirectory(profile, true); await openRoot(value.root, true);
        } else if (resolve(value.root) !== root) return null; // One bounded volume per profile.
        if (!(await lock())) return null;
        let record = entries.find(x => key(x.descriptor) === key(id));
        if (record && record.descriptor.fileLength !== value.fileLength) return null;
        if (!record) { record = { descriptor: { ...id, fileLength: value.fileLength }, extents: [] }; entries.push(record); }
        await trim(); await save();
        if (!entries.includes(record)) return null;
        await atomicWrite(profile, pointer, JSON.stringify({ version: 1, namespace, root }));
        return handle(record);
      }).catch(() => null);
    },
    cleanup() {
      if (closed) return Promise.resolve();
      return serial(async () => {
        await initialize(); if (!directory || !(await lock())) return;
        await trim(); await save();
        const live = new Set(allExtents().map(x => x.extent.file));
        // Only generated files in the marker-owned namespace are disposable.
        for (const file of await fs.readdir(directory)) if ((extentName.test(file) && !live.has(file)) || /^pending-[a-f0-9-]{36}\.tmp$/.test(file)) await unlink(file);
      }).catch(() => {});
    },
    close() {
      if (closed) return chain; closed = true;
      return serial(async () => {
        if (lockOwned) {
          await save().catch(() => {});
          try { if ((await readJson(join(directory, 'writer.lock'), 1024)).token === ownerToken) await unlink('writer.lock'); } catch { /* inaccessible volume */ }
          lockOwned = false;
        }
      });
    },
  };
}
