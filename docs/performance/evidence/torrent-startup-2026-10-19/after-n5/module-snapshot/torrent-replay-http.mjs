import { once } from 'node:events';

export function replayRange(header, length) {
  if (!Number.isSafeInteger(length) || length <= 0) throw new Error('Invalid file length');
  if (header == null) return { start: 0, end: length - 1, partial: false };
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header));
  if (!m || !m[1] && !m[2]) return null;
  const a = m[1] ? Number(m[1]) : null, b = m[2] ? Number(m[2]) : null;
  if (a != null && !Number.isSafeInteger(a) || b != null && !Number.isSafeInteger(b)) return null;
  if (a == null && !(b > 0)) return null;
  const start = a ?? Math.max(0, length - b), end = a == null ? length - 1 : Math.min(b ?? length - 1, length - 1);
  return start >= length || end < start ? null : { start, end, partial: true };
}

/** Return the first cache miss. A cached prefix is followed by the exact same
 * Range from the verified engine, never padded or treated as a complete file. */
export async function sendReplayPrefix({ entry, req, res, signal, onBytes = () => {} }) {
  const length = entry.descriptor.fileLength, range = replayRange(req.headers.range, length);
  if (!range) {
    res.writeHead(416, { 'content-range': `bytes */${length}` }); res.end();
    return { complete: true };
  }
  let cursor = range.start, sent = false;
  while (cursor <= range.end && !signal.aborted && !res.destroyed) {
    const bytes = await entry.read(cursor, Math.min(4 * 1024 * 1024, range.end - cursor + 1));
    if (!bytes?.length || signal.aborted || res.destroyed) break;
    if (!sent) {
      res.writeHead(range.partial ? 206 : 200, {
        'content-type': 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'no-store',
        'content-length': range.end - range.start + 1,
        ...(range.partial ? { 'content-range': `bytes ${range.start}-${range.end}/${length}` } : {}),
      });
      sent = true;
      if (req.method === 'HEAD') { res.end(); return { complete: true }; }
    }
    cursor += bytes.length; onBytes(bytes.length, cursor);
    if (!res.write(bytes)) await once(res, 'drain', { signal });
  }
  if (cursor > range.end) { res.end(); return { complete: true }; }
  return { complete: false, cursor, range, sent };
}

/** At most one 4 MiB accumulator and two accepted queued writes per cache.
 * Cache I/O is best effort and never delays the decoder's incoming bytes. */
export function createReplayRecorder(entry, start) {
  const limit = 4 * 1024 * 1024, pending = new Set();
  let chunks = [], size = 0, offset = start, finished = false;
  function flush() {
    if (!size) return;
    const at = offset, bytes = Buffer.concat(chunks, size);
    offset += size; chunks = []; size = 0;
    // The cache itself refuses writes once its bounded queue is full.
    const work = Promise.resolve(entry.write(at, bytes)).catch(() => false);
    pending.add(work); work.finally(() => pending.delete(work));
  }
  return {
    append(bytes) {
      if (finished) return;
      let at = 0;
      while (at < bytes.length) {
        const count = Math.min(limit - size, bytes.length - at);
        chunks.push(bytes.subarray(at, at + count)); size += count; at += count;
        if (size === limit) flush();
      }
    },
    async finish() { if (!finished) { finished = true; flush(); } await Promise.all([...pending]); },
  };
}
