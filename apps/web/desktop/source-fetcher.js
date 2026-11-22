import { publicUrl } from '../addons/manifest.js';

/**
 * مضيفات طلبت تحققًا بيد إنسان (بقيت صفحة التحقق بعد المتصفح المخفي): سجل واحد يقرؤه جسر «التحقق» في ويندوز
 * (boot.js) فيظهر المصدر في «تحتاج تحقق» وزر «تحقق» يفتح الصفحة الظاهرة، كالـAPK. لا يفتح نافذة وحده أبدًا.
 */
const challenged = new Map();
const watchers = new Set();
export const desktopChallenges = Object.freeze({
  report(host) {
    const name = String(host ?? '').toLowerCase();
    if (!name || challenged.has(name)) return;
    if (challenged.size >= 24) challenged.delete(challenged.keys().next().value);
    challenged.set(name, { host: name, state: 'required', kind: 'manga' });
    for (const fn of watchers) { try { fn(challenged.get(name)); } catch { /* مستمع لا يكسر الجلب */ } }
  },
  clear(host) { challenged.delete(String(host ?? '').toLowerCase()); },
  pending: () => [...challenged.values()].map((item) => ({ ...item })),
  subscribe(fn) { watchers.add(fn); return () => watchers.delete(fn); },
});

const ALLOWED = new Set(['accept','accept-language','content-type','referer','user-agent','x-requested-with','x-csrf-token']);
export function createDesktopFetcher(bridge) {
  async function text(url, options = {}) {
    if (options.signal?.aborted) throw new DOMException('ألغي الطلب','AbortError');
    const headers = {};
    for (const [key,value] of Object.entries(options.headers ?? {})) {
      if (!ALLOWED.has(key.toLowerCase())) throw new Error('ترويسة المصدر غير مسموحة');
      headers[key.toLowerCase()] = value;
    }
    if (options.referer) headers.referer = publicUrl(options.referer).href;
    if (options.xhr) headers['x-requested-with'] = 'XMLHttpRequest';
    let body = options.body;
    if (options.form) { body = new URLSearchParams(options.form).toString(); headers['content-type'] = 'application/x-www-form-urlencoded'; }
    const out = await bridge.requestResource({url:publicUrl(url).href,headers,method:options.method ?? (body == null ? 'GET':'POST'),body,follow:options.follow !== false});
    if (options.signal?.aborted) throw new DOMException('ألغي الطلب','AbortError');
    // صفحة تحقق بقيت بعد المتصفح المخفي (تحقق يطلب إنسانًا): السبب بدل قائمة فارغة («One moment» كانت تمر صامتة)
    if (/just a moment|cf-chl-|checking your browser|<title>\s*one moment,? please|sgcaptcha/i.test(out.text ?? '')) {
      const host = new URL(out.url ?? url).hostname;
      desktopChallenges.report(host);
      throw Object.assign(new Error('المصدر يطلب تحققًا من المتصفح'),{code:'challenge',host});
    }
    return {...out,url:out.url ?? url,headers:out.headers ?? {},challenge:'none'};
  }
  async function page(url,opts) { const out=await text(url,opts); if(out.status<200||out.status>=300)throw Object.assign(new Error(`المصدر أعاد ${out.status}`),{status:out.status,code:'http'});return out; }
  return {text,page,json:async(url,opts)=>JSON.parse((await page(url,opts)).text),ensureGrant:async()=>null,mediaUrl:url=>publicUrl(url).href};
}
