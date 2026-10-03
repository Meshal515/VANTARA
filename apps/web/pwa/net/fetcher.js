/**
 * عميل جالب الويب: كل طلب لموقع مصدر من الـPWA يمرّ من هنا.
 *
 *   text(url, opts)   → { status, url, text, challenge, cookies }
 *   json(url, opts)   → كائن JSON (أو يرمي FetchError)
 *   mediaUrl(url, r)  → رابط صورة/فيديو عبر الجالب بإذن قصير
 *
 * - التوكن من جلسة المزامنة نفسها؛ 401 ⇒ تجديد الجلسة مرة ثم إعادة.
 * - كوكيز كل موقع تُحفظ في الذاكرة وتُرسل معه (بعض المواقع تربط طلب
 *   السيرفرات بكوكي الصفحة).
 * - تعطّل الشبكة مرة ⇒ محاولة ثانية بعد لحظة؛ والمهلة لكل طلب محدودة.
 * - صفحة تحقق Cloudflare لا تُعامل كصفحة: `FetchError('challenge')`.
 */

import { fetchBase } from './endpoint.js';

/** ترويسات المصدر التي يمرّرها الجالب (services/web-fetcher PASSED_HEADERS). */
const PASSED_HEADERS = ['x-videa-xs'];

export class FetchError extends Error {
  /** @param {string} code @param {object} [info] */
  constructor(code, info = {}) {
    super(info.message ?? code);
    this.name = 'FetchError';
    this.code = code;
    Object.assign(this, info);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GRANT_KEY = 'vantara.fetch.grant';

/**
 * @param {{
 *   auth: { header: () => (string|null), refresh?: () => Promise<unknown> },
 *   base?: () => string,
 *   fetchImpl?: typeof fetch,
 *   storage?: Storage,
 *   timeoutMs?: number,
 *   now?: () => number,
 * }} deps
 */
export function createFetcher({ auth, base = () => fetchBase(), fetchImpl = (...a) => globalThis.fetch(...a), storage = globalThis.localStorage, timeoutMs = 30_000, now = () => Date.now() }) {
  /** @type {Map<string, Map<string, string>>} */
  const jars = new Map();
  let grant = readGrant();
  let granting = null;

  function readGrant() {
    try {
      const g = JSON.parse(storage?.getItem(GRANT_KEY) ?? 'null');
      return g && typeof g.grant === 'string' && typeof g.expiresAt === 'number' ? g : null;
    } catch {
      return null;
    }
  }

  const siteOf = (url) => {
    try {
      // الكوكي لموقع كامل (m.myseed.pics وmyseed.pics واحد): آخر جزأين
      return new URL(url).hostname.split('.').slice(-2).join('.');
    } catch {
      return '';
    }
  };

  function cookiesFor(url) {
    const jar = jars.get(siteOf(url));
    return jar && jar.size ? [...jar].map(([k, v]) => `${k}=${v}`).join('; ') : undefined;
  }

  function remember(url, pairs) {
    if (!pairs?.length) return;
    const site = siteOf(url);
    const jar = jars.get(site) ?? new Map();
    for (const pair of pairs) {
      const i = pair.indexOf('=');
      if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    jars.set(site, jar);
  }

  async function post(path, body, { signal, retried = false } = {}) {
    const header = auth.header();
    if (!header) throw new FetchError('signed_out', { message: 'سجّل دخولك أولًا' });
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal && AbortSignal.any ? AbortSignal.any([signal, timeout]) : signal ?? timeout;
    let res;
    try {
      res = await fetchImpl(`${base()}${path}`, {
        method: 'POST',
        headers: { authorization: header, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (error) {
      if (signal?.aborted) throw new FetchError('aborted');
      if (!retried) {
        await sleep(600);
        return post(path, body, { signal, retried: true });
      }
      throw new FetchError(error?.name === 'TimeoutError' ? 'timeout' : 'network', { message: 'تعذّر الوصول لجالب الويب' });
    }
    if (res.status === 401 && !retried && auth.refresh) {
      await auth.refresh().catch(() => {});
      return post(path, body, { signal, retried: true });
    }
    if (res.status === 429 && !retried) {
      await sleep(1500);
      return post(path, body, { signal, retried: true });
    }
    return res;
  }

  /**
   * @param {string} url
   * @param {{ method?: 'GET'|'POST', form?: Record<string,string|number>, body?: string,
   *           headers?: Record<string,string>, referer?: string, xhr?: boolean,
   *           signal?: AbortSignal, allowChallenge?: boolean, follow?: boolean }} [opts]
   */
  async function text(url, opts = {}) {
    const headers = { ...(opts.headers ?? {}) };
    if (opts.referer) headers.referer = opts.referer;
    if (opts.xhr) headers['x-requested-with'] = 'XMLHttpRequest';
    let body = opts.body;
    if (opts.form) {
      body = new URLSearchParams(Object.entries(opts.form).map(([k, v]) => [k, String(v)])).toString();
      headers['content-type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    }
    const method = opts.method ?? (body !== undefined ? 'POST' : 'GET');
    const res = await post('/v1/fetch', { url, method, headers, body, cookies: cookiesFor(url), ...(opts.follow === false ? { follow: false } : {}) }, { signal: opts.signal });
    if (!res.ok) {
      let info = {};
      try {
        info = await res.json();
      } catch {
        // رد غير JSON: الحالة تكفي
      }
      throw new FetchError(info.error ?? `fetcher_${res.status}`, { status: res.status, host: info.host ?? info.detail, message: messageOf(info.error, info.detail) });
    }
    const status = Number(res.headers.get('x-vf-status') ?? 0);
    const finalUrl = res.headers.get('x-vf-url') ?? url;
    const setCookie = res.headers.get('x-vf-set-cookie');
    if (setCookie) {
      try {
        remember(finalUrl, JSON.parse(decodeURIComponent(setCookie)));
      } catch {
        // ترويسة تالفة: نتجاهلها
      }
    }
    const challenge = res.headers.get('x-vf-challenge') ?? 'none';
    // ترويسات قليلة من المصدر يمرّرها الجالب باسم x-vf-h-<الاسم> (Videa: x-videa-xs)
    const passed = {};
    for (const name of PASSED_HEADERS) {
      const v = res.headers.get(`x-vf-h-${name}`);
      if (v) passed[name] = v;
    }
    const out = { status, url: finalUrl, text: await res.text(), challenge, location: res.headers.get('x-vf-location'), headers: passed };
    if (challenge !== 'none' && !opts.allowChallenge) {
      throw new FetchError('challenge', { status, challenge, host: hostOf(url), message: challenge === 'interactive' ? 'المصدر يطلب تحقق إنسان' : 'المصدر خلف حماية Cloudflare' });
    }
    return out;
  }

  /** نص الصفحة إن كانت 2xx، وإلا FetchError('http'). */
  async function page(url, opts = {}) {
    const out = await text(url, opts);
    if (out.status < 200 || out.status >= 300) throw new FetchError('http', { status: out.status, host: hostOf(url), message: `المصدر ردّ ${out.status}` });
    return out;
  }

  async function json(url, opts = {}) {
    const out = await page(url, { ...opts, headers: { accept: 'application/json, text/plain, */*', ...(opts.headers ?? {}) } });
    try {
      return JSON.parse(out.text);
    } catch {
      throw new FetchError('bad_json', { host: hostOf(url), message: 'المصدر ردّ بغير JSON' });
    }
  }

  /** إذن الوسائط (12 ساعة)، يُجدَّد قبل نهايته بعشر دقائق. */
  async function ensureGrant() {
    if (grant && grant.expiresAt - now() > 10 * 60_000) return grant.grant;
    granting ??= (async () => {
      const res = await post('/v1/grant', {});
      if (!res.ok) throw new FetchError('grant_failed', { status: res.status });
      grant = await res.json();
      try {
        storage?.setItem(GRANT_KEY, JSON.stringify(grant));
      } catch {
        // يبقى في الذاكرة
      }
      return grant.grant;
    })().finally(() => {
      granting = null;
    });
    return granting;
  }

  /** رابط وسائط عبر الجالب. يحتاج الإذن جاهزًا: نادِ `ensureGrant()` قبله مرة. */
  function mediaUrl(url, referer) {
    const params = new URLSearchParams({ u: url });
    if (referer) params.set('r', referer);
    params.set('g', grant?.grant ?? '');
    return `${base()}/v1/media?${params}`;
  }

  return { text, page, json, ensureGrant, mediaUrl, cookiesFor, currentGrant: () => grant };
}

export function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function messageOf(code, detail) {
  switch (code) {
    case 'host_not_allowed':
      return `الموقع غير مسموح للجالب${detail ? `: ${detail}` : ''}`;
    case 'foreign_redirect':
      return `المصدر حوّل إلى موقع غريب${detail ? `: ${detail}` : ''}`;
    case 'upstream_timeout':
      return 'المصدر ما ردّ في الوقت';
    case 'rate_limited':
      return 'طلبات كثيرة، لحظة وجرب';
    case 'unauthorized':
      return 'انتهت الجلسة، سجّل دخولك';
    default:
      return 'تعذّر الوصول للمصدر';
  }
}
