import { isDesktop, loadDesktopSources } from '../pwa/platform.js';
import { createDesktopEngine } from './engine.js';
import { getRuntime as runtimeFor } from './runtime.js';
import { startDesktopDefaultAddons } from './default-addons.js';
import { installFirstPartyTransport } from './first-party.js';
import { startDesktopUpdateWatch } from './update-check.js';
import { installDesktopPlayer } from './player.js';
import { desktopChallenges } from './source-fetcher.js';

const message = error => String(error?.message ?? error ?? 'تعذر إكمال الطلب').replace(/(?:https?:\/\/|stremio:\/\/)[^\s]+/gi, '[رابط الخدمة]');
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

/**
 * إضافة «التحقق» في ويندوز بشكل إضافة الـAPK (lib/source-verification.js): required/state، وpending، وbegin. الواجهة
 * نفسها («تحتاج تحقق» وزر «تحقق») تعمل كما في الجوال، والصفحة الظاهرة من العملية الرئيسية (source-browser.cjs).
 */
export function createDesktopVerification(bridge, challenges = desktopChallenges) {
  const listeners = { required: new Set(), state: new Set() };
  const emit = (name, item) => { for (const fn of listeners[name] ?? []) { try { fn(item); } catch { /* */ } } };
  challenges.subscribe((item) => emit('required', item));
  return Object.freeze({
    async addListener(name, fn) {
      const set = listeners[name];
      if (!set || typeof fn !== 'function') return { remove: async () => {} };
      set.add(fn);
      return { remove: async () => { set.delete(fn); } };
    },
    async pending() { return { pending: challenges.pending() }; },
    async begin({ host } = {}) {
      if (typeof bridge?.verifySource !== 'function') return { host, state: 'failed', reason: 'webview_unavailable' };
      const result = await bridge.verifySource({ host }).catch(() => ({ host, state: 'failed', reason: 'launch_failed' }));
      if (result?.state === 'verified') challenges.clear(host);
      emit('state', result);
      return result;
    },
  });
}

/**
 * «صفر مصادر مدمجة» في ويندوز (نظير LegacySourceIds.kt): حزمة مدمجة سابقًا (مصدر ويب بمعرّف `pkg`) ثُبّتت إضافة Mihon
 * (`pkg#id`) ⇒ مصدرها بلغة الويب نفسها (العربي افتراضًا) يظهر بالمعرّف القديم `pkg` ويختفي مصدر الويب، فالمكتبة والتقدّم
 * والتنزيلات تبقى بلا إعادة كتابة. `map`: المعرّف القديم ← الحقيقي.
 */
export function bridgeLegacySources(web = [], mine = []) {
  const webById = new Map(web.map((s) => [String(s?.id ?? ''), s]));
  const byPkg = new Map();
  for (const s of mine) { const pkg = String(s?.pkg ?? String(s?.id ?? '').split('#')[0]); if (!byPkg.has(pkg)) byPkg.set(pkg, []); byPkg.get(pkg).push(s); }
  const map = new Map();
  const chosen = new Set();
  for (const [pkg, list] of byPkg) {
    const def = webById.get(pkg);
    if (!def) continue;
    const lang = String(def.lang ?? 'ar').toLowerCase();
    const pick = list.find((s) => String(s.lang ?? '').toLowerCase() === lang) ?? list.find((s) => String(s.lang ?? '').toLowerCase() === 'ar') ?? list[0];
    map.set(pkg, String(pick.id));
    chosen.add(pick);
  }
  const list = [
    ...web.filter((s) => !map.has(String(s?.id ?? ''))),
    ...mine.map((s) => (chosen.has(s) ? { ...s, id: String(s.pkg ?? String(s.id).split('#')[0]), nativeId: String(s.id) } : s)),
  ];
  return { list, map };
}

