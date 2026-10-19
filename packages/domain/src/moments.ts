/** Source hints are resolved on the recipient's device; the worker never fetches them. */
export interface MomentSource {
  sourceId?: string;
  server?: string;
  url?: string;
  title?: string;
  quality?: string;
  mimeType?: string;
}
export interface Moment {
  version: 1;
  startMs: number;
  endMs: number;
  episode: number | null;
  sources: MomentSource[];
  posterKey?: string;
}
export const MAX_MOMENT_DURATION_MS = 70_000;

function publicUrl(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 2000) return null;
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) return null;
    // Reject local network targets, including normalized numeric and mapped IPv6 IPs.
    if (!host.includes('.') || host.includes(':') || /\.(localhost|local|internal|test|invalid)$/.test(host)) return null;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const [a = 0, b = 0] = host.split('.').map(Number);
      if (a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 || a === 198 && [18, 19].includes(b)) return null;
    }
    // Public expiring CDN URLs remain useful; personal credentials are never hints.
    for (const key of url.searchParams.keys()) if (/^(password|passwd|secret|cookie|authorization|credential|api[_-]?key)$/i.test(key)) return null;
    return url.href;
  } catch { return null; }
}
function hintText(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

/** Keep a small, credential-free whitelist; old recommendations omit this object. */
export function normalizeMoment(input: unknown): Moment | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const { startMs, endMs, episode, posterKey } = raw;
  if (raw['version'] !== 1 || typeof startMs !== 'number' || !Number.isFinite(startMs) || startMs < 0 || typeof endMs !== 'number' || !Number.isFinite(endMs) || endMs <= startMs || endMs - startMs > MAX_MOMENT_DURATION_MS) return null;
  if (episode !== null && (typeof episode !== 'number' || !Number.isFinite(episode) || episode < 0 || episode > 1_000_000)) return null;
  if (posterKey !== undefined && (typeof posterKey !== 'string' || !/^[0-9a-f]{64}$/.test(posterKey))) return null;
  const moment: Moment = { version: 1, startMs: Math.round(startMs), endMs: Math.round(endMs), episode, sources: [] };
  if (!Number.isSafeInteger(moment.startMs) || !Number.isSafeInteger(moment.endMs) || moment.endMs <= moment.startMs) return null;
  if (posterKey !== undefined) moment.posterKey = posterKey as string;
  if (raw['sources'] !== undefined) {
    if (!Array.isArray(raw['sources']) || raw['sources'].length > 8) return null;
    for (const source of raw['sources']) {
      if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
      const hint: MomentSource = {};
      for (const key of ['sourceId', 'server', 'title', 'quality', 'mimeType'] as const) {
        const text = hintText(source[key], key === 'sourceId' ? 300 : key === 'server' ? 160 : 200);
        if (text) {
          const embeddedUrl = text.slice(text.lastIndexOf('|') + 1);
          if (/^https?:\/\//i.test(embeddedUrl) && !publicUrl(embeddedUrl)) return null;
          hint[key] = text;
        }
      }
      if (source.url !== undefined) {
        const url = publicUrl(source.url);
        if (!url) return null;
        hint.url = url;
      }
      if (!hint.sourceId && !hint.server && !hint.url) return null;
      moment.sources.push(hint);
    }
  }
  return moment;
}
