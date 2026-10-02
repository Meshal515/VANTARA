/**
 * جالب الويب — للـPWA وحدها (docs/PWA.md).
 *
 * المتصفح لا يقدر يطلب مواقع المصادر مباشرة: لا تسمح له (CORS)، ولا يضبط
 * `Referer` الذي تشترطه مضيفات الصور والفيديو. هذا الـWorker يطلبها نيابةً عنه:
 *
 *   POST /v1/fetch   صفحة أو JSON (GET/POST) بترويسات وكوكيز يمرّرها المصدر.
 *   POST /v1/grant   إذن قصير للوسائط (12 ساعة).
 *   GET  /v1/media   صورة أو فيديو أو قائمة HLS بالإذن (Range مدعوم).
 *   GET  /health     حيّ؟  ·  GET /health/hosts?h=…  هل يصل الجالب لمواقعنا؟
 *
 * لا يحلّل HTML ولا يعرف مصدرًا: المحركات تعمل في المتصفح (DOMParser)، فهنا
 * لا شيء يستهلك وقت المعالج المحدود (10ms في الخطة المجانية) غير التمرير.
 * والـAPK لا يناديه أبدًا: له محرّكه الأصلي.
 */

import { verifyIdentityToken } from '@vantara/domain';
import allowJson from '../../../apps/web/pwa/sources/allow.json';
import { hostAllowed, targetAllowed, type AllowList } from './allow.ts';
import { mintGrant, verifyGrant } from './grant.ts';
import { isPlaylist, rewritePlaylist } from './hls.ts';

export interface Env {
  VANTARA_IDENTITY_SECRET: string;
  ALLOWED_ORIGINS?: string;
}

const ALLOW: AllowList = { hosts: (allowJson as { hosts: string[] }).hosts };

/** متصفح جوال حقيقي: بعض المواقع ترفض وكيلًا لا يشبه متصفحًا. */
export const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

const UPSTREAM_TIMEOUT_MS = 25_000;
const MAX_REDIRECTS = 6;
const MAX_BODY_FOR_POST = 64 * 1024;
/** حدّ لطيف لكل مستخدم في الدقيقة داخل نفس النسخة؛ يمنع حلقة خاطئة من الاستنزاف. */
const PER_MINUTE = 900;

const FORWARDED = ['referer', 'origin', 'accept', 'content-type', 'x-requested-with', 'accept-language'] as const;

// ───────────────────────── CORS ─────────────────────────

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('origin');
  if (!origin || !allowedOrigins(env).includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, range',
    'access-control-expose-headers': 'x-vf-status, x-vf-url, x-vf-set-cookie, x-vf-challenge, content-range, accept-ranges, content-length',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

function json(status: number, body: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors },
  });
}

// ───────────────────────── الهوية والحدود ─────────────────────────

async function bearerUser(request: Request, env: Env): Promise<string | null> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const claims = await verifyIdentityToken(token, env.VANTARA_IDENTITY_SECRET);
  return claims?.userId ?? null;
}

const windows = new Map<string, { minute: number; count: number }>();
export function overLimit(userId: string, now = Date.now()): boolean {
  const minute = Math.floor(now / 60_000);
  const w = windows.get(userId);
  if (!w || w.minute !== minute) {
    windows.set(userId, { minute, count: 1 });
    if (windows.size > 500) for (const [k, v] of windows) if (v.minute !== minute) windows.delete(k);
    return false;
  }
  w.count += 1;
  return w.count > PER_MINUTE;
}

// ───────────────────────── الجلب من المصدر ─────────────────────────

export class FetchFailure extends Error {
  constructor(
    readonly code: 'host_not_allowed' | 'foreign_redirect' | 'too_many_redirects' | 'upstream_timeout' | 'upstream_error',
    readonly detail: string = '',
  ) {
    super(code);
  }
}

