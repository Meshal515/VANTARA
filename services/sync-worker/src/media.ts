import { isMediaHash, sniffImageType, sniffAudioType, mp4DurationMs, MAX_MEDIA_BYTES, MAX_MEDIA_BYTES_PER_USER, MAX_VIDEO_BYTES, MAX_VIDEO_BYTES_PER_USER, MEDIA_CHUNK_BYTES } from '@vantara/domain';
import type { Env } from './types.ts';

const json = (body: unknown, status = 200) => Response.json(body, { status });
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
async function boundedBody(request: Request, max: number): Promise<Uint8Array | null> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > max) { await reader.cancel(); return null; }
    parts.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}

/** Authentication is enforced by both worker entry points before reaching upload. */
export async function handleMediaUpload(request: Request, env: Env, userId: string, url: URL, now: number): Promise<Response> {
  const declaredType = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  const video = declaredType === 'video/mp4';
  if (declaredType.startsWith('video/') && !video) return json({ error: 'unsupported_video' }, 415);
  const max = video ? MAX_VIDEO_BYTES : MAX_MEDIA_BYTES;
  if (Number(request.headers.get('content-length') ?? '0') > max) return json({ error: 'too_large', max }, 413);
  const bytes = await boundedBody(request, max);
  if (!bytes) return json({ error: 'too_large', max }, 413);
  if (!bytes.length) return json({ error: 'empty' }, 400);
  const durationMs = video ? mp4DurationMs(bytes) : null;
  const mime = video ? (durationMs !== null ? 'video/mp4' : null) : sniffImageType(bytes) ?? sniffAudioType(bytes);
  if (!mime || mime === 'audio/mp4' && declaredType && !declaredType.startsWith('audio/')) return json({ error: 'unsupported_media' }, 415);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hash = [...digest].map(b => b.toString(16).padStart(2, '0')).join('');
  const existing = await env.DB.prepare('SELECT owner_id, mime FROM media WHERE hash = ?').bind(hash).first<{ owner_id: string; mime: string }>();
  if (video && existing && (existing.owner_id !== userId || existing.mime !== mime)) return json({ error: 'media_conflict' }, 409);
  if (!existing) {
    // A separate bounded video allowance leaves existing image/audio quotas intact.
    const used = await env.DB.prepare(`SELECT COALESCE(SUM(size), 0) AS total FROM media WHERE owner_id = ? AND ${video ? "mime = 'video/mp4'" : "mime != 'video/mp4'"}`)
      .bind(userId).first<{ total: number }>();
    if (Number(used?.total ?? 0) + bytes.length > (video ? MAX_VIDEO_BYTES_PER_USER : MAX_MEDIA_BYTES_PER_USER)) return json({ error: 'quota' }, 413);
    const statements = [env.DB.prepare('INSERT INTO media (hash, owner_id, mime, size, data, created_at, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (hash) DO NOTHING')
      .bind(hash, userId, mime, bytes.length, video ? '' : toBase64(bytes), now, durationMs)];
    if (video) for (let offset = 0, index = 0; offset < bytes.length; offset += MEDIA_CHUNK_BYTES, index++) {
      const chunk = bytes.subarray(offset, offset + MEDIA_CHUNK_BYTES);
      statements.push(env.DB.prepare('INSERT INTO media_chunks (hash, chunk_index, size, data) VALUES (?, ?, ?, ?) ON CONFLICT (hash, chunk_index) DO NOTHING').bind(hash, index, chunk.length, toBase64(chunk)));
    }
    // Metadata and all chunks commit together; failed uploads leave no partial clip.
    await env.DB.batch(statements);
  }
  return json({ hash, mime, size: bytes.length, url: `${url.origin}/v1/media/${hash}`, ...(video ? { durationMs } : {}) });
}

/** One RFC 9110 byte range; reject multi-range requests instead of constructing multipart. */
function byteRange(value: string | null, size: number): { start: number; end: number } | null {
  if (!value) return { start: 0, end: size - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || !match[1] && !match[2]) return null;
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if (first !== null && !Number.isSafeInteger(first) || last !== null && !Number.isSafeInteger(last)) return null;
  if (first === null) return last && last > 0 ? { start: Math.max(0, size - last), end: size - 1 } : null;
  if (first >= size || last !== null && first > last) return null;
  return { start: first, end: Math.min(last ?? size - 1, size - 1) };
}

/** Public immutable content hashes preserve the existing sharing model. */
export async function handleMediaGet(request: Request, env: Env, hash: string): Promise<Response> {
  if (!isMediaHash(hash)) return new Response('not found', { status: 404 });
  const row = await env.DB.prepare('SELECT mime, size, data FROM media WHERE hash = ?').bind(hash).first<{ mime: string; size: number; data: string }>();
  if (!row) return new Response('not found', { status: 404 });
  const headers: Record<string, string> = {
    'content-type': row.mime,
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'",
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-allow-headers': 'Range',
    'access-control-expose-headers': 'Accept-Ranges, Content-Range, Content-Length, Content-Type',
    'cross-origin-resource-policy': 'cross-origin',
    'accept-ranges': 'bytes',
    'content-disposition': `inline; filename="${hash}.${row.mime === 'video/mp4' ? 'mp4' : row.mime.split('/')[1]}"`,
  };
  const requested = request.headers.get('range');
  const range = byteRange(requested, row.size);
  if (!range) return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${row.size}`, 'content-length': '0' } });
  const { start, end } = range;
  headers['content-length'] = String(end - start + 1);
  if (requested) headers['content-range'] = `bytes ${start}-${end}/${row.size}`;
  const status = requested ? 206 : 200;
  if (request.method === 'HEAD') return new Response(null, { status, headers });
  if (row.mime !== 'video/mp4') return new Response(fromBase64(row.data).slice(start, end + 1), { status, headers });
  // Fetch one <=512 KiB chunk per pull, including when the requested range spans rows.
  let index = Math.floor(start / MEDIA_CHUNK_BYTES);
  const last = Math.floor(end / MEDIA_CHUNK_BYTES);
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await env.DB.prepare('SELECT data FROM media_chunks WHERE hash = ? AND chunk_index = ?').bind(hash, index).first<{ data: string }>();
        if (!chunk) throw new Error('missing media chunk');
        const bytes = fromBase64(chunk.data);
        const offset = index * MEDIA_CHUNK_BYTES;
        controller.enqueue(bytes.slice(Math.max(0, start - offset), Math.min(bytes.length, end - offset + 1)));
        index++;
        if (index > last) controller.close();
      } catch (error) { controller.error(error); }
    },
  });
  return new Response(stream, { status, headers });
}
