import { isMediaHash, MAX_MOMENT_DURATION_MS } from './media.ts';

export interface MomentSource { url: string; title?: string; quality?: string; mimeType?: string }
export interface Moment {
  version: 1;
  /** Original episode timeline; uploaded clip playback starts at zero. */
  startMs: number;
  endMs: number;
  episode: number | null;
  mediaKey: string;
  posterKey?: string;
  durationMs?: number;
  sources?: MomentSource[];
}

function publicUrl(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 2000) return null;
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash || url.port && !['80', '443'].includes(url.port)) return null;
    if (!host.includes('.') || host.includes(':') || /\.(localhost|local|internal|test|invalid)$/.test(host)) return null;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const [a = 0, b = 0] = host.split('.').map(Number);
      if (a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 || a === 198 && [18, 19].includes(b)) return null;
    }
    for (const key of url.searchParams.keys()) if (/(token|auth|password|secret|cookie|signature|api.?key|credential)/i.test(key)) return null;
    return url.href;
  } catch { return null; }
}

/** Whitelist public source hints, never headers, credentials, or executable URLs. */
export function normalizeMoment(input: unknown): Moment | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const { startMs, endMs, episode, mediaKey, posterKey, durationMs } = raw;
  if (raw['version'] !== 1 || typeof startMs !== 'number' || !Number.isFinite(startMs) || startMs < 0 || typeof endMs !== 'number' || !Number.isFinite(endMs) || endMs <= startMs || endMs - startMs > MAX_MOMENT_DURATION_MS) return null;
  if (episode !== null && (typeof episode !== 'number' || !Number.isFinite(episode) || episode < 0 || episode > 1_000_000)) return null;
  if (typeof mediaKey !== 'string' || !isMediaHash(mediaKey)) return null;
  if (posterKey !== undefined && (typeof posterKey !== 'string' || !isMediaHash(posterKey))) return null;
  if (durationMs !== undefined && (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_MOMENT_DURATION_MS || Math.abs(durationMs - (endMs - startMs)) > 250)) return null;
  const moment: Moment = { version: 1, startMs: Math.round(startMs), endMs: Math.round(endMs), episode, mediaKey };
  if (moment.endMs <= moment.startMs) return null;
  if (posterKey !== undefined) moment.posterKey = posterKey as string;
  if (durationMs !== undefined) moment.durationMs = Math.round(durationMs as number);
  if (raw['sources'] !== undefined) {
    if (!Array.isArray(raw['sources']) || raw['sources'].length > 8) return null;
    const sources: MomentSource[] = [];
    for (const source of raw['sources']) {
      if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
      const url = publicUrl(source.url);
      if (!url) return null;
      const hint: MomentSource = { url };
      for (const key of ['title', 'quality', 'mimeType'] as const) {
        if (typeof source[key] === 'string' && source[key].trim()) hint[key] = source[key].trim().slice(0, 200);
      }
      sources.push(hint);
    }
    moment.sources = sources;
  }
  return moment;
}
