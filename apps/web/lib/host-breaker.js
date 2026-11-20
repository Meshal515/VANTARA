/**
 * قاطع دائرة لكل مضيف — نسخة الويب والويندوز (docs/addons/PERSISTENT_PLUGINS.md §3.4، قرار 13).
 *
 * نفس قواعد المرجع الأصلي في Android (HostCircuitBreaker.kt)، مكتوبة هنا بلا اعتماد عليه:
 *  - 429 أو 503 مع `Retry-After`: يتوقف المضيف المدة التي طلبها الموقع (حتى 6 ساعات).
 *  - ثلاثة ردود 429/5xx متتالية: يتوقف 30 ثانية، ثم يتضاعف مع كل فتح جديد حتى 6 ساعات.
 *  - بعد انتهاء التوقف يكفي فشل واحد ليعود (نصف مفتوح)، وأي رد سليم يعيد العدّاد للصفر.
 *  - أخطاء الشبكة والإلغاء والمهلة لا تُحسب: انقطاع الجهاز ليس خللًا في الموقع.
 *
 * القاطع مشترك بين كل الإضافات ولغاتها ومصادر المانجا على الجهاز نفسه، فعشر لغات لموقع واحد
 * تتشارك التوقف نفسه بدل أن تضاعف الطلبات على موقع طلب التوقف.
 *
 * نوع الخطأ يحدد نطاقه (AW26): 429 و502/503/504 و520-530 (الموقع مشغول أو ساقط) تخص المضيف كله. أما 500 وأخواته
 * فغالبًا صفحة عمل معطوبة: كانت ثلاثة أعمال معطوبة متتالية توقف الإضافة لكل الأعمال حتى 6 ساعات. الآن تُعدّ على
 * الصفحة نفسها (المضيف + المسار) فيتوقف ذلك العمل وحده، ولا يُعدّ المضيف ساقطًا إلا إن فشلت HOST_SPREAD صفحات
 * مختلفة متتالية بلا رد سليم بينها.
 */

import { siteStatusMessage } from './plugin-failure.js';

export const BREAKER = Object.freeze({ THRESHOLD: 3, BASE_MS: 30_000, MAX_MS: 6 * 60 * 60 * 1000, MAX_HOSTS: 2000, HOST_SPREAD: 6 });
/** حالات تعني أن الموقع نفسه مشغول أو ساقط (لا صفحة بعينها). */
export const hostWide = (code) => code === 429 || code === 502 || code === 503 || code === 504 || (code >= 520 && code <= 530);

/** مفتاح الصفحة داخل المضيف (المسار والاستعلام)، أو '' إن لم يصلح الرابط. */
export function pathOf(url) {
  try {
    const u = new URL(String(url));
    return `${u.pathname}${u.search}`.slice(0, 512);
  } catch {
    return '';
  }
}
export const HOST_COOLING = 'HOST_COOLING';

/** الموقع طلب التوقف مؤقتًا. الرسالة تقول بصراحة إن الخلل من الموقع. */
export class HostCoolingError extends Error {
  constructor(host, waitMs) {
    super(`الموقع ${host} طلب التوقف مؤقتًا؛ نعاود بعد ${Math.ceil(waitMs / 1000)} ثانية (الخلل من الموقع لا من VANTARA)`);
    this.name = 'HostCoolingError';
    this.code = HOST_COOLING;
    this.host = host;
    this.waitMs = waitMs;
    this.fromSite = true;
  }
}

/** `Retry-After` بالثواني أو بتاريخ HTTP، بالمللي ثانية، أو null. */
export function retryAfterMs(value, now = Date.now()) {
  const v = String(value ?? '').trim().slice(0, 64);
  if (!v) return null;
  if (/^\d{1,10}$/.test(v)) return Number(v) * 1000;
  if (/^-?\d+$/.test(v)) return null;
  const at = Date.parse(v);
  if (!Number.isFinite(at)) return null;
  const ms = at - now;
  return ms > 0 ? ms : null;
}