interface UpstreamInit {
  method: 'GET' | 'POST';
  headers: Headers;
  body?: string | undefined;
  /** كوكيز من المصدر نفسه (`a=1; b=2`): بعض المواقع تربط الطلب بكوكي الصفحة. */
  cookies?: string | undefined;
  range?: string | null | undefined;
}

/** كوكيز الرد بلا خصائصها (`name=value` فقط). */
function cookiePairs(response: Response): string[] {
  const all = typeof (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === 'function'
    ? (response.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
    : (response.headers.get('set-cookie') ?? '').split(/,(?=\s*[^;,=\s]+=)/);
  return all.map((c) => c.split(';')[0]?.trim() ?? '').filter((c) => c.includes('='));
}

function mergeCookies(base: string | undefined, add: string[]): string | undefined {
  const jar = new Map<string, string>();
  for (const pair of [...(base ?? '').split(';'), ...add]) {
    const p = pair.trim();
    const i = p.indexOf('=');
    if (i > 0) jar.set(p.slice(0, i), p.slice(i + 1));
  }
  return jar.size ? [...jar].map(([k, v]) => `${k}=${v}`).join('; ') : undefined;
}

/**
 * يجلب ويتبع التحويلات يدويًا: كل قفزة يجب أن تكون في القائمة، وإلا
 * `foreign_redirect` باسم الوجهة (نفس «المصدر حوّل إلى موقع غريب» في الـAPK).
 */
export async function upstream(target: URL, init: UpstreamInit, list: AllowList, fetchImpl: typeof fetch = fetch) {
  let url = target;
  let method = init.method;
  let body = init.body;
  let cookies = init.cookies;
  const collected: string[] = [];
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!hostAllowed(url.hostname, list)) throw new FetchFailure(hop === 0 ? 'host_not_allowed' : 'foreign_redirect', url.hostname);
    const headers = new Headers(init.headers);
    if (!headers.has('user-agent')) headers.set('user-agent', USER_AGENT);
    if (!headers.has('accept-language')) headers.set('accept-language', 'ar,en;q=0.8');
    if (cookies) headers.set('cookie', cookies);
    if (init.range) headers.set('range', init.range);
    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method,
        headers,
        body: method === 'POST' && body !== undefined ? body : null,
        redirect: 'manual',
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (error) {
      const name = (error as { name?: string })?.name;
      throw new FetchFailure(name === 'TimeoutError' || name === 'AbortError' ? 'upstream_timeout' : 'upstream_error', String((error as Error)?.message ?? error).slice(0, 200));
    }
    const fresh = cookiePairs(response);
    collected.push(...fresh);
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        return { response, finalUrl: url, setCookies: collected };
      }
      if (next.protocol !== 'https:' && next.protocol !== 'http:') return { response, finalUrl: url, setCookies: collected };
      // كوكيز القفزة تتبع الطلب داخل نفس الموقع فقط
      cookies = next.hostname === url.hostname ? mergeCookies(cookies, fresh) : undefined;
      // 303 دائمًا GET؛ و301/302 بعد POST كذلك كما تفعل المتصفحات
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
        method = 'GET';
        body = undefined;
      }
      url = next;
      continue;
    }
    return { response, finalUrl: url, setCookies: collected };
  }
  throw new FetchFailure('too_many_redirects', url.hostname);
}

/** صفحة تحدٍّ من Cloudflare؟ `js` يُحلّ بلا إنسان أحيانًا، و`interactive` يحتاج إنسانًا. */
export function challengeOf(status: number, text: string): 'none' | 'js' | 'interactive' {
  if (status !== 403 && status !== 503 && status !== 429) return 'none';
  if (/cf-turnstile|challenges\.cloudflare\.com\/turnstile/i.test(text)) return 'interactive';
  if (/just a moment|cf-chl|challenge-platform|cf_chl_opt/i.test(text)) return 'js';
  return 'none';
}

// ───────────────────────── المسارات ─────────────────────────