export function installDesktopBridges(g = globalThis) {
  if (!isDesktop(g)) return null;
  if (g.VantaraDesktopBridges) return g.VantaraDesktopBridges;
  const getRuntime = () => runtimeFor(g);
  installFirstPartyTransport(g);
  const engine = createDesktopEngine({ bridge: g.VantaraDesktop, getRuntime });
  installDesktopPlayer({g,bridge:g.VantaraDesktop,engine});
  let modules;
  // الجسر يعلن ما يملكه فقط: كان يرد «موجودة» على أي اسم، فظنت الواجهة أن ويندوز يدير مستودعات Mihon وإضافاتها
  // (addRepo/installExtension) فتظهر للتثبيت ثم تفشل بـ«وظيفة المصدر غير متاحة».
  // ويندوز اليوم يشغّل إضافات Mihon بمحرك Suwayomi المحلي (apps/desktop/suwayomi-engine.cjs) حين يعلنه التطبيق
  // (`VantaraDesktop.mangaEngine`): المستودعات والتثبيت عبره، ومصادره `pkg#id` (معرّفات الـAPK نفسها) تُوجَّه إليه.
  const WEB_METHODS=['sources','prepare','popular','latest','catalogue','search','genre','series','chapters','pages','image','cover','sites','addSite','removeSite','clearImageCache'];
  const REPO_METHODS=['repos','addRepo','removeRepo','repoIndex','installExtension','uninstallExtension','updateState','rollbackExtension','engineState'];
  const native=typeof g.VantaraDesktop?.mangaEngine==='function'?(method,args)=>g.VantaraDesktop.mangaEngine({method,args}):null;
  const MANGA_METHODS=new Set([...WEB_METHODS,...(native?REPO_METHODS:[])]);
  const engineSource=id=>/^[A-Za-z][\w]*(?:\.[\w]+)+#-?\d{1,20}$/.test(String(id??''));
  const engineMedia=url=>/^vantara-engine:\/\/suwayomi\//.test(String(url??''));
  let legacy=new Map(),legacyAt=0;
  const legacyMap=async()=>{
    if(Date.now()-legacyAt<30_000)return legacy;
    try{const [web,mine]=await Promise.all([webCall('sources',{}).catch(()=>({sources:[]})),native('sources',{})]);legacy=bridgeLegacySources(web?.sources??[],mine?.sources??[]).map;legacyAt=Date.now();}catch{/* يبقى الأخير */}
    return legacy;
  };
  const webCall=async(method,args)=>{
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
  };
  const ExtensionEngine=new Proxy({}, {has(_,method){return MANGA_METHODS.has(method);},get(_,method){if(method==='then'||!MANGA_METHODS.has(method))return undefined;return async (args={})=>{
    if(native&&REPO_METHODS.includes(method))return native(method,args);
    if(native&&method==='sources'){
      // مصادر الويب ومصادر المحرك معًا؛ تعذّر أحدهما لا يُخفي الآخر. حزمة مدمجة سابقًا ثُبّتت إضافةً تأخذ معرّفها القديم
      // ويختفي محرك الويب لها («صفر مصادر مدمجة»، bridgeLegacySources)
      const [web,mine]=await Promise.allSettled([webCall('sources',args),native('sources',args)]);
      if(web.status==='rejected'&&mine.status==='rejected')throw web.reason;
      const bridged=bridgeLegacySources(web.value?.sources??[],mine.value?.sources??[]);
      legacy=bridged.map;legacyAt=Date.now();
      return {sources:bridged.list,stateRecovered:mine.value?.stateRecovered===true};
    }
    // معرّف قديم لحزمة صارت إضافة: إلى المحرك بمعرّفها الحقيقي
    if(native&&args?.sourceId!=null&&!engineSource(args.sourceId)){
      const real=(await legacyMap()).get(String(args.sourceId));
      if(real)return native(method,{...args,sourceId:real});
    }
    if(native&&method==='image'&&engineMedia(args.page?.imageUrl))return native('image',args);
    if(native&&method==='cover'&&engineMedia(args.url))return {path:args.url};
    if(native&&engineSource(args.sourceId))return native(method,args);
    return webCall(method,args);
  };}});
  g.VantaraDesktopBridges = Object.freeze({ AnimeEngine:engine,ExtensionEngine,Verification:createDesktopVerification(g.VantaraDesktop),SourceRuntime:{getRuntime},AddonFabric:{runtime:async()=>({getRuntime})} });
  if(g.document&&g.location?.protocol==='vantara:'){
    const defaults=startDesktopDefaultAddons({runtime:getRuntime(),onStatus:()=>g.document.dispatchEvent(new CustomEvent('vantara:addons-changed'))});
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
  let engineSlow = 0;
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
    // محرك إضافات المانجا يُجهَّز مرة (تنزيل موثّق ~330MB ثم فك ثم تشغيل): يُقال ما يحدث بدل انتظار صامت
    if (event.type === 'manga-engine/progress') {
      const mb = n => Math.round((Number(n) || 0) / 1048576);
      if (event.stage === 'download') show(event.total ? `يجهّز محرك إضافات المانجا لأول مرة… ${mb(event.received)} من ${mb(event.total)}MB` : 'يجهّز محرك إضافات المانجا لأول مرة…');
      else if (event.stage === 'extract') show('يفك محرك إضافات المانجا…');
      // التشغيل المعتاد عند كل فتح للتطبيق يتم بهدوء (بلاغ المالك 27 نوفمبر): الرسالة فقط إن طال فعلًا (>4ث)
      else if (event.stage === 'installed' || event.stage === 'starting') { clearTimeout(engineSlow); engineSlow = setTimeout(() => show('يشغّل محرك إضافات المانجا…'), 4000); }
      else if (event.stage === 'running') { clearTimeout(engineSlow); if (status) status.hidden = true; }
    }
    if (event.type === 'manga-extensions/changed') g.document?.dispatchEvent?.(new CustomEvent('vantara:addons-changed'));
    // إضافة Mihon طلب موقعها تحققًا بيد إنسان (جسر Cloudflare في المحرك): «تحتاج تحقق» وزر «تحقق» كالمصادر المدمجة
    if (event.type === 'source-verification/required' && typeof event.host === 'string') desktopChallenges.report(event.host);
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