/** المضيف بحروف صغيرة من رابط، أو '' إن لم يصلح. */
export function hostOf(url) {
  try {
    return new URL(String(url)).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function createHostBreaker({ now = () => Date.now() } = {}) {
  /** host → { failures, opens, openUntil } */
  const hosts = new Map();

  function stateOf(host) {
    let s = hosts.get(host);
    if (!s) {
      // حد لعدد المضيفات حتى لا تكبر الذاكرة بلا حد: الأقدم الهادئ يُنسى أولًا
      if (hosts.size >= BREAKER.MAX_HOSTS) {
        for (const [key, value] of hosts) {
          if (value.openUntil <= now()) { hosts.delete(key); break; }
        }
        if (hosts.size >= BREAKER.MAX_HOSTS) hosts.delete(hosts.keys().next().value);
      }
      s = { failures: 0, opens: 0, openUntil: 0 };
      hosts.set(host, s);
    }
    return s;
  }

  /** المدة المتبقية قبل السماح بطلب لهذا المضيف، أو null إن كان مسموحًا. */
  function waitMs(host) {
    const s = hosts.get(String(host ?? '').toLowerCase());
    if (!s) return null;
    const left = s.openUntil - now();
    return left > 0 ? left : null;
  }

  const pageKey = (h, path) => `${h} ${path}`;

  /** يرمي HostCoolingError إن كان المضيف متوقفًا، أو الصفحة نفسها إن أُعطي مسارها. */
  function assertAllowed(host, path = '') {
    const h = String(host ?? '').toLowerCase();
    const left = h ? waitMs(h) ?? (path ? waitMs(pageKey(h, path)) : null) : null;
    if (left != null) throw new HostCoolingError(h, left);
  }

  const open = (s, asked) => {
    if (asked != null) {
      s.openUntil = now() + Math.min(asked, BREAKER.MAX_MS);
    } else if (s.failures >= BREAKER.THRESHOLD) {
      s.openUntil = now() + Math.min(BREAKER.BASE_MS * 2 ** Math.min(s.opens, 20), BREAKER.MAX_MS);
      s.opens += 1;
      s.failures = BREAKER.THRESHOLD - 1;
    }
  };

  /** نتيجة رد HTTP فعلي من المضيف. `retryAfter` بالمللي ثانية أو null. `path` صفحة الطلب (AW26). */
  function record(host, status, retryAfter = null, path = '') {
    const h = String(host ?? '').toLowerCase();
    const code = Number(status);
    if (!h || !Number.isInteger(code) || code < 100 || code > 599) return;
    if (code !== 429 && code < 500) {
      const s = hosts.get(h);
      if (s) { s.failures = 0; s.opens = 0; s.spread = null; }
      const p = path && hosts.get(pageKey(h, path));
      if (p) { p.failures = 0; p.opens = 0; }
      return;
    }
    // صفحة معطوبة (500 وأخواته): تُعدّ عليها هي، والمضيف لا يُعدّ ساقطًا إلا بانتشار الفشل على صفحات مختلفة
    if (path && !hostWide(code)) {
      const p = stateOf(pageKey(h, path));
      p.failures += 1;
      open(p, null);
      const s = stateOf(h);
      s.spread ??= new Set();
      s.spread.add(path);
      if (s.spread.size >= BREAKER.HOST_SPREAD) {
        s.failures = BREAKER.THRESHOLD;
        open(s, null);
        s.spread = null;
      }
      return;
    }
    const s = stateOf(h);
    s.failures += 1;
    const asked = (code === 429 || code === 503) && Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null;
    open(s, asked);
  }

  return { waitMs, assertAllowed, record, reset: () => hosts.clear(), size: () => hosts.size };
}

let shared = null;
/** القاطع المشترك للتطبيق كله (كل الإضافات ومصادر الويب في هذا السياق). */
export function sharedHostBreaker() {
  shared ??= createHostBreaker();
  return shared;
}

const headerOf = (headers, name) => {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === name) return v;
  return null;
};

/**
 * يغلّف جالب مصادر (`text/page/json` بشكل pwa/net/fetcher.js أو desktop/source-fetcher.js):
 * كل طلب لمضيف متوقف يُرفض قبل الشبكة، وكل رد حقيقي يُسجَّل بحالته و`Retry-After` إن وصل.
 * `page` و`json` يمرّان بـ`text` المغلّف فلا يُعدّ الرد مرتين.
 */
export function guardFetcher(fetcher, breaker = sharedHostBreaker()) {
  if (!fetcher || typeof fetcher.text !== 'function') return fetcher;
  const text = async (url, opts) => {
    const host = hostOf(url);
    const path = pathOf(url);
    breaker.assertAllowed(host, path);
    let out;
    try {
      out = await fetcher.text(url, opts);
    } catch (error) {
      // رد الموقع نفسه فقط (صفحة تحقق أو حالة HTTP). أخطاء الجالب (حده، جلسته، مهلته) والشبكة
      // والإلغاء ليست ردًا من الموقع فلا تُحسب عليه
      if (Number.isInteger(error?.status) && error.status >= 400 && ['http', 'challenge'].includes(error?.code))
        breaker.record(host, error.status, retryAfterMs(error.retryAfter), path);
      throw error;
    }
    if (Number.isInteger(out?.status) && out.status > 0)
      breaker.record(host, out.status, retryAfterMs(headerOf(out.headers, 'retry-after')), path);
    return out;
  };
  const page = async (url, opts = {}) => {
    const out = await text(url, opts);
    if (out.status && (out.status < 200 || out.status >= 300))
      throw Object.assign(new Error(siteStatusMessage(out.status)), { name: 'FetchError', code: 'http', status: out.status, host: hostOf(url) });
    return out;
  };
  const json = async (url, opts = {}) => {
    const out = await page(url, { ...opts, headers: { accept: 'application/json, text/plain, */*', ...(opts.headers ?? {}) } });
    try {
      return JSON.parse(out.text);
    } catch {
      throw Object.assign(new Error('المصدر ردّ بغير JSON'), { name: 'FetchError', code: 'bad_json', host: hostOf(url) });
    }
  };
  return { ...fetcher, text, page, json };
}

/**
 * يغلّف نقل الإضافات (`text/json` بشكل addons/transport.js): نفس القاعدة. أخطاء HTTP من النقل
 * تحمل `status` و`retryAfter`، وما سواها (شبكة، CORS، إلغاء، مهلة) لا يُحسب.
 */
export function guardTransport(transport, breaker = sharedHostBreaker()) {
  if (!transport || typeof transport.text !== 'function' || transport.guarded) return transport;
  const wrap = (method) => async (url, options) => {
    const host = hostOf(url);
    const path = pathOf(url);
    breaker.assertAllowed(host, path);
    try {
      const out = await transport[method](url, options);
      breaker.record(host, 200, null, path);
      return out;
    } catch (error) {
      if (Number.isInteger(error?.status)) breaker.record(host, error.status, retryAfterMs(error.retryAfter), path);
      throw error;
    }
  };
  // json لا يمرّ بـtext المغلّف (النقل الأصلي ينادي text داخله)، فيُغلّف كلٌ مرة واحدة
  return { ...transport, text: wrap('text'), json: wrap('json'), guarded: true };
}