async function handleFetch(request: Request, env: Env, cors: Record<string, string>, fetchImpl: typeof fetch): Promise<Response> {
  const userId = await bearerUser(request, env);
  if (!userId) return json(401, { error: 'unauthorized' }, cors);
  if (overLimit(userId)) return json(429, { error: 'rate_limited' }, cors);

  let input: {
    url?: unknown;
    method?: unknown;
    headers?: unknown;
    body?: unknown;
    cookies?: unknown;
  };
  try {
    input = (await request.json()) as typeof input;
  } catch {
    return json(400, { error: 'bad_request' }, cors);
  }
  const target = targetAllowed(input.url, ALLOW);
  if (!target) return json(403, { error: 'host_not_allowed', host: safeHost(input.url) }, cors);
  const method = input.method === 'POST' ? 'POST' : 'GET';
  const body = typeof input.body === 'string' ? input.body : undefined;
  if (body && body.length > MAX_BODY_FOR_POST) return json(413, { error: 'body_too_large' }, cors);

  const headers = new Headers();
  if (input.headers && typeof input.headers === 'object') {
    for (const name of FORWARDED) {
      const value = (input.headers as Record<string, unknown>)[name];
      if (typeof value === 'string' && value.length < 2048) headers.set(name, value);
    }
  }
  const cookies = typeof input.cookies === 'string' && input.cookies.length < 8192 ? input.cookies : undefined;

  try {
    const { response, finalUrl, setCookies } = await upstream(target, { method, headers, body, cookies }, ALLOW, fetchImpl);
    const out = new Headers(cors);
    out.set('content-type', response.headers.get('content-type') ?? 'application/octet-stream');
    out.set('cache-control', 'no-store');
    out.set('x-vf-status', String(response.status));
    out.set('x-vf-url', finalUrl.toString());
    if (setCookies.length) out.set('x-vf-set-cookie', encodeURIComponent(JSON.stringify(setCookies)));
    // صفحة تحدٍّ قصيرة: نقرؤها لنقول نوعها، والباقي يمرّ تيارًا بلا قراءة
    if ([403, 429, 503].includes(response.status) && (response.headers.get('content-type') ?? '').includes('html')) {
      const text = await response.text();
      out.set('x-vf-challenge', challengeOf(response.status, text));
      return new Response(text, { status: 200, headers: out });
    }
    return new Response(response.body, { status: 200, headers: out });
  } catch (error) {
    if (error instanceof FetchFailure) {
      const status = error.code === 'upstream_timeout' ? 504 : error.code === 'upstream_error' ? 502 : 403;
      return json(status, { error: error.code, detail: error.detail }, cors);
    }
    return json(502, { error: 'upstream_error' }, cors);
  }
}

function safeHost(raw: unknown): string | null {
  try {
    return typeof raw === 'string' ? new URL(raw).hostname : null;
  } catch {
    return null;
  }
}

async function handleGrant(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const userId = await bearerUser(request, env);
  if (!userId) return json(401, { error: 'unauthorized' }, cors);
  return json(200, await mintGrant(userId, env.VANTARA_IDENTITY_SECRET), cors);
}

