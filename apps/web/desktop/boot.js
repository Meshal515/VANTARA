import { isDesktop, loadDesktopSources } from '../pwa/platform.js';
import { createDesktopEngine } from './engine.js';
import { getRuntime as runtimeFor } from './runtime.js';
import { startDesktopDefaultAddons } from './default-addons.js';
import { installFirstPartyTransport } from './first-party.js';
import { startDesktopUpdateWatch } from './update-check.js';
import { installDesktopPlayer } from './player.js';

const message = error => String(error?.message ?? error ?? 'تعذر إكمال الطلب').replace(/(?:https?:\/\/|stremio:\/\/)[^\s]+/gi, '[رابط الخدمة]');
// Data adapters available on Windows. APK/Dex repository methods require Android.
const extensionMethods = new Set(['sources','prepare','popular','latest','catalogue','search','genre','series','chapters','pages','image','cover','sites','addSite','removeSite','clearImageCache']);
function element(document, tag, text, cls) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}

/** رابط إعداد الخدمة يصل إلى معاينة واضحة، لا تثبيت صامت ولا عرض الأسرار. */
export async function renderInstallPreview({ document = globalThis.document, registry, url } = {}) {
  const panel = element(document, 'section', null, 'desktop-install');
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'معاينة الإضافة');
  const close = element(document, 'button', 'إغلاق'); close.type = 'button'; close.onclick = () => panel.remove();
  panel.append(element(document, 'h2', 'معاينة الإضافة'), element(document, 'p', 'جارٍ قراءة بيانات الخدمة…'), close);
  try {
    const preview = await registry.inspect(url);
    const title = element(document, 'h2', preview.manifest.name);
    const info = element(document, 'p', `القدرات: ${(preview.manifest.capabilities ?? []).join('، ')}`);
    const permission = element(document, 'p', `تتصل الإضافة بالمضيفين: ${(preview.manifest.permissions?.networkHosts ?? []).join('، ')}`);
    const status = element(document, 'p', 'راجع الإضافة قبل حفظها.'); status.setAttribute('role', 'status');
    const install = element(document, 'button', 'تثبيت الإضافة'); install.type = 'button';
    install.onclick = async () => {
      install.disabled = true;
      try { await registry.install(preview); status.textContent = 'حُفظت الإضافة. افتح الإضافات لمراجعتها.'; install.remove(); }
      catch (error) { status.textContent = message(error); install.disabled = false; }
    };
    panel.replaceChildren(title, info, permission, status, install, close);
  } catch (error) { panel.replaceChildren(element(document, 'h2', 'تعذر معاينة الإضافة'), element(document, 'p', message(error)), close); }
  return panel;
}

