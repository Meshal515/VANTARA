import { publicUrl } from '../addons/manifest.js';

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
    if (/just a moment|cf-chl-|checking your browser/i.test(out.text ?? '')) throw Object.assign(new Error('المصدر يطلب تحققًا من المتصفح'),{code:'challenge'});
    return {...out,url:out.url ?? url,headers:out.headers ?? {},challenge:'none'};
  }
  async function page(url,opts) { const out=await text(url,opts); if(out.status<200||out.status>=300)throw Object.assign(new Error(`المصدر أعاد ${out.status}`),{status:out.status,code:'http'});return out; }
  return {text,page,json:async(url,opts)=>JSON.parse((await page(url,opts)).text),ensureGrant:async()=>null,mediaUrl:url=>publicUrl(url).href};
}