/** صورة أو فيديو أو قائمة HLS بإذن في الرابط (`<img>`/`<video>` لا يرسلان ترويسات). */
async function handleMedia(request: Request, env: Env, cors: Record<string, string>, fetchImpl: typeof fetch): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const userId = await verifyGrant(params.get('g'), env.VANTARA_IDENTITY_SECRET);
  if (!userId) return json(401, { error: 'unauthorized' }, cors);
  if (overLimit(userId)) return json(429, { error: 'rate_limited' }, cors);
  const target = targetAllowed(params.get('u'), ALLOW);
  if (!target) return json(403, { error: 'host_not_allowed', host: safeHost(params.get('u')) }, cors);
  const referer = params.get('r');
  const headers = new Headers({ accept: request.headers.get('accept') ?? '*/*' });
  if (referer && /^https?:\/\//.test(referer)) headers.set('referer', referer);

  try {
    const { response, finalUrl } = await upstream(target, { method: 'GET', headers, range: request.headers.get('range') }, ALLOW, fetchImpl);
    const out = new Headers(cors);
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
      const value = response.headers.get(name);
      if (value) out.set(name, value);
    }
    if (isPlaylist(response.headers.get('content-type'), finalUrl.toString()) && response.ok) {
      const text = await response.text();
      const self = new URL(request.url);
      const wrap = (absolute: string) => {
        const next = new URL('/v1/media', self.origin);
        next.searchParams.set('u', absolute);
        if (referer) next.searchParams.set('r', referer);
        next.searchParams.set('g', params.get('g') ?? '');
        return next.toString();
      };
      out.set('content-type', 'application/vnd.apple.mpegurl');
      out.delete('content-length');
      out.set('cache-control', 'no-store');
      return new Response(rewritePlaylist(text, finalUrl.toString(), wrap), { status: 200, headers: out });
    }
    // الصور تبقى في المتصفح؛ الفيديو لا يُخزَّن هنا ولا هناك
    const type = response.headers.get('content-type') ?? '';
    out.set('cache-control', type.startsWith('image/') && response.ok ? 'private, max-age=604800, immutable' : 'no-store');
    return new Response(response.body, { status: response.status, headers: out });
  } catch (error) {
    if (error instanceof FetchFailure) {
      return json(error.code === 'upstream_timeout' ? 504 : error.code === 'upstream_error' ? 502 : 403, { error: error.code, detail: error.detail }, cors);
    }
    return json(502, { error: 'upstream_error' }, cors);
  }
}

/**
 * هل يصل الجالب لمواقعنا؟ (عام، بلا محتوى): الحالة ونوع التحدي فقط، لمضيفات
 * القائمة وحدها. منه يُعرف هل Anime4Up يحتاج إنسانًا من شبكة Cloudflare.
 */
async function handleHosts(request: Request, cors: Record<string, string>, fetchImpl: typeof fetch): Promise<Response> {
  const asked = (new URL(request.url).searchParams.get('h') ?? '').split(',').map((h) => h.trim()).filter(Boolean).slice(0, 12);
  const results = await Promise.all(
    asked.map(async (host) => {
      const target = targetAllowed(`https://${host}/`, ALLOW);
      if (!target) return { host, error: 'host_not_allowed' };
      const started = Date.now();
      try {
        const { response, finalUrl } = await upstream(target, { method: 'GET', headers: new Headers({ accept: 'text/html' }) }, ALLOW, fetchImpl);
        const text = (await response.text()).slice(0, 20_000);
        return { host, status: response.status, finalHost: finalUrl.hostname, challenge: challengeOf(response.status, text), ms: Date.now() - started };
      } catch (error) {
        return { host, error: error instanceof FetchFailure ? error.code : 'upstream_error', detail: error instanceof FetchFailure ? error.detail : undefined, ms: Date.now() - started };
      }
    }),
  );
  return json(200, { checkedAt: new Date().toISOString(), results }, cors);
}

export function createHandler(fetchImpl: typeof fetch = fetch) {
  return async function handle(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const { pathname } = new URL(request.url);
    if (!env.VANTARA_IDENTITY_SECRET && pathname.startsWith('/v1/')) return json(503, { error: 'not_configured' }, cors);
    if (pathname === '/v1/fetch' && request.method === 'POST') return handleFetch(request, env, cors, fetchImpl);
    if (pathname === '/v1/grant' && request.method === 'POST') return handleGrant(request, env, cors);
    if (pathname === '/v1/media' && request.method === 'GET') return handleMedia(request, env, cors, fetchImpl);
    if (pathname === '/health/hosts' && request.method === 'GET') return handleHosts(request, cors, fetchImpl);
    if (pathname === '/health') return json(200, { ok: true, hosts: ALLOW.hosts.length }, cors);
    return json(404, { error: 'not_found' }, cors);
  };
}

export default { fetch: createHandler() };