export function installDesktopBridges(g = globalThis) {
  if (!isDesktop(g)) return null;
  if (g.VantaraDesktopBridges) return g.VantaraDesktopBridges;
  const onSourcesChanged = () => {
    const EventType = g.document?.defaultView?.CustomEvent ?? g.CustomEvent ?? globalThis.CustomEvent;
    if (g.document?.dispatchEvent && EventType) g.document.dispatchEvent(new EventType('vantara:addons-changed'));
  };
  const getRuntime = () => runtimeFor(g, { onSourcesChanged });
  installFirstPartyTransport(g);
  const engine = createDesktopEngine({ bridge: g.VantaraDesktop, getRuntime });
  installDesktopPlayer({g,bridge:g.VantaraDesktop,engine});
  let modules;
  const ExtensionEngine=new Proxy({}, {get(_,method){if(!extensionMethods.has(method))return undefined;return async args=>{
    const runtime=getRuntime();await runtime.ready;await runtime.addons.ready;
    if(['image','cover'].includes(method)){
      const source=runtime.addons.sources.source(args.sourceId);
      const url=method==='image'?(args.page?.imageUrl??args.page?.url):args.url;
      const referer=method==='image'?source?.imageReferer?.(args.page):runtime.addons.sources.def(args.sourceId)?.domain?`https://${runtime.addons.sources.def(args.sourceId).domain}/`:null;
      const out=await g.VantaraDesktop.requestResource({url,binary:true,limit:8*1024*1024,headers:referer?{referer}:{}});
      if(out.status<200||out.status>=300||!out.base64)throw new Error('تعذر جلب صورة المصدر');
      return {path:`data:${out.contentType};base64,${out.base64}`,bytes:0,cached:false};
    }
    const plugin=(await(modules??=loadDesktopSources(g))).MangaEngine;
    if(typeof plugin[method]!=='function')throw new Error('وظيفة المصدر غير متاحة');
    return plugin[method](args);
  };}});
  g.VantaraDesktopBridges = Object.freeze({ AnimeEngine:engine,ExtensionEngine,SourceRuntime:{getRuntime},AddonFabric:{runtime:async()=>({getRuntime})} });
  if(g.document&&g.location?.protocol==='vantara:'){
    const defaults=startDesktopDefaultAddons({runtime:getRuntime(),onStatus:onSourcesChanged});
    g.VantaraDesktopDefaults=defaults;
  }
  // أخطاء native تظهر أيضًا في واجهة الحسابات الحالية؛ لا تعتمد على toast الشاشة.
  let status, activeSession = null, ready = false;
  const show = (text, error = false) => {
    if (!g.document?.body || g.document.querySelector('.desktop-player')) return;
    if (!status?.isConnected) {
      status = element(g.document, 'div', null, 'desktop-playback-status');
      status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      Object.assign(status.style, { position: 'fixed', bottom: '20px', left: '20px', right: '20px', zIndex: '10000', padding: '14px', borderRadius: '12px', background: '#18161f', color: '#f3f4f8', fontFamily: 'sans-serif', direction: 'rtl', pointerEvents: 'none' });
      g.document.body.append(status);
    }
    status.textContent = text; status.hidden = false;
    status.style.border = error ? '1px solid #ff6b7d' : '1px solid #5fd49a';
  };
  engine.addListener('playerError', error => show(`تعذر التشغيل: ${message(error)}`, true));
  engine.addListener('desktopNotice',event=>show(message(event.message),true));
  g.VantaraDesktop.onEvent(event => {
    if (event.type === 'playback/preparing') { activeSession = event.session; ready = false; show('يبدأ المحرك ويجهّز بيانات الفيديو…'); }
    if (event.session === activeSession) {
      if (event.type === 'playback/ready') { ready = true; show('المشغل جاهز.'); }
      if (event.type === 'playback/progress' && status) {
        if (ready) status.hidden = true;
        else {
          const speed = Number.isFinite(event.downloadSpeed) ? ` · ${(event.downloadSpeed / 1048576).toFixed(2)} MB/s` : '';
          const peers = Number.isFinite(event.peers) ? ` · ${event.peers} متصلون` : '';
          show(`ينتظر بيانات الفيديو${speed}${peers}`);
        }
      }
      if (event.type === 'playback/closed' && status) { status.hidden = true; activeSession = null; }
    }
    if (event.type === 'addon/install') void (async () => {
      if (!g.document?.body) return;
      const addons = getRuntime().addons; await addons.ready;
      const panel = await renderInstallPreview({ document: g.document, registry: addons.registry, url: event.url });
      Object.assign(panel.style, { position: 'fixed', inset: '10% max(20px, 15%) auto', zIndex: '10001', padding: '24px', borderRadius: '16px', background: '#18161f', color: '#f3f4f8', direction: 'rtl', boxShadow: '0 12px 80px #000', maxHeight: '80vh', overflow: 'auto' });
      g.document.body.append(panel);
    })().catch(error => show(message(error), true));
  });
  g.VantaraDesktopUpdates = startDesktopUpdateWatch({ bridge: g.VantaraDesktop, doc: g.document });
  return g.VantaraDesktopBridges;
}
installDesktopBridges();
