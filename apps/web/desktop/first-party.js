import { endpoints } from '../lib/config.js';

const PRODUCTION='https://vantara-sync.ngm-309.workers.dev';
const originOf=value=>{try{return new URL(value).origin;}catch{return null;}};
/**
 * طلبات خادم المزامنة عبر العملية الرئيسية (بلا CORS). الخادم هو ما في «عناوين الخادم» إن غيّره المستخدم، لا عنوان
 * مكتوب في الكود (خطة «Cloudflare طبقة اختيارية» العمود 4): يُعلن للعملية الرئيسية مرة عند الإقلاع.
 */
export function installFirstPartyTransport(g=globalThis, { server=()=>endpoints().sync }={}) {
  if(!g.VantaraDesktop?.requestFirstParty||!g.fetch||g.VantaraFirstPartyTransport)return false;
  const original=g.fetch.bind(g);
  let target=PRODUCTION;
  try{target=originOf(server())??PRODUCTION;}catch{/* إعداد غير مقروء: الأصلي */}
  const ready=target!==PRODUCTION&&typeof g.VantaraDesktop.setFirstPartyOrigin==='function'
    ?Promise.resolve(g.VantaraDesktop.setFirstPartyOrigin({origin:target})).catch(()=>false):Promise.resolve(true);
  g.fetch=async(input,options={})=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,g.location?.href??'vantara://app/');
    if(url.origin!==target||!url.pathname.startsWith('/v1/'))return original(input,options);
    await ready;
    const request=new Request(input instanceof Request?input:url.href,options);
    if(request.signal.aborted)throw new DOMException('ألغي الطلب','AbortError');
    const headers=Object.fromEntries(request.headers);
    const payload={url:request.url,method:request.method,headers};
    if(!['GET','HEAD'].includes(request.method)){
      if(/^(application\/json|text\/)/i.test(request.headers.get('content-type')??''))payload.body=await request.text();
      else{const bytes=new Uint8Array(await request.arrayBuffer());if(bytes.length>4*1024*1024)throw new Error('الملف أكبر من الحد');let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));payload.bodyBase64=btoa(raw);}
    }
    const out=await g.VantaraDesktop.requestFirstParty(payload);
    if(request.signal.aborted)throw new DOMException('ألغي الطلب','AbortError');
    return new Response(out.status===204?null:out.text,{status:out.status,headers:out.headers});
  };
  g.VantaraFirstPartyTransport=true;
  return true;
}
