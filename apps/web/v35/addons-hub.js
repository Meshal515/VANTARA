/**
 * مدير الإضافات في فانتارا: التصميم المعتمد v1.2.6 (docs/design/addons-v1.2.6/concept.js) منقولًا كما هو،
 * مربوطًا بالمحركات الحقيقية. كل زر هنا يقابله نداء فعلي؛ ما لا محرك له لا يظهر:
 * - Stremio وإضافات الويب: `registry` (تفعيل، مفضّلة، تحديث، ضبط، حذف).
 * - Mihon (المانجا) وCloudStream وAniyomi: واجهات المستودعات الأصلية (list/add/remove/extensions/install/uninstall،
 *   وenable حيث يدعمه المحرك فقط: CloudStream).
 * - تحديات الحماية: طابور التحقق نفسه (`verification`)، والبدء بضغطة المستخدم فقط.
 * الترتيب بالسحب في التصور لا محرك له (المحركات لا تحفظ ترتيبًا) فلم يُنقل؛ المفضّلة حقيقية وتُحفظ.
 */
import { configureLink } from './addons-view.js';
import { afterMotion } from './page-motion.js';
import { pulseView } from '../addons/source-pulse.js';
import { adultSource } from '../lib/adult-filter.js';
import { verificationMessage } from '../lib/source-verification.js';
import { GROUPS as TRANSFER_GROUPS, collectExtensions, extensionsFromFile, fileName as transferFileName, installItem, planImport, serialize } from '../lib/extensions-transfer.js';

// نظام الحركة المعتمد (حد أعلى 270ms): منحنى خروج واحد للدخول، ومنحنى دخول للمغادرة
const M = { enter: 260, leave: 110, sheetIn: 260, sheetOut: 160, press: 160, tab: 160, ind: 240, flip: 260, toast: 200 };
const EASE = 'cubic-bezier(.22,1,.36,1)';
const EIN = 'cubic-bezier(.4,0,1,1)';
const SPRING = 'cubic-bezier(.34,1.45,.64,1)';

// ── الأيقونات: شبكة 24، خط 2، أطراف دائرية ──
export const P = {
  pin: '<path d="M8.75 3.5h6.5l-.7 5.5 3.7 3.65v2.1H5.75v-2.1L9.45 9z"/><path d="M12 14.75v6"/>',
  pinOn: '<path d="M8.75 3.5h6.5l-.7 5.5 3.7 3.65v2.1H5.75v-2.1L9.45 9z" fill="currentColor"/><path d="M12 14.75v6"/>',
  open: '<path d="M14.5 6 8.5 12l6 6"/>',
  search: '<circle cx="10.75" cy="10.75" r="6.25"/><path d="m15.5 15.5 4.75 4.75"/>',
  plus: '<path d="M12 5.25v13.5M5.25 12h13.5"/>',
  sliders: '<path d="M4 7.5h8.5M17.5 7.5H20M4 16.5h2.5M11.5 16.5H20"/><circle cx="15" cy="7.5" r="2.5"/><circle cx="9" cy="16.5" r="2.5"/>',
  update: '<path d="M12 4v10.5M7.75 10.25 12 14.5l4.25-4.25M5 19.5h14"/>',
  // زر «تثبيت»: سهم إلى صينية، متمركز بصريًا لا رياضيًا. مركز ثقل الحبر (الساق 9.5 + الرأس 12 + الصينية 13 وحدة)
  // عند y≈13.7 بينما مركز الصندوق 11.5؛ الحل الوسط بينهما يُرفع 0.6 وحدة فيبدو في المنتصف تمامًا داخل الدائرة.
  install: '<path d="M12 3.9v9.5M7.75 9.4 12 13.65l4.25-4.25M5.5 17.9h13"/>',
  spin: '<path d="M12 4.25a7.75 7.75 0 1 1-7.75 7.75" />',
  retry: '<path d="M4.75 12a7.25 7.25 0 1 0 2.2-5.2L4.75 9"/><path d="M4.75 4.75V9H9"/>',
  trash: '<path d="M4.75 7h14.5M9.75 7V4.75h4.5V7M6.75 7l.75 12.25h9L17.25 7"/>',
  more: '<circle cx="12" cy="5.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="18.5" r="1.5" fill="currentColor" stroke="none"/>',
  link: '<path d="M10 14a4.2 4.2 0 0 0 6 0l2.5-2.5a4.2 4.2 0 0 0-6-6l-1 1"/><path d="M14 10a4.2 4.2 0 0 0-6 0l-2.5 2.5a4.2 4.2 0 0 0 6 6l1-1"/>',
  check: '<path d="m5.5 12.5 4.25 4.25 8.75-9.5"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  globe: '<circle cx="12" cy="12" r="8.25"/><path d="M3.75 12h16.5M12 3.75c2.4 2.3 3.6 5 3.6 8.25S14.4 18 12 20.25C9.6 18 8.4 15.25 8.4 12S9.6 6.05 12 3.75z"/>',
  site: '<path d="M13.5 4.75h5.75v5.75M19.25 4.75 11 13"/><path d="M17.25 13.5v3.75a2 2 0 0 1-2 2H6.75a2 2 0 0 1-2-2V8.75a2 2 0 0 1 2-2h3.75"/>',
  down: '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
  up: '<path d="M12 19V5M6.5 10.5 12 5l5.5 5.5"/>',
  downMove: '<path d="M12 5v14m-5.5-5.5L12 19l5.5-5.5"/>',
  grip: '<path d="M7 9h10M7 15h10"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="3"/><path d="M15.5 8.5V7a2.5 2.5 0 0 0-2.5-2.5H7A2.5 2.5 0 0 0 4.5 7v6A2.5 2.5 0 0 0 7 15.5h1.5"/>',
  repo: '<rect x="4" y="4.5" width="16" height="15" rx="3.5"/><path d="M4 9.5h16M8.5 14h7"/>',
  shield: '<path d="M12 3.75 5.25 6.4v5.1c0 4.2 2.85 7.35 6.75 8.75 3.9-1.4 6.75-4.55 6.75-8.75V6.4z"/><path d="m9.25 12.1 1.9 1.9 3.6-3.85"/>',
  share: '<path d="M12 15V4.5M8 8.25 12 4.5l4 3.75"/><path d="M6.5 11.5h-.75a1.5 1.5 0 0 0-1.5 1.5v5.25a1.5 1.5 0 0 0 1.5 1.5h12.5a1.5 1.5 0 0 0 1.5-1.5V13a1.5 1.5 0 0 0-1.5-1.5h-.75"/>',
  file: '<path d="M13.5 3.75H7.25a2 2 0 0 0-2 2v12.5a2 2 0 0 0 2 2h9.5a2 2 0 0 0 2-2V9z"/><path d="M13.5 3.75V9h5.25M12 12.5v5M9.5 15l2.5 2.5 2.5-2.5"/>',
};
// علامات المزوّدات: رسم فانتارا الخاص، شبكة 32، عنصر مصمت واحد لكل علامة (لا شعارات تطبيقات)
const MARK = {
  stremio: '<rect x="4" y="5" width="24" height="22" rx="5" stroke="currentColor" stroke-width="2.5"/><path d="m13 11 8 5-8 5z" fill="currentColor" stroke="none"/>',
  mihon: '<path fill="currentColor" stroke="none" d="M3 6c5-1 9 0 12 3v18c-3-3-7-4-12-3zm26 0c-5-1-9 0-12 3v18c3-3 7-4 12-3z"/><path d="M7 11h4M7 15h4M21 11h4M21 15h4" stroke="var(--surface-2)" stroke-width="1.6"/>',
  cloudstream: '<path fill="currentColor" stroke="none" fill-rule="evenodd" d="M9 26a7 7 0 0 1-1-14 9 9 0 0 1 17 2 6 6 0 0 1-1 12zm5-12v9l7-4.5z"/>',
  aniyomi: '<path fill="currentColor" stroke="none" fill-rule="evenodd" d="M7 8 4 3l2-1 6 7h8l6-7 2 1-3 5a6 6 0 0 1 5 6v9a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6v-9a6 6 0 0 1 5-6zm4 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-10 7 5 4 5-4z"/>',
};
const PROV = {
  stremio: { name: 'Stremio' },
  mihon: { name: 'Mihon' },
  cloudstream: { name: 'CloudStream' },
  aniyomi: { name: 'Aniyomi' },
};
const NATIVE = ['mihon', 'cloudstream', 'aniyomi'];
const AVAILABLE_OVERSCAN = 5;
const AVAILABLE_INITIAL_ROWS = 18;
const TYPE = { links: 'روابط', subs: 'ترجمات', cat: 'كتالوج' };
const CONTENT_AR = { movie: 'أفلام', series: 'مسلسلات', anime: 'أنمي', tv: 'قنوات', channel: 'قنوات', manga: 'مانجا' };
const LANGS = { ar: 'العربية', en: 'الإنجليزية', ja: 'اليابانية', es: 'الإسبانية', 'es-419': 'الإسبانية', id: 'الإندونيسية', fr: 'الفرنسية', pt: 'البرتغالية', 'pt-br': 'البرتغالية', tr: 'التركية', ru: 'الروسية', ko: 'الكورية', zh: 'الصينية', de: 'الألمانية', it: 'الإيطالية', vi: 'الفيتنامية', th: 'التايلاندية', all: 'متعدد اللغات', multi: 'متعدد اللغات', mul: 'متعدد اللغات' };
export const langName = (c) => { const k = String(c || '').trim().toLowerCase(); return LANGS[k] || LANGS[k.split('-')[0]] || (k ? String(c) : 'متعدد اللغات'); };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtErr = (e) => String(e?.message || e || 'تعذّر إكمال العملية').replace(/(?:https?:\/\/|stremio:\/\/)\S+/gi, '[رابط]').slice(0, 220);
const httpUrl = (u) => { try { const x = new URL(String(u)); return /^https?:$/.test(x.protocol) && !x.username && !x.password ? x.href : ''; } catch { return ''; } };
const siteOf = (v) => { if (!v) return ''; const s = String(v).trim(); return httpUrl(s) || (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s) ? `https://${s}` : ''); };
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };
export function nativePackage(item) {
  if (item?.pkg || item?.packageName || item?.internalName) return String(item.pkg || item.packageName || item.internalName);
  const id = String(item?.sourceId || item?.sourceIds?.[0] || '');
  if (id.startsWith('addon|cs3|')) return id.split('|')[2] || '';
  return id.includes('|') ? '' : id.split('#')[0].split('@')[0];
}
// نوع إضافة CloudStream من tvTypes: الأغلبية تحكم والتساوي للأنمي (نفس قاعدة addons-v7.js و#323 U-35)
export function cloudstreamContent(item) {
  const types = (Array.isArray(item?.tvTypes) ? item.tvTypes : []).map((t) => String(t).toLowerCase());
  if (!types.length) return undefined;
  const anime = types.filter((t) => t === 'anime' || t === 'animemovie' || t === 'ova').length;
  return anime && anime >= types.length - anime ? 'anime' : 'cinema';
}
/** نوع إضافة الويب كما يعرضه التصور: روابط، ترجمات، كتالوج. */
export function remoteType(a) {
  const caps = a?.capabilities || [];
  return caps.includes('streams') ? 'links' : caps.includes('subtitles') ? 'subs' : 'cat';
}

export function renderAddonsHub({
  registry = {}, repositories = null, animeRepositories = null, cloudstreamRepositories = null, sites = null, verification = null, pulse = null,
  profile = 'local', onOpenSource = () => {}, onOpenNativeSource = null, onSourcesChanged = () => {}, initialState = {},
} = {}) {
  const doc = globalThis.document, win = globalThis.window || globalThis;
  const RM = !!win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  let D = (win.innerWidth || 0) >= 1000;
  const g = (k, s = D ? 26 : 24) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:${s}px;height:${s}px;stroke-width:2;flex:none">${P[k] || ''}</svg>`;
  const ib = (act, icon, { cls = '', id = '', label = '', s, dis = false } = {}) => `<button class="y-ib ${cls}" data-y="${act}" ${id ? `data-id="${esc(id)}"` : ''} aria-label="${esc(label)}" ${dis ? 'disabled' : ''}>${g(icon, s)}</button>`;

  // ── المحركات المتاحة على هذا الجهاز فقط ──
  const API = {
    stremio: typeof registry?.list === 'function' ? registry : null,
    mihon: repositories, cloudstream: cloudstreamRepositories, aniyomi: animeRepositories,
  };
  const PROVS = Object.keys(PROV).filter((p) => API[p]);
  const KIND = { mihon: 'manga', cloudstream: 'anime', aniyomi: 'anime' };
  const STORE = { mihon: { id: 'manga', kind: 'manga', api: repositories }, cloudstream: { id: 'cloudstream', kind: 'anime', family: 'cloudstream', api: cloudstreamRepositories }, aniyomi: { id: 'anime', kind: 'anime', api: animeRepositories } };
  const stores = [STORE.cloudstream, STORE.aniyomi, STORE.mihon].filter((s) => s.api);
  const toggling = new Map();
  const canToggle = (p) => (p === 'stremio' ? typeof registry.enable === 'function' : typeof API[p]?.enable === 'function');

  // ── تفضيلات العرض المحفوظة على الجهاز (المفضّلة، ألقاب وصور المستودعات، اللغات) ──
  const PREF_KEY = `vantara.addons.hub.v1:${profile}`;
  const pref = (() => { try { return JSON.parse(globalThis.localStorage?.getItem(PREF_KEY) || 'null') || {}; } catch { return {}; } })();
  pref.provPins ??= []; pref.pins ??= {}; pref.order ??= {}; pref.repoMeta ??= {}; pref.langs ??= {};
  const savePref = () => { try { globalThis.localStorage?.setItem(PREF_KEY, JSON.stringify(pref)); return true; } catch { return false; } };

  const S = {
    stack: [{ v: 'hub' }], provPins: pref.provPins.filter((p) => PROVS.includes(p)), tab: {}, filter: 'all', q: '', searching: false, url: '',
    langs: {}, repoFilter: {}, items: {}, avail: {}, repos: {}, busy: {}, loading: {}, errors: {}, challenges: [], justToggled: null,
  };
  for (const p of PROVS) { S.items[p] = []; S.avail[p] = []; S.repos[p] = []; S.tab[p] = 'inst'; S.repoFilter[p] = 'all'; S.langs[p] = new Set(pref.langs[p] || []); }
  // استعادة الموضع بعد فتح مصدر والرجوع
  for (const c of Array.isArray(initialState.stack) ? initialState.stack.slice(1, 3) : []) {
    if (PROVS.includes(c?.v) || (c?.v === 'details' && PROVS.includes(c.p) && typeof c.id === 'string')) S.stack.push({ v: c.v, p: c.p, id: c.id });
  }
  for (const [p, t] of Object.entries(initialState.tab || {})) if (PROVS.includes(p) && ['inst', 'avail', 'repos'].includes(t)) S.tab[p] = t;

  // ── الشعارات: صورة حقيقية بمرشحاتها بالترتيب، ثم الحرف الأول ──
  const letter = (n) => esc([...String(n || '').replace(/^[^\p{L}\p{N}]+/u, '')][0]?.toUpperCase() || '?');
  const imageUrl = (u) => (typeof u === 'string' && u.length <= 90 * 1024 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(u || '') ? u : httpUrl(u));
  const logo = (k, n, cls = '', imgs = []) => MARK[k]
    ? `<span class="y-lg y-mk ${cls}" data-brand="${k}"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:58%;height:58%;stroke-width:2.1">${MARK[k]}</svg></span>`
    : `<span class="y-lg ${cls}" data-logo="${esc(JSON.stringify(imgs))}"><b aria-hidden="true">${letter(n)}</b>${imgs.length ? `<img src="${esc(imgs[0])}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}</span>`;
  const itLogo = (it, cls = '') => logo(null, it.name, cls, it.imgs || []);
  const repoImage = imageUrl;
  const repoLogo = (r, cls = '') => logo(null, r.name, `y-repo-logo ${cls}`, repoImage(r.image) ? [repoImage(r.image)] : []);
  const repoOf = (p, it) => S.repos[p]?.find((r) => r.id === it.repoId);
  const repoName = (p, it) => repoOf(p, it)?.name || it.repoName || 'غير محدد';
  const repoMatches = (p, it) => S.repoFilter[p] === 'all' || it.repoId === S.repoFilter[p];
  const langOk = (p, it) => !S.langs[p]?.size || S.langs[p].has(it.lang);
  const availFor = (p) => {
    const q = S.q.trim().toLowerCase();
    return S.avail[p].filter((it) => repoMatches(p, it) && (q ? it.searchName.includes(q) : langOk(p, it)));
  };
  const cur = () => S.stack[S.stack.length - 1];
  const pinFirst = (arr) => [...arr.filter((x) => x.pin), ...arr.filter((x) => !x.pin)];
  const orderGroups = (p, arr, draw, cls) => [true, false].map((pin) => { const list = arr.filter((x) => !!x.pin === pin); return list.length ? `<section class="y-order-section" data-k="order-${p}-${+pin}"><div class="y-order-head"><span>${pin ? 'المفضّلة' : 'البقية'}</span><span>${list.length}</span></div><div class="${cls} y-order-list" data-list="installed" data-order="${p}" data-pin="${+pin}">${list.map(draw).join('')}</div></section>` : ''; }).join('');
  const match = (n) => !S.q || String(n).toLowerCase().includes(S.q.toLowerCase());
  const upCount = (p) => S.items[p].filter((x) => x.nv).length;
  const namesEqual = (a, b) => a && b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  const challengeMatches = (c, it) => c.sourceId && it.sourceIds?.length ? it.sourceIds.includes(c.sourceId)
    : (it.site && hostOf(it.site) === c.host) || namesEqual(c.sourceName, it.name);
  const challengeOf = (it) => S.challenges.find((c) => challengeMatches(c, it));
  const healthOf = (it) => (it.sourceKeys ?? [it.id]).map((key) => pulse?.get?.(key)).filter(Boolean)
    .sort((a, b) => b.at - a.at)[0];

  // ── المكوّنات ──
  const pinBtn = (p, it) => ib('pin', it.pin ? 'pinOn' : 'pin', { cls: it.pin ? 'on' : 'dim', id: `${p}|${it.id}`, label: it.pin ? 'أزل من المفضّلة' : 'للمفضّلة' });
  const header = (k, line) => `<div class="y-head">${logo(k, PROV[k].name, 'xl')}<div class="y-tx"><div class="y-nm">${PROV[k].name}</div><div class="y-mt">${line}</div></div></div>`;
  const tabs = (p, arr) => `<div class="y-tabs" role="tablist">${arr.map(([k, t, n]) => `<button class="y-tab ${S.tab[p] === k ? 'on' : ''}" data-y="tab" data-id="${p}|${k}" role="tab" aria-selected="${S.tab[p] === k}">${t}${n != null ? ` <i>${n}</i>` : ''}</button>`).join('')}<span class="y-ind"></span></div>`;
  // لا نسبة وهمية: المحركات لا تعلن تقدّم التثبيت، فالشريط غير محدد المدة
  const prog = (id) => (S.busy[id] ? '<span class="y-prog ind"><i></i></span>' : '');
  const busyWord = (b) => (b.kind === 'install' ? 'يثبّت…' : b.kind === 'retry' ? 'يتصل…' : b.kind === 'remove' ? 'يحذف…' : b.kind === 'toggle' ? 'يحفظ…' : 'يحدّث…');
  const langPill = (p) => {
    const sel = [...S.langs[p]]; const n = S.avail[p].filter((x) => repoMatches(p, x) && langOk(p, x)).length;
    return `<button class="y-lang" data-y="langs" data-id="${p}">${g('globe', 21)}<span>${sel.length === 0 ? 'كل اللغات' : sel.length === 1 ? esc(sel[0]) : `${sel.length} لغات`}</span> <i>${n}</i>${g('down', 20)}</button>`;
  };
  const provLine = (k) => {
    if (S.loading[k] && !S.items[k].length) return 'يقرأ…';
    if (S.errors[k] && !S.items[k].length) return '<span class="y-bad">تعذّرت القراءة</span>';
    const n = S.items[k].length; const up = upCount(k);
    if (!n) return 'لا شيء مثبت';
    const base = k === 'stremio' ? `${n} إضافات` : `${n} مثبتة`;
    return up ? `<span>${base}</span><span class="y-up">${up} ${up === 1 ? 'تحديث' : 'تحديثات'}</span>` : base;
  };
  const provCard = (k) => {
    if (D) return deskProv(k);
    const pin = S.provPins.includes(k);
    return `<div class="y-prov" data-y="prov" data-id="${k}" data-k="p-${k}"><button class="y-prov-main" data-y="prov" data-id="${k}" aria-label="فتح ${PROV[k].name}">${logo(k, PROV[k].name)}<span class="y-tx"><span class="y-nm" dir="ltr">${PROV[k].name}</span><span class="y-mt">${provLine(k)}</span></span></button>${ib('ppin', pin ? 'pinOn' : 'pin', { cls: pin ? 'on' : 'dim', id: k, label: pin ? 'إلغاء التثبيت' : 'ثبّت' })}<span class="y-ib" aria-hidden="true">${g('open')}</span></div>`;
  };
  // تحديات الحماية: مربع في قائمة المزوّدات يظهر حين يطلب موقع تحققًا، ويُفتح بضغطة
  const guardCard = () => {
    const n = S.challenges.length; if (!n) return '';
    const line = `${n} ${n === 1 ? 'موقع ينتظر' : n === 2 ? 'موقعان ينتظران' : 'مواقع تنتظر'} تحققك`;
    return D
      ? `<div class="y-prov y-dprov y-guard" data-y="guard" data-k="guard"><span class="y-lg dxl y-mk">${g('shield', 34)}</span><div class="y-tx"><div class="y-dn"><span>تحديات الحماية</span></div><div class="y-mt">${line}</div></div><div class="y-dacts"><button class="y-dup" data-y="guard">${g('shield', 18)}تحقق الآن</button></div></div>`
      : `<div class="y-prov y-guard" data-y="guard" data-k="guard"><button class="y-prov-main" data-y="guard" aria-label="تحديات الحماية">${`<span class="y-lg y-mk">${g('shield', 28)}</span>`}<span class="y-tx"><span class="y-nm">تحديات الحماية</span><span class="y-mt"><span class="y-bad">${line}</span></span></span></button><span class="y-ib" aria-hidden="true">${g('open')}</span></div>`;
  };
  const extLine = (p, it) => {
    const b = S.busy[it.id];
    if (b) return `<span class="y-up">${busyWord(b)}</span>`;
    const challenge = challengeOf(it);
    if (challenge) return challenge.verifying ? '<span class="y-up">جارٍ التحقق</span>' : '<span class="y-bad">تحتاج تحققًا</span>';
    if (it.pending) return '<span class="y-up">بانتظار الاستعادة</span>';
    if (it.bad) return '<span class="y-bad">تعذّر الاتصال</span>';
    if (it.nv) return '<span class="y-dot"></span><span class="y-up">تحديث</span>';
    return p === 'cloudstream' ? `${esc(it.lang || 'عربي')}${it.ver ? ` · v${esc(it.ver)}` : ''}` : esc(it.lang || 'عربي');
  };
  const switchBtn = (p, it) => (canToggle(p) ? `<button class="y-sw ${it.on ? '' : 'off'}" data-y="toggle" data-id="${esc(p + '|' + it.id)}" role="switch" aria-checked="${!!it.on}" aria-label="تفعيل ${esc(it.name)}" ${S.busy[it.id] || toggling.has(p + '|' + it.id) ? 'disabled' : ''}></button>` : '');
  const instRow = (p, it) => {
    if (D) return deskExtRow(p, it);
    const k = p + '|' + it.id, b = S.busy[it.id];
    const tail = it.isSite ? pinBtn(p, it) + ib('open', 'open', { id: k, label: 'تفاصيل ' + it.name }) : !it.on ? switchBtn(p, it) : b ? '' : it.pending ? ib('restore', 'update', { id: k, label: 'استعد' }) : it.bad ? ib('retry', 'retry', { id: k, label: 'أعد المحاولة' }) : pinBtn(p, it) + ib('enterSource', 'open', { id: k, label: 'افتح ' + it.name });
    return `<div class="y-row y-ext-row ${it.on ? '' : 'is-off'}" data-k="${p}-${esc(it.id)}" data-id="${esc(it.id)}"><button class="y-ext-info" data-y="open" data-id="${esc(k)}" aria-label="تفاصيل ${esc(it.name)}">${itLogo(it)}<span class="y-tx"><span class="y-nm">${esc(it.name)}</span><span class="y-mt">${extLine(p, it)}${S.repos[p]?.length > 1 && it.repoId ? ` · <span class="y-repo-name" dir="auto">${esc(repoName(p, it))}</span>` : ''}</span></span></button>${tail}${prog(it.id)}</div>`;
  };
  const getBtn = (p, it) => {
    const b = S.busy[it.id], k = `${p}|${it.id}`;
    return b ? `<span class="y-get busy" role="status" aria-label="يثبّت ${esc(it.name)}">${g('spin', 22)}</span>` : `<button class="y-get" data-y="install" data-id="${esc(k)}" aria-label="تثبيت ${esc(it.name)}" ${D ? 'data-tip="تثبيت"' : ''}>${g('install', 22)}</button>`;
  };
  const availRow = (p, it) => `<div class="y-row y-avail-row" data-k="${p}-a-${esc(it.id)}" data-id="${esc(it.id)}">${itLogo(it)}<div class="y-tx"><div class="y-nm">${esc(it.name)}</div><div class="y-mt">${S.busy[it.id] ? `<span class="y-up">${busyWord(S.busy[it.id])}</span>` : `${esc(it.lang)}${it.ver ? ` · v${esc(it.ver)}` : ''} · <span dir="auto">${esc(repoName(p, it))}</span>`}</div></div>${getBtn(p, it)}${prog(it.id)}</div>`;

  // ── مكوّنات الكمبيوتر (عمود واحد، إجراءات ظاهرة) ──
  const dib = (act, icon, id, tip, cls = '', dis = false) => `<button class="y-ib ${cls}" data-y="${act}" data-id="${esc(id)}" aria-label="${esc(tip)}" data-tip="${esc(tip)}" ${dis ? 'disabled' : ''}>${g(icon, 26)}</button>`;
  const grpPos = (p, it) => { const grp = S.items[p].filter((x) => !!x.pin === !!it.pin); const i = grp.indexOf(it); return [i === 0, i === grp.length - 1]; };
  const canOrder = (p) => p !== 'stremio' || typeof registry.order === 'function';
  const moveBtns = (p, it) => { if (!canOrder(p)) return ''; const [f, l] = grpPos(p, it), k = p + '|' + it.id; return dib('moveUp', 'up', k, 'للأعلى', '', f) + dib('moveDown', 'downMove', k, 'للأسفل', '', l); };
  const pinBtnD = (p, it) => dib('pin', it.pin ? 'pinOn' : 'pin', p + '|' + it.id, it.pin ? 'أزل من المفضّلة' : 'للمفضّلة', it.pin ? 'on' : 'dim');
  const deskExtRow = (p, it) => {
    const k = p + '|' + it.id, b = S.busy[it.id];
    return `<div class="y-row y-ext-row y-drow ${it.on ? '' : 'is-off'}" data-k="${p}-${esc(it.id)}" data-id="${esc(it.id)}"><button class="y-ext-info" data-y="open" data-id="${esc(k)}" aria-label="تفاصيل ${esc(it.name)}">${itLogo(it, 'dl')}<span class="y-tx"><span class="y-dn"><span>${esc(it.name)}</span>${it.ver ? `<span class="y-chipv">v${esc(it.ver)}</span>` : ''}</span><span class="y-mt">${b || it.bad || it.nv || it.pending || challengeOf(it) ? extLine(p, it) : esc(it.lang || 'عربي')}${it.repoId ? ` · <span dir="auto">${esc(repoName(p, it))}</span>` : ''}</span></span></button><div class="y-dacts">${moveBtns(p, it)}<span class="y-dsep"></span>${pinBtnD(p, it)}${it.nv && !b ? `<button class="y-dup" data-y="update" data-id="${esc(k)}">${g('update', 18)}تحديث v${esc(it.nv)}</button>` : ''}${it.pending && !b ? `<button class="y-dup" data-y="restore" data-id="${esc(k)}">${g('update', 18)}استعد</button>` : ''}${it.bad && !b ? dib('retry', 'retry', k, 'أعد المحاولة') : ''}${dib('site', 'site', k, 'افتح الموقع', '', !it.site)}${dib('copy', 'link', k, 'انسخ الرابط', '', !copyUrl(p, it))}${dib('askDel', 'trash', k, 'احذف', 'danger', !!b)}${canToggle(p) ? `<span class="y-dsep"></span>${switchBtn(p, it)}` : '<span class="y-dsep"></span>'}${it.isSite ? dib('open', 'open', k, 'التفاصيل') : dib('enterSource', 'open', k, 'افتح المصدر', '', !it.on || !!it.bad || !!it.pending || !!b)}</div>${prog(it.id)}</div>`;
  };
  const deskStCard = (it) => {
    const k = 'stremio|' + it.id, b = S.busy[it.id];
    return `<div class="y-row y-drow y-card-d ${it.on ? '' : 'is-off'}" data-k="st-${esc(it.id)}" data-id="${esc(it.id)}"><button class="y-ext-info" data-y="open" data-id="${esc(k)}" aria-label="تفاصيل ${esc(it.name)}">${itLogo(it, 'dl')}<span class="y-tx"><span class="y-dn"><span>${esc(it.name)}</span>${it.ver ? `<span class="y-chipv">v${esc(it.ver)}</span>` : ''}</span><span class="y-mt">${b ? `<span class="y-up">${busyWord(b)}</span>` : it.bad ? '<span class="y-bad">تعذّر الاتصال</span>' : `${TYPE[it.type] || ''}${it.cont ? ' · ' + esc(it.cont) : ''}`}</span></span></button><div class="y-dacts">${moveBtns('stremio', it)}<span class="y-dsep"></span>${pinBtnD('stremio', it)}${it.nv && !b ? `<button class="y-dup" data-y="update" data-id="${esc(k)}">${g('update', 18)}تحديث ${esc(it.nv)}</button>` : ''}${it.conf ? dib('conf', 'sliders', k, 'اضبط') : ''}${dib('site', 'site', k, 'افتح الموقع', '', !it.site)}${dib('copy', 'link', k, 'انسخ الرابط', '', !it.url)}${dib('askDel', 'trash', k, 'احذف', 'danger', !!b)}<span class="y-dsep"></span>${switchBtn('stremio', it).replace('role="switch"', `role="switch" data-tip="${it.on ? 'عطّلها' : 'فعّلها'}"`)}${it.open ? dib('enterSource', 'open', k, 'افتح الكتالوج', '', !it.on) : ''}</div>${prog(it.id)}</div>`;
  };
  const deskProv = (k) => {
    const pin = S.provPins.includes(k), a = S.items[k], up = upCount(k);
    return `<div class="y-prov y-dprov" data-y="prov" data-id="${k}" data-k="p-${k}">${logo(k, PROV[k].name, 'dxl')}<div class="y-tx"><div class="y-dn"><span dir="ltr">${PROV[k].name}</span></div><div class="y-mt">${provLine(k)}</div>${a.length ? `<div class="y-faces">${a.slice(0, 8).map((it) => itLogo(it)).join('')}${a.length > 8 ? `<i>+${a.length - 8}</i>` : ''}</div>` : ''}</div><div class="y-dacts">${up ? `<button class="y-dup" data-y="provUpd" data-id="${k}">${g('update', 18)}حدّث ${up}</button>` : ''}${k !== 'stremio' ? dib('addRepo', 'plus', k, 'أضف مستودعًا') : ''}${dib('ppin', pin ? 'pinOn' : 'pin', k, pin ? 'إلغاء التثبيت' : 'ثبّت في الأعلى', pin ? 'on' : 'dim')}${dib('prov', 'open', k, 'افتح')}</div></div>`;
  };
  const deskRepoRow = (p, r, i) => `<div class="y-row" data-k="${p}-r-${esc(r.id)}">${repoLogo(r)}<div class="y-tx"><div class="y-nm">${esc(r.name)}</div><div class="y-mt" dir="ltr" style="justify-content:flex-end">${esc(r.url.replace(/^https?:\/\//, ''))}</div></div><div class="y-dacts"><span class="y-chipv">${r.err ? '<span class="y-bad">تعذّر</span>' : r.n != null ? r.n + ' إضافة' : '…'}</span><span class="y-dsep"></span>${dib('editRepo', 'sliders', p + '|' + i, 'عدّل اللقب والصورة')}${dib('copyRaw', 'link', r.url, 'انسخ الرابط')}${dib('repoDel', 'trash', p + '|' + i, 'أزل المستودع', 'danger')}</div></div>`;
  const repoRow = (p, r, i) => (D ? deskRepoRow(p, r, i) : `<div class="y-row" data-k="${p}-r-${esc(r.id)}">${repoLogo(r)}<div class="y-tx"><div class="y-nm">${esc(r.name)}</div><div class="y-mt">${r.err ? '<span class="y-bad">تعذّرت قراءة الفهرس</span>' : r.n != null ? `${r.n.toLocaleString('en')} إضافة` : 'يقرأ…'}</div></div>${ib('repoMenu', 'more', { id: `${p}|${i}`, label: 'خيارات' })}</div>`);
  const stCard = (it) => {
    if (D) return deskStCard(it);
    const k = 'stremio|' + it.id, b = S.busy[it.id];
    return `<div class="y-card ${it.on ? '' : 'is-off'}" data-k="st-${esc(it.id)}" data-id="${esc(it.id)}">
  <div class="y-r1">${canOrder('stremio') ? `<button class="y-grip" data-y="grip" data-id="${esc(it.id)}" aria-label="اسحب للترتيب">${g('grip')}</button>` : ''}<div style="display:contents" data-y="open" data-id="${esc(k)}">${itLogo(it)}<div class="y-tx"><div class="y-nm">${esc(it.name)}</div><div class="y-mt">${b ? `<span class="y-up">${busyWord(b)}</span>` : it.bad ? '<span class="y-bad">تعذّر الاتصال</span>' : it.nv ? `<span class="y-dot"></span><span class="y-up">تحديث ${esc(it.nv)}</span>` : `${TYPE[it.type]}${it.ver ? ' · ' + esc(it.ver) : ''}`}</div></div></div>${switchBtn('stremio', it)}</div>
  <div class="y-r2" ${it.on ? '' : 'inert aria-hidden="true"'}>${pinBtn('stremio', it)}${it.conf ? ib('conf', 'sliders', { id: k, label: 'ضبط' }) : ''}${it.nv && !b ? ib('update', 'update', { id: k, label: 'تحديث' }) : ''}<span class="y-sp"></span>${ib('itemMenu', 'more', { id: k, label: 'خيارات' })}${ib('open', 'open', { id: k, label: 'التفاصيل' })}</div>${prog(it.id)}</div>`;
  };

  // ── الشاشات ──
  const empty = (t, s) => `<div class="y-empty"><div class="y-nm">${t}</div><div class="y-mt">${s}</div></div>`;
  const views = {
    hub() {
      if (S.q) {
        const hits = PROVS.flatMap((p) => S.items[p].filter((x) => match(x.name)).map((x) => [p, x]));
        return hits.length ? `<div class="y-list">${hits.map(([p, it]) => `<div class="y-row" data-y="open" data-id="${esc(p + '|' + it.id)}" data-k="h-${p}-${esc(it.id)}">${itLogo(it)}<div class="y-tx"><div class="y-nm">${esc(it.name)}</div><div class="y-mt">${PROV[p].name}</div></div><span class="y-ib" aria-hidden="true">${g('open')}</span></div>`).join('')}</div>` : empty('لا نتائج', `لا شيء مثبت باسم «${esc(S.q)}»`);
      }
      if (!PROVS.length) return empty('لا محرك إضافات هنا', 'نسخة المتصفح للتتبع فقط؛ ثبّت الإضافات من تطبيق أندرويد أو ويندوز.');
      const order = [...S.provPins, ...PROVS.filter((k) => !S.provPins.includes(k))];
      const total = PROVS.reduce((n, k) => n + S.items[k].length, 0), updates = PROVS.reduce((n, k) => n + upCount(k), 0);
      const group = (label, keys, lead = '') => (keys.length || lead ? `<section class="y-hub-group"><div class="y-group-head"><h3>${label}</h3><span>${keys.length}</span></div><div class="y-hub">${lead}${keys.map(provCard).join('')}</div></section>` : '');
      const others = order.filter((k) => !S.provPins.includes(k));
      return `<div class="y-overview"><div class="y-overview-stats"><div><b>${total}</b><span>مثبّتة</span></div><div class="y-stat-btn ${updates ? 'has' : ''}" ${updates ? 'data-y="updSheet" role="button" tabindex="0" aria-label="عرض التحديثات"' : ''}><b>${updates}</b><span>تحديثات</span></div><div><b>${PROVS.length}</b><span>مزوّدون</span></div></div></div>${S.provPins.length ? group('المفضّلة', S.provPins, guardCard()) : ''}${group(S.provPins.length ? 'المزوّدون الآخرون' : 'المزوّدون', others, S.provPins.length ? '' : guardCard())}`;
    },
    stremio() {
      const all = S.items.stremio; const list = all.filter((x) => (S.filter === 'all' || x.type === S.filter) && match(x.name));
      const on = all.filter((x) => x.on).length;
      return `${header('stremio', `${all.length} إضافات · ${on} مفعّلة`)}
      <form class="y-add" data-y="addForm"><label class="y-in">${g('link', 22)}<input id="y-addon-url" class="${S.url ? 'ltr' : ''}" name="u" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="رابط الإضافة" placeholder="رابط الإضافة" value="${esc(S.url)}" data-y="url"></label><button class="y-pri big" type="submit" ${validUrl(S.url) ? '' : 'disabled'}>تثبيت الإضافة</button></form>
      <div class="y-chips">${[['all', 'الكل'], ['links', 'روابط'], ['subs', 'ترجمات'], ['cat', 'كتالوج']].map(([k, t]) => `<button class="y-chip ${S.filter === k ? 'on' : ''}" data-y="filter" data-id="${k}">${t}</button>`).join('')}</div>
      ${list.length ? orderGroups('stremio', list, stCard, 'y-grid') : S.loading.stremio ? empty('يقرأ…', '') : empty('لا شيء هنا', 'غيّر التصنيف أو أضف رابطًا')}`;
    },
    ext(p) {
      const t = S.tab[p];
      const inst = t === 'inst' ? S.items[p].filter((x) => match(x.name)) : [];
      const av = t === 'avail' ? availFor(p) : [];
      const repos = S.repos[p]; const up = upCount(p);
      const line = repos.length ? `${repos.map((r) => esc(r.name)).join(' · ')} · ${S.items[p].length} مثبتة` : S.loading[p] ? 'يقرأ…' : 'بلا مستودع';
      if (!repos.length && !S.items[p].length && !S.loading[p]) {
        return `${header(p, line)}<div class="y-empty"><span class="y-lg xl">${g('repo', 30)}</span><div class="y-nm">أضف مستودعًا</div><div class="y-mt">${S.errors[p] ? `<span class="y-bad">${esc(S.errors[p])}</span>` : 'الإضافات تأتي من المستودعات'}</div><button class="y-pri big" data-y="addRepo" data-id="${p}">${g('plus', 22)}مستودع</button></div>`;
      }
      const body = t === 'inst'
        ? `${up ? `<div class="y-tools"><span class="y-sp"></span><button class="y-pri" data-y="updAll" data-id="${p}">${g('update', 20)}حدّث الكل <i style="font-style:normal;opacity:.75">${up}</i></button></div>` : ''}${inst.length ? orderGroups(p, inst, (x) => instRow(p, x), 'y-list') : S.loading[p] ? empty('يقرأ…', '') : empty('لا شيء مثبت', 'ثبّت من «متاحة»')}`
        : t === 'avail'
          ? `<div class="y-tools">${langPill(p)}<button class="y-lang y-repo-filter" data-y="reposFilter" data-id="${p}" aria-haspopup="dialog">${g('repo', 18)}<span>المستودعات: ${esc(S.repos[p].find((r) => r.id === S.repoFilter[p])?.name || 'الكل')}</span>${g('down', 16)}</button></div>${av.length ? `<section class="y-order-section" data-k="available-${p}"><div class="y-list y-available-list">${drawAvailable(p, av)}</div></section>` : S.loading[p] ? empty('يقرأ الفهارس…', '') : empty('لا توجد إضافات مطابقة', 'غيّر المستودع أو اللغة أو البحث')}`
          : `<div class="y-list" style="grid-template-columns:1fr">${repos.map((r, i) => repoRow(p, r, i)).join('')}</div>`;
      return `${header(p, line)}${tabs(p, [['inst', 'مثبتة', S.items[p].length], ['avail', 'متاحة', S.avail[p].filter((x) => langOk(p, x)).length], ['repos', 'المستودعات', repos.length]])}<div class="y-tb" data-k="pane-${p}-${t}">${body}</div>`;
    },
    details({ p, id }) {
      const it = S.items[p].find((x) => x.id === id); if (!it) return empty('لم تعد مثبتة', 'ارجع للقائمة');
      const st = p === 'stremio', b = S.busy[it.id], ch = challengeOf(it), k = p + '|' + it.id;
      const health = healthOf(it);
      const state = pulseView(health);
      const kv = [
        canToggle(p) ? `<div>تفعيل الإضافة${switchBtn(p, it)}</div>` : '',
        st ? `<div><span>تقدّم</span><b>${TYPE[it.type]}</b></div>` : '',
        it.cont ? `<div><span>المحتوى</span><b>${esc(it.cont)}</b></div>` : '',
        !st && it.repoId ? `<div><span>المستودع</span><b dir="auto">${esc(repoName(p, it))}</b></div>` : '',
        !st ? `<div><span>اللغة</span><b>${esc(it.lang || 'العربية')}</b></div>` : '',
        it.site ? `<div><span>الموقع</span><b dir="ltr">${esc(hostOf(it.site))}</b></div>` : '',
        ch ? `<div><span class="y-bad">${esc(ch.message || 'الموقع يطلب تحققًا')}</span><button class="y-ch-btn" data-y="verify" data-id="${esc(ch.host)}" ${ch.verifying ? 'disabled' : ''}>تحقق</button></div>` : '',
        `<div><span>الحالة</span><b class="${ch || it.bad ? 'y-bad' : ''}">${esc(!it.on ? 'معطّلة' : ch ? ch.verifying ? 'جارٍ التحقق' : 'يحتاج تحققًا'
          : it.pending ? 'بانتظار الاستعادة' : it.bad || health?.state === 'failed' ? 'تعذّر الاتصال'
          : !health ? 'لم يُفحص' : Date.now() - health.at > 30 * 60_000 && health.state !== 'verification' ? 'لم يُفحص مؤخرًا' : state.label)}</b></div>`,
        !ch && health && state.detail ? `<div><span>آخر استجابة</span><b>${esc(state.detail)}</b></div>` : '',
        it.note ? `<div><span>ملاحظة</span><b>${esc(it.note)}</b></div>` : '',
      ].join('');
      const openable = st ? it.open : !it.isSite;
      return `<div class="y-wide"><div class="y-det">${itLogo(it, 'xxl')}<div class="y-nm">${esc(it.name)}</div><div class="y-mt" style="justify-content:center">${PROV[p].name}${it.ver ? ` · الإصدار ${b ? '…' : esc(it.ver)}` : ''}</div></div>
      <div class="y-acts"><button class="y-act ${it.pin ? 'on' : ''}" data-y="pin" data-id="${esc(k)}">${g(it.pin ? 'pinOn' : 'pin', 26)}${it.pin ? 'مفضّلة' : 'للمفضّلة'}</button>${st ? `<button class="y-act" data-y="conf" data-id="${esc(k)}" ${it.conf ? '' : 'disabled'}>${g('sliders', 26)}ضبط</button>` : ''}<button class="y-act" data-y="update" data-id="${esc(k)}" ${it.nv && !b ? '' : 'disabled'}>${g(b ? 'retry' : 'update', 26)}${b ? busyWord(b) : it.nv ? 'تحديث' : 'محدّثة'}</button><button class="y-act" data-y="site" data-id="${esc(k)}" ${it.site ? '' : 'disabled'}>${g('site', 26)}الموقع</button><button class="y-act" data-y="copy" data-id="${esc(k)}" ${copyUrl(p, it) ? '' : 'disabled'}>${g('link', 26)}الرابط</button></div>
      ${kv ? `<div class="y-kv">${kv}</div>` : ''}${openable ? `<button class="y-pri big y-detail-enter" data-y="enterSource" data-id="${esc(k)}" ${it.on && !it.bad && !it.pending && !b ? '' : 'disabled'}>${st ? 'افتح الكتالوج' : 'فتح الإضافة'} ${g('open', 20)}</button>` : ''}
      <button class="y-del" data-y="askDel" data-id="${esc(k)}" ${b ? 'disabled' : ''}>${g('trash')}حذف الإضافة</button></div>`;
    },
  };
  const validUrl = (u) => /^(https?:\/\/|stremio:\/\/)[^\s/]+\.[^\s]+/i.test(String(u).trim());
  function copyUrl(p, it) {
    if (p === 'stremio') return it.url || '';
    return repoOf(p, it)?.url || it.repoId || '';
  }

  // ── البيانات: المحركات الحقيقية ──
  let alive = true, gen = 0;
  const installed = {}; // p -> بيانات المحرك المثبتة كما هي
  const pending = {}; // p -> اختيارات بانتظار الاستعادة
  const broken = {}; // p -> حزم مثبتة لا تُقرأ
  const indexes = {}; // p -> Map(url -> عناصر الفهرس)
  let siteRows = [];
  const collator = new Intl.Collator();
  const regList = () => { try { return registry.list?.() || []; } catch { return []; } };
  // المصدر الأصلي (الموقع) لحزمة أصلية: من المصادر التي يعلنها المحرك لها (domain)
  function nativeSite(sources) {
    for (const a of sources) {
      const s = siteOf(a.homepage) || siteOf(a.domain) || siteOf(a.baseUrl) || siteOf(Array.isArray(a.domains) ? a.domains[0]?.url || a.domains[0] : '');
      if (s) return s;
    }
    return '';
  }
  const iconCandidates = (p, x, url) => {
    const out = [];
    for (const v of [x.iconUrl, x.icon, x.logo]) { const u = imageUrl(String(v || '').replace('%size%', '128')); if (u) out.push(u); }
    if (url && x.pkg && p !== 'cloudstream') {
      try { const base = /\.(?:json|pb)$/i.test(new URL(url).pathname) ? url : url.replace(/\/?$/, '/'); out.push(new URL(`icon/${x.pkg}.png`, base).href); } catch {}
    }
    return [...new Set(out)];
  };
  function remoteVm(a) {
    let url = '';
    try { url = httpUrl(registry.connection?.(a.key)?.manifestUrl) || ''; } catch {}
    const health = Object.values(a.health || {}).find((h) => ['failed', 'cooling'].includes(h?.state) && (h.version == null || h.version === a.version));
    const conts = [...new Set((a.contentTypes || []).map((t) => CONTENT_AR[t]).filter(Boolean))].join(' · ');
    const caps = a.capabilities || [];
    return {
      id: a.key, name: a.name || 'إضافة', ver: a.version ? String(a.version) : '', nv: a.stagedVersion ? String(a.stagedVersion) : null,
      on: toggling.get('stremio|' + a.key) ?? (a.enabled !== false), pin: !!a.pinned, imgs: [imageUrl(a.logo)].filter(Boolean), type: remoteType(a), cont: conts,
      conf: !!a.configuration?.configurable, url, site: siteOf(a.homepage) || (url ? new URL(url).origin : ''),
      bad: a.loadError ? fmtErr(a.loadError) : health ? fmtErr(health.reason || 'فشل الطلب الفعلي') : null,
      note: a.inRepository === false ? 'لم تعد في مستودعها؛ تعمل النسخة المحفوظة على جهازك' : null,
      open: a.enabled !== false && caps.some((c) => ['catalog', 'home', 'search'].includes(c)), raw: a,
    };
  }
  function readStremio() {
    if (!API.stremio) return;
    const managedCs = new Set((installed.cloudstream || []).map(nativePackage));
    S.items.stremio = regList()
      .filter((a) => !a.bundled && !String(a.key || '').startsWith('core|') && !(String(a.sourceId || '').startsWith('addon|cs3|') && managedCs.has(nativePackage(a))))
      .map(remoteVm);
    // المفضّلة أولًا بنفس ترتيب السجل
    S.items.stremio = pinFirst(S.items.stremio);
  }
  function rebuild(p) {
    const idx = indexes[p] || new Map(), store = STORE[p];
    const byPkg = new Map(), registered = new Map();
    for (const addon of regList()) {
      const pkg = nativePackage(addon);
      if (!pkg) continue;
      if (!registered.has(pkg)) registered.set(pkg, []);
      registered.get(pkg).push(addon);
    }
    for (const [url, list] of idx) for (const x of list || []) { const pkg = nativePackage(x); if (pkg && !byPkg.has(pkg)) byPkg.set(pkg, { x, url }); }
    const pins = new Set(pref.pins[p] || []), have = new Map();
    const vm = (m, from) => {
      const pkg = nativePackage(m), hit = byPkg.get(pkg), x = hit?.x || {}, sources = registered.get(pkg) ?? [];
      const url = m.repo || from || hit?.url || '';
      return {
        id: pkg, pkg, name: String(m.name || x.name || pkg).replace(/^(Tachiyomi|Aniyomi|Mihon):\s*/i, ''), ver: String(m.version ?? m.versionName ?? x.installed ?? x.version ?? ''),
        nv: x.update ? String(x.version ?? '') || 'جديد' : null, on: toggling.get(p + '|' + pkg) ?? (m.enabled !== false), pin: pins.has(pkg), lang: langName(m.lang ?? m.language ?? x.lang ?? x.language),
        repoId: url || null, imgs: [...new Set([...iconCandidates(p, { ...x, ...m, pkg }, url), ...iconCandidates(p, x, '')])], site: nativeSite(sources) || siteOf(m.homepage || m.domain || x.homepage),
        bad: m.loadError || m.error ? fmtErr(m.loadError || m.error) : null, pending: !!m.pendingRestore, content: m.content || x.content || (p === 'cloudstream' ? cloudstreamContent(x) : undefined),
        sourceIds: [...new Set([...(m.sourceIds ?? []), ...sources.map((a) => a.sourceId).filter(Boolean)])],
        sourceKeys: [...new Set([...sources.map((a) => a.key), ...(m.sourceIds ?? []).map((id) => 'core|' + id)])],
        url, raw: { ...x, ...m, pkg },
      };
    };
    for (const m of installed[p] || []) { if (m?.installed === false || m?.installed === null) continue; const r = vm(m); if (r.id) have.set(r.id, r); }
    for (const m of broken[p] || []) { const r = vm({ ...m, name: m.name || m.pkg }); if (r.id && !have.has(r.id)) have.set(r.id, { ...r, bad: 'تعذّرت قراءة الحزمة على الجهاز؛ احذفها وثبّتها من جديد', broken: true }); }
    for (const m of pending[p] || []) { const r = vm({ ...m, pendingRestore: true }); if (r.id && !have.has(r.id)) have.set(r.id, r); }
    // ما يعلنه الفهرس مثبتًا ولم تذكره قائمة المحرك (مصادر كانت مدمجة) يظهر مثبتًا كما في المدير السابق
    for (const [pkg, { x, url }] of byPkg) if (!have.has(pkg) && (x.installed || x.builtin)) have.set(pkg, vm({ ...x, name: x.name, version: x.installed || x.version, pendingRestore: x.pendingRestore }, url));
    if (p === 'mihon') for (const s of siteRows) { const id = 'site:' + (s.id ?? s.domain); if (!have.has(id)) have.set(id, { id, name: s.label || s.domain || 'موقع مانجا', ver: '', on: true, pin: pins.has(id), lang: 'موقع مانجا', imgs: [httpUrl(s.iconUrl)].filter(Boolean), site: siteOf(s.url || s.domain), url: '', isSite: true, raw: s }); }
    const prev = new Map(S.items[p].map((x, i) => [x.id, i]));
    const saved = new Map((pref.order[p] || []).map((id, i) => [id, i])), rk = (id) => saved.get(id) ?? 1e9;
    S.items[p] = pinFirst([...have.values()].sort((a, b) => rk(a.id) - rk(b.id) || (prev.get(a.id) ?? 1e9) - (prev.get(b.id) ?? 1e9) || a.name.localeCompare(b.name)));
    const wrong = (x) => (store.kind === 'manga' && x.anime === true) || (store.kind === 'anime' && p === 'aniyomi' && x.anime === false);
    S.avail[p] = [...byPkg.values()].filter(({ x }) => !have.has(nativePackage(x)) && !x.installed && !x.builtin && !adultSource(x) && !x.nsfw && !wrong(x)).map(({ x, url }) => ({
      id: nativePackage(x), pkg: nativePackage(x), name: String(x.name || nativePackage(x)).replace(/^(Tachiyomi|Aniyomi|Mihon):\s*/i, ''), ver: String(x.version ?? ''), lang: langName(x.lang ?? x.language),
      repoId: url, imgs: iconCandidates(p, x, url), content: p === 'cloudstream' ? cloudstreamContent(x) : x.content, raw: x, url,
    })).map((it) => ({...it, searchName: it.name.toLowerCase()})).sort((a, b) => Number(b.lang === 'العربية') - Number(a.lang === 'العربية') || collator.compare(a.name, b.name));
    // أول مرة: العربية مختارة إن وُجدت، وإلا كل اللغات
    if (!pref.langs[p] && S.avail[p].length && !S.langs[p].size && S.avail[p].some((x) => x.lang === 'العربية')) S.langs[p] = new Set(['العربية']);
  }
  const repoVm = (p, r) => { const meta = pref.repoMeta[r.url] || {}; return { id: r.url, url: r.url, name: meta.name || r.name || hostOf(r.url) || 'مستودع', image: meta.image || r.iconUrl || r.icon || ghAvatar(r.url), n: indexes[p]?.get(r.url)?.length ?? null, err: null }; };
  async function pool(list, n, fn) { const q = [...list]; await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { while (q.length) await fn(q.shift()); })); }
  async function readNative(p, run) {
    const api = API[p]; S.loading[p] = true;
    try {
      const res = await api.list();
      if (!alive || run !== gen) return;
      installed[p] = Array.isArray(res?.installed) ? res.installed.map((x) => ({ ...x })) : (installed[p] || []);
      pending[p] = Array.isArray(res?.pending) ? res.pending.map((x) => ({ ...x })) : [];
      // حزم مثبتة تالفة (CloudStream: unreadable): تظهر بسببها ويُتاح حذفها، لا تختفي
      broken[p] = Array.isArray(res?.unreadable) ? res.unreadable.filter((x) => x?.pkg).map((x) => ({ ...x })) : [];
      S.repos[p] = (res?.repos || []).filter((r) => httpUrl(r?.url)).map((r) => repoVm(p, r));
      indexes[p] ??= new Map();
      for (const url of [...indexes[p].keys()]) if (!S.repos[p].some((r) => r.url === url)) indexes[p].delete(url);
      if (!S.repos[p].some((r) => r.id === S.repoFilter[p])) S.repoFilter[p] = 'all';
      delete S.errors[p]; rebuild(p); scheduleRender();
      await pool(S.repos[p], 3, async (r) => {
        try { const list = await api.extensions(r.url); if (!alive || run !== gen) return; indexes[p].set(r.url, list || []); r.n = (list || []).length; r.err = null; }
        catch (e) { if (alive && run === gen) r.err = fmtErr(e); }
        if (alive && run === gen) { rebuild(p); scheduleRender(); }
      });
    } catch (e) {
      if (alive && run === gen && e?.code !== 'UNSUPPORTED_ON_WEB') S.errors[p] = fmtErr(e);
    } finally { if (alive && run === gen) { S.loading[p] = false; scheduleRender(); } }
  }
  async function refresh() {
    if (!alive) return;
    const run = ++gen;
    for (const p of PROVS) S.loading[p] = true;
    try { if (API.stremio) { readStremio(); S.loading.stremio = false; } } catch (e) { S.errors.stremio = fmtErr(e); S.loading.stremio = false; }
    scheduleRender();
    const siteTask = sites?.list ? sites.list().then((rows) => { if (alive && run === gen) { siteRows = rows || []; if (S.items.mihon) { rebuild('mihon'); scheduleRender(); } } }).catch(() => {}) : null;
    await Promise.all([...NATIVE.filter((p) => API[p]).map((p) => readNative(p, run)), siteTask]);
    if (alive && run === gen && API.stremio) { readStremio(); scheduleRender(); }
  }
  const sourcesChanged = (change) => { try { Promise.resolve(onSourcesChanged(change)).catch(() => {}); } catch {} };

  // تحديات الحماية: الطابور نفسه، وتحديث المربع فورًا مع كل تغير
  function receiveChallenges(items) {
    if (!alive) return;
    S.challenges = (Array.isArray(items) ? items : []).filter((x) => typeof x?.host === 'string').map((x) => ({ ...x, host: x.host.toLowerCase() }));
    scheduleRender(); paintGuardSheet();
  }

  // ── التركيب والرسم ──
  const root = doc.createElement('section');
  root.className = 'y-root'; root.dir = 'rtl'; root.setAttribute('data-y-root', '');
  const content = doc.createElement('div'); content.className = 'y'; root.append(content);
  const layer = doc.createElement('div'); layer.className = 'y-layer'; layer.dir = root.dir;
  let bar = null, titleEl = null, toolsEl = null, backBtn = null, barMode = '', barStyle = null;
  injectCss();
  function injectCss() {
    let st = doc.getElementById('y-addons-css');
    if (!st) { st = doc.createElement('style'); st.id = 'y-addons-css'; doc.head?.append(st); }
    const want = D ? 'desk' : 'mob';
    if (st.dataset.mode !== want) { st.textContent = css(D, win.innerWidth || 1366); st.dataset.mode = want; }
  }
  function attachBar() {
    if (!alive) return;
    if (!root.isConnected) { (win.requestAnimationFrame || setTimeout)(attachBar, 16); return; }
    const page = root.closest('.page') || root.parentElement;
    bar = page?.querySelector?.('.page-top') || null;
    if (bar) {
      titleEl = bar.querySelector('h1'); toolsEl = bar.querySelector('.page-top-left');
      if (!toolsEl) { toolsEl = doc.createElement('div'); toolsEl.className = 'page-top-left'; bar.append(toolsEl); }
      toolsEl.classList.add('y-bar-tools'); bar.classList.add('y-bar'); barStyle = bar.getAttribute('style'); bar.style.display = 'flex'; bar.style.alignItems = 'center';
      backBtn = bar.querySelector('[data-act="goBack"]'); backBtn?.classList.add('y-back-fixed');
      toolsEl.addEventListener('click', onClick, true);
      bar.addEventListener('input', onInput);
    }
    (root.closest('.v35') || doc.body).append(layer);
    renderBar();
  }
  let renderedView = '', renderQueued = false, deferredRender = false, drag = null, hold = null, suppressClickUntil = 0;
  // ما يصل من المحركات أثناء دخول الصفحة أو خروجها يُرسم حين تنتهي حركتها (قاعدة CLAUDE.md: لا بناء وهي تتحرك)
  function scheduleRender() {
    if (renderQueued || !alive) return; renderQueued = true;
    queueMicrotask(() => { const page = root.closest?.('.page'); const go = () => { renderQueued = false; if (alive) render(); }; if (page) afterMotion(page, go); else go(); });
  }
  const nodeKey = (n) => (n.nodeType === 1 ? (n.getAttribute('data-k') || (n.hasAttribute('data-y') ? n.tagName + '|' + n.getAttribute('data-y') + '|' + (n.getAttribute('data-id') || '') : '')) : '');
  const compatible = (a, b) => a && a.nodeType === b.nodeType && (a.nodeType !== 1 || (a.tagName === b.tagName && nodeKey(a) === nodeKey(b)));
  function patchNode(a, b) {
    if (a.nodeType !== 1) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
    const sameLogo = a.hasAttribute('data-logo') && a.getAttribute('data-logo') === b.getAttribute('data-logo')
      && a.firstElementChild?.textContent === b.firstElementChild?.textContent;
    for (const x of [...a.attributes]) if (!b.hasAttribute(x.name) && !(sameLogo && x.name === 'data-loaded')) a.removeAttribute(x.name);
    for (const x of [...b.attributes]) if (a.getAttribute(x.name) !== x.value) a.setAttribute(x.name, x.value);
    if (sameLogo) return;
    if (b.hasAttribute('data-logo')) { a.replaceChildren(...b.childNodes); return; }
    if (a.tagName === 'INPUT') { if (a !== doc.activeElement && a.value !== b.value) a.value = b.value; return; }
    patchChildren(a, b);
  }
  function patchChildren(parent, next) {
    const old = [...parent.childNodes], used = new Set(), byKey = new Map();
    for (const x of old) { const k = nodeKey(x); if (k) { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(x); } }
    let at = parent.firstChild;
    for (const n of [...next.childNodes]) {
      const k = nodeKey(n);
      const found = k ? (byKey.get(k) || []).find((x) => !used.has(x) && compatible(x, n)) : (compatible(at, n) && !used.has(at) ? at : old.find((x) => !used.has(x) && compatible(x, n)));
      if (found) { used.add(found); if (found !== at) parent.insertBefore(found, at); if (!found.isEqualNode(n)) patchNode(found, n); at = found.nextSibling; }
      else { const c = n.cloneNode(true); parent.insertBefore(c, at); at = c.nextSibling; }
    }
    for (const x of old) if (!used.has(x)) x.remove();
  }
  function render({ flip = true, indicatorFrom } = {}) {
    if (!alive) return;
    if (drag) { deferredRender = true; return; }
    const c = cur(), key = c.v + (c.p || '') + (c.id || ''); const same = renderedView === key;
    const availableView = NATIVE.includes(c.v) && S.tab[c.v] === 'avail';
    if (!availableView) available = null;
    const before = flip && same && !availableView ? snap() : null;
    const html = c.v === 'hub' ? views.hub() : c.v === 'stremio' ? views.stremio() : c.v === 'details' ? views.details(c) : views.ext(c.v);
    const tpl = doc.createElement('template'); tpl.innerHTML = html;
    if (same) patchChildren(content, tpl.content); else { content.replaceChildren(tpl.content); renderedView = key; }
    if (availableView) {
      scheduleAvailable();
      if (!RM && available?.entrance) {
        available.entrance = false;
        [...content.querySelectorAll('.y-avail-row')].slice(0, 12).forEach((row, index) => {
          row.animate?.([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
            { duration: 180, delay: index * 9, easing: EASE, fill: 'backwards' });
        });
      }
    }
    renderBar(); placeInd(indicatorFrom); if (before) play(before);
  }
  const titleFor = (c) => (c.v === 'details' ? PROV[c.p].name : 'الإضافات');
  function renderBar() {
    if (!bar || !titleEl || !toolsEl) return;
    const c = cur();
    if (S.searching) {
      titleEl.hidden = true;
      if (!bar.querySelector('.y-bar-q')) {
        const q = doc.createElement('label'); q.className = 'y-bar-q'; q.innerHTML = `${g('search', 22)}<input data-y="q" aria-label="البحث في الإضافات" placeholder="${c.v === 'hub' ? 'ابحث في كل الإضافات' : 'ابحث'}" autocomplete="off">`;
        titleEl.after(q); q.querySelector('input').value = S.q; q.querySelector('input').focus?.();
      }
      const html = ib('closeSearch', 'close', { label: 'إغلاق البحث', s: 24 }); if (barMode !== 'search') { toolsEl.innerHTML = html; barMode = 'search'; }
      return;
    }
    bar.querySelector('.y-bar-q')?.remove(); titleEl.hidden = false; titleEl.textContent = titleFor(c);
    const t = [];
    if (c.v !== 'details') t.push(ib('search', 'search', { label: 'بحث', s: 24 }));
    if (NATIVE.includes(c.v)) t.push(ib('addRepo', 'plus', { id: c.v, label: 'أضف مستودعًا', s: 24 }));
    if (c.v === 'hub' && PROVS.length) t.push(ib('hubMenu', 'more', { label: 'نقل الإضافات', s: 24 }));
    if (c.v === 'details') t.push(ib('itemMenu', 'more', { id: c.p + '|' + c.id, label: 'خيارات', s: 24 }));
    const html = t.join(''); if (barMode !== html) { toolsEl.innerHTML = html; barMode = html; }
  }
  // FLIP: كل عنصر بمفتاح data-k ينزلق من مكانه القديم
  function snap() { const m = new Map(); content.querySelectorAll('[data-k]').forEach((e) => m.set(e.dataset.k, e.getBoundingClientRect?.())); return m; }
  function play(m) {
    if (RM || typeof content.animate !== 'function') return;
    content.querySelectorAll('[data-k]').forEach((e) => {
      const a = m.get(e.dataset.k); const b = e.getBoundingClientRect();
      if (!a) { e.animate([{ opacity: 0, transform: 'scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: M.flip, easing: EASE }); return; }
      const dx = a.left - b.left, dy = a.top - b.top;
      if (Math.abs(dx) + Math.abs(dy) > 1) e.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: M.flip, easing: EASE });
    });
  }
  const indPos = () => { const t = content.querySelector('.y-tabs'); const o = t?.querySelector('.y-tab.on'); if (!o || !o.getBoundingClientRect) return null; const a = t.getBoundingClientRect(), b = o.getBoundingClientRect(); return { l: b.left - a.left, w: b.width }; };
  function placeInd(from) {
    const ind = content.querySelector('.y-ind'); const to = indPos(); if (!ind || !to) return;
    ind.style.width = to.w + 'px'; ind.style.transform = `translateX(${to.l}px)`;
    if (from && !RM && ind.animate) ind.animate([{ width: from.w + 'px', transform: `translateX(${from.l}px)` }, { width: to.w + 'px', transform: `translateX(${to.l}px)` }], { duration: M.ind, easing: EASE });
  }

  // ── التنقّل: الرجوع داخل المدير أولًا، ثم للقشرة ──
  const scroller = () => { for (let e = root.parentElement; e && e !== doc.body; e = e.parentElement) { const o = win.getComputedStyle?.(e).overflowY; if (/auto|scroll/.test(o || '') && e.scrollHeight > e.clientHeight + 4) return e; } return null; };
  let available = null, availableFrame = null;
  const rowStride = () => D ? 106 : 74;
  function availableRows(p, rows, first, last) {
    const spacer = (key, count) => `<div data-k="${key}" aria-hidden="true" style="height:${count * rowStride()}px"></div>`;
    return spacer('available-before', first) + rows.slice(first, last).map((it) => availRow(p, it)).join('')
      + spacer('available-after', rows.length - last);
  }
  function drawAvailable(p, rows) {
    const key = JSON.stringify([p, S.q, S.repoFilter[p], [...S.langs[p]]]);
    if (available?.key !== key || !available?.rows.length) {
      available = { key, p, first: 0, last: AVAILABLE_INITIAL_ROWS, rows, entrance: rows.length > 0 };
    }
    available.rows = rows;
    available.first = Math.min(available.first, Math.max(0, rows.length - AVAILABLE_INITIAL_ROWS));
    available.last = Math.min(rows.length, Math.max(available.last, available.first + AVAILABLE_INITIAL_ROWS));
    return availableRows(p, rows, available.first, available.last);
  }
  function scheduleAvailable() {
    if (!alive || !available || availableFrame != null || !win.requestAnimationFrame) return;
    availableFrame = win.requestAnimationFrame(() => {
      availableFrame = null;
      const list = content.querySelector('.y-available-list');
      if (!available || !list?.isConnected) return;
      const box = list.getBoundingClientRect(), parent = scroller(), viewport = parent?.getBoundingClientRect();
      const stride = rowStride(), top = Math.max(0, (viewport?.top ?? 0) - box.top);
      const first = Math.max(0, Math.floor(top / stride) - AVAILABLE_OVERSCAN);
      const last = Math.min(available.rows.length,
        Math.ceil((top + (viewport?.height ?? win.innerHeight ?? 0)) / stride) + AVAILABLE_OVERSCAN);
      if (first >= last || first === available.first && last === available.last) return;
      Object.assign(available, {first, last});
      const tpl = doc.createElement('template');
      tpl.innerHTML = availableRows(available.p, available.rows, first, last);
      patchChildren(list, tpl.content);
    });
  }
  const getScroll = () => { const s = scroller(); return s ? s.scrollTop : (win.scrollY || 0); };
  const setScroll = (y) => { const s = scroller(); if (s) s.scrollTop = y; else win.scrollTo?.(0, y); };
  function transition(dir, mutate) {
    if (drag) finishDrag(drag.id, true); clearHold();
    content.getAnimations?.().forEach((a) => a.cancel());
    mutate(); render({ flip: false });
    if (!RM && content.animate) { const dx = dir === 'in' ? -1 : 1; content.animate([{ opacity: 0, transform: `translateX(${dx * 12}px)` }, { opacity: 1, transform: 'none' }], { duration: 180, easing: EASE }); }
    if (dir === 'out') replayToggle();
  }
  function go(c) { cur().savedFilter = S.filter; cur().savedScroll = getScroll(); S.q = ''; S.searching = false; S.filter = 'all'; transition('in', () => S.stack.push(c)); setScroll(0); }
  function back() {
    if (sheetEl) { closeSheet(); return true; }
    if (S.searching) { S.searching = false; S.q = ''; render({ flip: false }); return true; }
    if (S.stack.length > 1) { transition('out', () => { S.stack.pop(); S.filter = cur().savedFilter || 'all'; }); setScroll(cur().savedScroll || 0); return true; }
    return false;
  }
  // المعطّلة من التفاصيل: الصف يُرسم مبلورًا من أول إطار (لا وميض). المفعّلة تنتقل من المبلور إلى الواضح.
  function replayToggle() {
    if (!S.justToggled || RM) { S.justToggled = null; return; }
    const [jp, jid] = S.justToggled.split('|'); S.justToggled = null;
    const it = S.items[jp]?.find((x) => x.id === jid); const r = content.querySelector(jp === 'stremio' ? `[data-k="st-${cssEsc(jid)}"]` : `[data-k="${cssEsc(jp + '-' + jid)}"]`);
    if (!r || !it) return;
    // الصف بحالته النهائية كاملة من أول إطار (المعطّلة: تبليط + مفتاح). لا إخفاء مؤجل للأزرار:
    // كان fill:'backwards' مع تأخير 260ms يُظهر المعطّلة مبلورة بلا مفتاح لثلث ثانية.
    if (it.on) [...r.querySelectorAll(':scope>.y-ib')].forEach((x) => x.animate?.([{ opacity: 0.4, transform: 'scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: EASE }));
  }
  const cssEsc = (s) => (globalThis.CSS?.escape ? globalThis.CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));

  // ── الأوراق والتنبيهات ──
  let sheetEl = null, afterSheetClose = null, toastEl = null, toastT = 0;
  function sheet(html, { onMount, label = 'خيارات الإضافات' } = {}) {
    closeSheet(true);
    sheetEl = doc.createElement('div'); sheetEl.className = 'y-sheet'; sheetEl.dataset.y = 'scrim';
    sheetEl.innerHTML = `<div class="y-pan" role="dialog" aria-modal="true" aria-label="${esc(label)}">${D ? '' : '<div class="y-grab"></div>'}${html}</div>`;
    layer.append(sheetEl); root.inert = true; if (bar) bar.inert = true; syncSheetViewport();
    if (!RM && sheetEl.animate) {
      sheetEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: M.sheetIn, easing: 'linear' });
      sheetEl.firstElementChild.animate(D ? [{ opacity: 0, transform: 'translateY(18px) scale(.98)' }, { opacity: 1, transform: 'none' }] : [{ opacity: 0, transform: 'translateY(100%)' }, { opacity: 1, offset: 0.45 }, { opacity: 1, transform: 'none' }], { duration: M.sheetIn, easing: EASE });
    }
    onMount?.(sheetEl);
    return sheetEl;
  }
  function closeSheet(instant) {
    const el = sheetEl; if (!el) return;
    if (el.contains(doc.activeElement)) doc.activeElement.blur?.();
    sheetEl = null; root.inert = false; if (bar) bar.inert = false;
    const next = afterSheetClose; afterSheetClose = null; if (next) queueMicrotask(next);
    if (instant || RM || el.dataset.dragged || !el.animate) { el.remove(); return; }
    el.style.pointerEvents = 'none';
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: M.sheetOut, easing: 'linear', fill: 'forwards' });
    el.firstElementChild.animate(D ? [{ opacity: 1 }, { opacity: 0, transform: 'translateY(12px) scale(.98)' }] : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(60%)' }], { duration: M.sheetOut, easing: EIN, fill: 'forwards' }).onfinish = () => el.remove();
  }
  const dismiss = () => closeSheet();
  function toast(t) {
    toastEl?.remove(); clearTimeout(toastT);
    toastEl = doc.createElement('div'); toastEl.className = 'y-toast'; toastEl.textContent = t; toastEl.setAttribute('role', 'status'); layer.append(toastEl);
    if (!RM && toastEl.animate) toastEl.animate([{ opacity: 0, transform: 'translate(-50%,12px) scale(.96)' }, { opacity: 1, transform: 'translate(-50%,0)' }], { duration: M.toast, easing: EASE });
    toastT = setTimeout(() => { const e = toastEl; if (!e) return; if (RM || !e.animate) { e.remove(); return; } e.animate([{ opacity: 1 }, { opacity: 0, transform: 'translate(-50%,6px)' }], { duration: M.sheetOut, easing: EIN, fill: 'forwards' }).finished.then(() => e.remove()).catch(() => e.remove()); }, 2400);
  }
  let viewportRAF = 0;
  function syncSheetViewport() { if (!sheetEl) return; const v = win.visualViewport; const h = v?.height || win.innerHeight || 800, t = v?.offsetTop || 0; sheetEl.style.setProperty('--visible-h', `${Math.round(h)}px`); sheetEl.style.setProperty('--visible-top', `${Math.round(t)}px`); sheetEl.classList.toggle('y-compact-sheet', h < 520 && !sheetEl.classList.contains('y-ra-sheet')); }
  const scheduleSheetViewport = () => { cancelAnimationFrame?.(viewportRAF); viewportRAF = (win.requestAnimationFrame || setTimeout)(syncSheetViewport); };

  // ── عمليات حقيقية بحالة مرئية ──
  async function run(id, kind, task) {
    if (S.busy[id]) return false;
    S.busy[id] = { kind }; render({ flip: false });
    try { await task(); return true; }
    catch (e) { if (alive) toast(fmtErr(e)); return false; }
    finally { delete S.busy[id]; if (alive) render(); }
  }
  // ── الترتيب (لتصل لإضافاتك أسرع): Stremio في السجل نفسه فيتبعه ترتيب المصادر، والبقية محفوظة على الجهاز ──
  const stepGroup = (p, it, dir) => { const a = S.items[p]; const grp = a.filter((x) => !!x.pin === !!it.pin); const i = grp.indexOf(it), j = i + dir; if (i < 0 || j < 0 || j >= grp.length) return false; [grp[i], grp[j]] = [grp[j], grp[i]]; let n = 0; S.items[p] = pinFirst(a.map((x) => (!!x.pin === !!it.pin ? grp[n++] : x))); return true; };
  const shiftGroup = (p, it, top) => { const a = S.items[p], grp = a.filter((x) => !!x.pin === !!it.pin); const idx = grp.indexOf(it); if (idx < 0) return; grp.splice(idx, 1); top ? grp.unshift(it) : grp.push(it); let i = 0; S.items[p] = pinFirst(a.map((x) => (!!x.pin === !!it.pin ? grp[i++] : x))); };
  async function persistOrder(p) {
    const ids = S.items[p].map((x) => x.id);
    if (p !== 'stremio') { pref.order[p] = ids; if (!savePref()) toast('حُفظ الترتيب لهذه الجلسة فقط'); return; }
    try { await registry.order(ids); sourcesChanged({ preserveAddonsView: true, reason: 'order' }); } catch (e) { toast(fmtErr(e)); readStremio(); render(); }
  }
  const find = (key) => { const i = String(key).indexOf('|'); const p = key.slice(0, i), id = key.slice(i + 1); return [p, id, S.items[p]?.find((x) => x.id === id)]; };
  const popPin = (sel) => { if (RM) return; content.querySelectorAll(sel).forEach((b) => b.firstElementChild?.animate?.([{ transform: 'scale(.6) rotate(-20deg)' }, { transform: 'scale(1.18) rotate(4deg)', offset: 0.6 }, { transform: 'none' }], { duration: M.enter, easing: EASE })); };
  /** تثبيت أصلي: لا يكفي رد المحرك، يُقرأ المخزن الدائم ويُتأكد من الحزمة (كما في المدير السابق). */
  async function installNative(p, it, target) {
    const api = API[p];
    const content = target ?? (KIND[p] === 'anime' ? (it.content === 'cinema' ? 'cinema' : 'anime') : undefined);
    await (p === 'mihon' ? api.install(it.url || it.repoId, it.pkg) : api.install(it.url || it.repoId, it.pkg, content));
    const state = await api.list();
    let ok = Array.isArray(state?.installed) && state.installed.some((x) => nativePackage(x) === it.pkg && x.installed !== false);
    if (!ok && api.extensions) ok = ((await api.extensions(it.url || it.repoId)) || []).some((x) => nativePackage(x) === it.pkg && (x.installed || x.builtin));
    if (!ok) throw new Error('لم يؤكد المحرك حفظ الإضافة على الجهاز؛ أعد المحاولة.');
    if (Array.isArray(state?.installed)) installed[p] = state.installed.map((x) => ({ ...x }));
    // الفهرس المحفوظ يُعاد قراءته ليصير «مثبتة» بإصدارها
    try { const list = await api.extensions(it.url || it.repoId); indexes[p]?.set(it.url || it.repoId, (list || []).map((x) => ({ ...x }))); } catch {}
    rebuild(p);
    setTimeout(() => sourcesChanged({ preserveAddonsView: true, reason: 'native-install', pkg: it.pkg, family: STORE[p].family || STORE[p].id }), 400);
  }
  async function verifyHost(host, btn) {
    if (!verification?.begin) return;
    if (btn) { btn.disabled = true; btn.innerHTML = `<span class="y-spin" style="display:grid">${g('spin', 18)}</span>`; }
    try {
      const result = await verification.begin(host);
      if (!alive) return;
      if (result?.ok === true) toast('تم التحقق واستجاب المصدر');
      else toast(result?.error || (result?.state ? verificationMessage(result) : 'لم يكتمل التحقق. تقدر تحاول مرة ثانية.'));
    } catch (e) { if (alive) toast(fmtErr(e)); }
    finally { if (btn?.isConnected) { btn.disabled = false; btn.textContent = 'تحقق'; } paintGuardSheet(); render(); }
  }
  function paintGuardSheet() {
    const list = sheetEl?.querySelector('[data-guard-list]'); if (!list) return;
    if (!S.challenges.length) { list.innerHTML = empty('لا شيء ينتظر', 'كل المواقع مفتوحة'); return; }
    const tpl = doc.createElement('template'); tpl.innerHTML = guardRows(); patchChildren(list, tpl.content);
  }
  const guardRows = () => {
    const sources = PROVS.flatMap((p) => S.items[p]);
    return S.challenges.map((c) => {
      const matches = sources.filter((item) => challengeMatches(c, item));
      const source = matches.find((item) => item.sourceIds?.includes(c.sourceId)) ?? matches[0];
      const name = c.sourceName && !namesEqual(c.sourceName, c.host) ? c.sourceName : source?.name || c.host;
      const url = httpUrl(c.origin) || source?.site || 'https://' + c.host;
      const status = c.verifying ? 'جارٍ التحقق' : c.message;
      return `<div class="y-up-row y-ch-row" data-k="ch-${esc(c.host)}"><span class="y-ch-logo">${logo(null, name, '', source?.imgs)}<span class="y-ch-shield">${g('shield', 14)}</span></span><div class="y-tx"><div class="y-nm" dir="auto">${esc(name)}</div>${namesEqual(name, c.host) ? '' : `<span class="y-ch-url" dir="ltr" title="${esc(url)}">${esc(url)}</span>`}${status ? `<span class="y-ch-url ${c.verifying ? 'y-up' : 'y-bad'}">${esc(status)}</span>` : ''}</div><button class="y-ch-btn" data-y="verify" data-id="${esc(c.host)}" ${c.verifying ? 'disabled' : ''}>تحقق</button></div>`;
    }).join('');
  };

  // ── المستودعات ──
  function ghAvatar(u) { try { const x = new URL(u); const parts = x.pathname.split('/').filter(Boolean); if (x.hostname === 'raw.githubusercontent.com' && parts[0]) return `https://github.com/${parts[0]}.png?size=128`; if (x.hostname.endsWith('github.io')) return `https://github.com/${x.hostname.split('.')[0]}.png?size=128`; if (x.hostname === 'github.com' && parts[0]) return `https://github.com/${parts[0]}.png?size=128`; } catch {} return ''; }
  function ghOwner(u) { try { const x = new URL(u); const parts = x.pathname.split('/').filter(Boolean); return x.hostname === 'raw.githubusercontent.com' || x.hostname === 'github.com' ? parts[0] : x.hostname.split('.')[0]; } catch { return ''; } }
  function openRepoAdd(p) {
    sheet(`<div class="y-ra"><div class="y-ra-head"><h2>مستودع جديد</h2>${ib('done', 'close', { label: 'إغلاق', s: 22 })}</div>
    <label class="y-in y-ra-url">${g('link', 20)}<input data-y="raUrl" type="url" inputmode="url" dir="ltr" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" placeholder="https://…/repo.json" aria-label="رابط المستودع"><button class="y-ra-paste" data-y="raPaste" type="button">لصق</button></label>
    <p class="y-ra-msg" role="status" aria-live="polite"></p>
    <div class="y-ra-prev is-empty"><label class="y-ra-img" aria-label="غيّر الصورة"><b>${g('link', 24)}</b><img alt="" hidden><span class="y-photo-plus">${g('plus', 14)}</span><input class="y-file" type="file" accept="image/*" data-y="raFile" hidden></label><div class="y-ra-meta"><label class="y-ra-nick"><span>اللقب</span><input data-y="raNick" maxlength="40" dir="auto" autocomplete="off" enterkeyhint="done" disabled placeholder="—"></label><div class="y-ra-count">الصورة واللقب يأتيان من الرابط</div></div></div>
    <button class="y-pri big" data-y="raAdd" data-id="${p}" disabled>${g('plus', 20)}أضف</button></div>`, {
      label: 'إضافة مستودع',
      onMount: (el) => { el.raP = p; el.classList.add('y-ra-sheet'); syncSheetViewport(); if (win.matchMedia?.('(pointer:fine)')?.matches) setTimeout(() => { if (sheetEl === el) el.querySelector('[data-y="raUrl"]').focus(); }, M.sheetIn); },
    });
  }
  /**
   * معاينة المستودع قبل إضافته: المحرك نفسه يقرأ الفهرس (Keiyoushi صار protobuf، ومستودعات CloudStream
   * قوائم متعددة)، فالمعاينة تطابق ما سيُثبَّت فعلًا. لا تُضاف المستودعات قبل ضغط «أضف».
   */
  async function raCheck(el) {
    const p = el.raP, inp = el.querySelector('[data-y="raUrl"]'), btn = el.querySelector('[data-y="raAdd"]'), msg = el.querySelector('.y-ra-msg'), prev = el.querySelector('.y-ra-prev');
    const tok = el.raTok = (el.raTok || 0) + 1; el.raData = null; btn.disabled = true;
    const say = (h, k = '') => { msg.innerHTML = h; msg.dataset.kind = k; };
    const nickEl = prev.querySelector('[data-y="raNick"]'), cnt = prev.querySelector('.y-ra-count'), pimg = prev.querySelector('img'), pb = prev.querySelector('b');
    const hide = () => { if (prev.classList.contains('is-empty')) return; prev.classList.add('is-empty'); pimg.hidden = true; pb.hidden = false; pb.innerHTML = g('link', 24); if (!nickEl.dataset.touched) nickEl.value = ''; nickEl.disabled = true; cnt.textContent = 'الصورة واللقب يأتيان من الرابط'; };
    const raw = inp.value.trim(); if (!raw) { say(''); hide(); return; }
    let url; try { url = new URL(raw.replace(/^cloudstreamrepo:\/\//i, 'https://')); if (!/^https?:$/.test(url.protocol)) throw 0; } catch { say('ليس رابطًا', 'err'); hide(); return; }
    const dup = S.repos[p].find((r) => r.url === url.href); if (dup) { say(`مضاف مسبقًا<button data-y="raOpen" data-id="${esc(p + '|' + dup.id)}">افتحه</button>`, 'err'); hide(); return; }
    say('يفحص…');
    try {
      const items = await API[p].extensions(url.href);
      if (tok !== el.raTok || sheetEl !== el) return;
      if (!Array.isArray(items) || !items.length) { say('المستودع فارغ أو ليس ملف مستودع لهذا المزوّد', 'err'); hide(); return; }
      const name = String(ghOwner(url.href) || hostOf(url.href) || 'مستودع').slice(0, 40);
      el.raData = { url: url.href, name, image: ghAvatar(url.href), n: items.length }; say('');
      pb.textContent = (name[0] || '?').toUpperCase();
      const pic = el.raImage || el.raData.image; pimg.hidden = !pic; pb.hidden = !!pic; if (pic) { pimg.onerror = () => { pimg.hidden = true; pb.hidden = false; }; pimg.src = pic; }
      nickEl.disabled = false; if (!nickEl.dataset.touched) nickEl.value = name;
      const langs = [...new Set(items.map((x) => langName(x.lang ?? x.language)))];
      cnt.textContent = `${items.length} ${items.length >= 3 && items.length <= 10 ? 'إضافات' : 'إضافة'} · ${langs.length > 2 ? langs.length + ' لغات' : langs.join(' · ')}`;
      const was = prev.classList.contains('is-empty'); prev.classList.remove('is-empty'); if (was && !RM) [...prev.children].forEach((x) => x.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: M.enter, easing: EASE }));
      btn.disabled = false;
    } catch (e) {
      if (tok !== el.raTok) return; hide();
      say(`${esc(fmtErr(e))}<button data-y="raRetry">أعد</button>`, 'err');
    }
  }
  async function readPhoto(file, size) {
    if (!file || file.size > 20 * 1024 * 1024) throw new Error('size');
    const u = URL.createObjectURL(file);
    try {
      const im = new Image(); im.src = u; await im.decode();
      const c = doc.createElement('canvas'); c.width = c.height = size; const side = Math.min(im.naturalWidth, im.naturalHeight);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#181818'; ctx.fillRect(0, 0, size, size);
      ctx.drawImage(im, (im.naturalWidth - side) / 2, (im.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      return c.toDataURL('image/webp', 0.85);
    } finally { URL.revokeObjectURL(u); }
  }
  const photoIcon = '<svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m3 17 5-5 4 4 4-5 5 6"/></svg>';
  function repoError(el, m) { const e = el?.querySelector('.y-repo-error'); if (e) { e.textContent = m; e.hidden = !m; } }
  function refreshPhoto(el) { const pic = el.querySelector('.y-repo-photo'), img = pic.querySelector('img'); const u = repoImage(el.repoImage); img.hidden = !u; if (u) img.src = u; else img.removeAttribute('src'); pic.classList.toggle('has-photo', !!u); el.querySelector('[data-y="removePhoto"]').hidden = !u; el.querySelector('.y-photo-label').textContent = u ? 'تغيير الصورة' : 'اختيار صورة'; }
  // تعديل المستودع: اللقب والصورة تفضيل عرض على هذا الجهاز؛ الرابط هو هوية المستودع في المحرك فلا يُعدَّل هنا
  function openRepoEditor(p, r) {
    sheet(`<div class="y-repo-editor"><div class="y-editor-title"><div><div class="y-editor-kicker">${esc(PROV[p].name)}</div><h2>تعديل المستودع</h2><p>خصّص اللقب والصورة.</p></div>${ib('done', 'close', { label: 'إغلاق', s: 22 })}</div><div class="y-editor-body"><div class="y-photo-block"><label class="y-repo-photo" for="y-repo-file">${photoIcon}<img alt="صورة المستودع" hidden><span class="y-photo-plus">${g('plus', 14)}</span></label><div class="y-photo-copy"><strong>صورة المستودع</strong><p>اختيارية · من جهازك</p><label class="y-photo-label" for="y-repo-file">اختيار صورة</label><button class="y-photo-remove" data-y="removePhoto" hidden>إزالة</button></div><input id="y-repo-file" class="y-file" type="file" accept="image/*" data-y="repoFile" aria-label="اختيار صورة المستودع"></div><div class="y-editor-fields"><label for="y-repo-name">لقب المستودع <small>اختياري</small></label><label class="y-in" for="y-repo-name"><input id="y-repo-name" data-y="repoName" maxlength="80" autocomplete="off" autocapitalize="off" enterkeyhint="done" value="${esc(r.name)}" placeholder="مثال: مستودع الأنمي" dir="auto"></label><label>رابط المستودع</label><div class="y-in y-in-ro" dir="ltr">${g('link', 20)}<span>${esc(r.url.replace(/^https?:\/\//, ''))}</span></div><p class="y-repo-error" role="alert" hidden></p></div></div><div class="y-editor-footer"><button class="y-pri big" data-y="repoSave" data-id="${esc(p + '|' + r.id)}">${g('check', 20)}حفظ التغييرات</button></div></div>`, {
      label: 'تعديل المستودع',
      onMount: (el) => { el.classList.add('y-editor-sheet'); el.repoImage = r.image || ''; refreshPhoto(el); syncSheetViewport(); },
    });
  }

  // ── «إضافاتي»: تصدير واستيراد (lib/extensions-transfer.js) ──
  const transferContext = () => ({ stores, registry, sites });
  async function showExport() {
    const el = sheet(`<div class="y-ttl">تصدير إضافاتي</div><p class="y-source-note" role="status" data-note>جارٍ تجهيز القائمة…</p><div class="y-btns" data-acts hidden><button class="y-sec" data-y="copyExport">انسخ النص</button><button class="y-pri big" data-y="saveExport">${g('share', 20)}احفظ الملف</button></div>`, { label: 'تصدير إضافاتي' });
    const note = el.querySelector('[data-note]');
    try {
      const d = await collectExtensions({ ...transferContext(), platform: registry.runtimeName || 'pwa' });
      if (sheetEl !== el) return;
      const total = Object.values(d.native).reduce((t, x) => t + x.extensions.length, 0) + d.addons.length + d.sites.length;
      if (!total) { note.textContent = 'لا إضافات مثبتة لتصديرها بعد.'; return; }
      note.textContent = `${total} ${total === 1 ? 'إضافة' : total === 2 ? 'إضافتان' : total <= 10 ? 'إضافات' : 'إضافة'} جاهزة. الملف فيه مستودعاتك وإضافاتك، ولا يحوي جلساتك ولا كلمات مرورك.`;
      el.exportText = serialize(d); el.querySelector('[data-acts]').hidden = false;
    } catch (e) { if (sheetEl === el) note.textContent = fmtErr(e); }
  }
  function showImport(d) {
    const when = d.exportedAt ? new Date(d.exportedAt).toLocaleDateString('ar', { day: 'numeric', month: 'long', year: 'numeric', numberingSystem: 'latn' }) : null;
    const el = sheet(`<div class="y-ttl">استيراد إضافاتي${when ? `<span>${esc(when)}</span>` : ''}</div><p class="y-source-note" role="status" data-note>جارٍ مقارنة الملف بما على هذا الجهاز…</p><div data-list></div><button class="y-pri big" data-y="importAll" hidden>ثبّت الكل</button>`, { label: 'استيراد إضافاتي' });
    el.importItems = []; el.importTrusted = false;
    planImport(d, transferContext()).then((items) => { if (sheetEl !== el) return; el.importItems = items; paintImport(el); }).catch((e) => { if (sheetEl === el) el.querySelector('[data-note]').textContent = fmtErr(e); });
  }
  function paintImport(el) {
    const items = el.importItems, titles = { ...TRANSFER_GROUPS, addons: 'إضافات الويب', sites: 'مواقع المانجا' };
    const status = (i) => (i.status === 'installed' ? 'مثبّتة' : i.status === 'installing' ? 'يثبّت…' : i.status === 'unavailable' ? i.reason : i.status === 'failed' ? i.error : '');
    el.querySelector('[data-list]').innerHTML = Object.keys(titles).map((gk) => { const mine = items.filter((i) => i.group === gk); return mine.length ? `<div class="y-up-h"><span><bdi>${esc(titles[gk])}</bdi></span><i>${mine.length}</i></div>${mine.map((i) => `<div class="y-up-row ${i.status === 'installed' ? 'done' : ''}" data-k="im-${esc(i.key)}"><div class="y-tx"><div class="y-nm" dir="auto">${esc(i.name)}</div><div class="y-mt">${[i.version && `الإصدار ${esc(i.version)}`, esc(status(i) || '')].filter(Boolean).join(' · ')}</div></div>${i.status === 'ready' || i.status === 'failed' ? `<button class="y-ch-btn" data-y="importOne" data-id="${esc(i.key)}">${i.status === 'failed' ? 'أعد' : 'تثبيت'}</button>` : i.status === 'installed' ? `<span class="y-ck on">${g('check', 18)}</span>` : ''}</div>`).join('')}` : ''; }).join('');
    const ready = items.filter((i) => i.status === 'ready' || i.status === 'failed').length, done = items.filter((i) => i.status === 'installed').length, off = items.filter((i) => i.status === 'unavailable').length;
    el.querySelector('[data-note]').textContent = el.importWarn || [`${done} مثبّتة`, ready && `${ready} جاهزة للتثبيت`, off && `${off} لا تعمل على هذا الجهاز وتبقى في الملف`].filter(Boolean).join(' · ');
    const all = el.querySelector('[data-y="importAll"]'); all.hidden = !ready; all.textContent = el.importWarn ? 'أثق بهذه المستودعات، ثبّت' : items.some((i) => i.status === 'ready') ? 'ثبّت الكل' : 'أعد محاولة ما فشل';
  }
  async function importInstall(el, targets) {
    if (el.importBusy) return;
    // المستودعات تحوي كودًا ينفَّذ على جهازك: موافقة صريحة مرة واحدة قبل إضافة أي مستودع
    if (!el.importTrusted && targets.some((t) => t.kind === 'native')) { el.importTrusted = true; el.importWarn = 'إضافات المستودعات تنفّذ كودًا على جهازك. ثبّت فقط إن كان الملف منك أو من مصدر تثق به؛ اضغط مجددًا للتأكيد.'; paintImport(el); return; }
    el.importWarn = null; el.importBusy = true; let changed = false;
    try {
      for (const t of targets.filter((x) => x.status === 'ready' || x.status === 'failed')) {
        if (sheetEl !== el) break;
        t.status = 'installing'; paintImport(el);
        Object.assign(t, await installItem(t, transferContext())); paintImport(el);
        if (t.status === 'installed') changed = true;
      }
    } finally { el.importBusy = false; }
    if (changed) { sourcesChanged({ preserveAddonsView: true }); void refresh(); }
  }

  // ── الأحداث ──
  const A = {
    prov: (k) => go({ v: k }),
    ppin(k) { const i = S.provPins.indexOf(k); if (i >= 0) S.provPins.splice(i, 1); else S.provPins.push(k); pref.provPins = [...S.provPins]; savePref(); render(); if (i < 0) popPin(`[data-y="ppin"][data-id="${k}"]`); toast(i >= 0 ? 'أُلغي التثبيت' : 'ثُبّت في الأعلى'); },
    async pin(key) {
      const [p, id, it] = find(key); if (!it) return;
      const next = !it.pin;
      if (p === 'stremio') { try { await registry.pin(it.id, next); } catch (e) { toast(fmtErr(e)); return; } }
      else { const set = new Set(pref.pins[p] || []); next ? set.add(id) : set.delete(id); pref.pins[p] = [...set]; savePref(); }
      it.pin = next; S.items[p] = pinFirst(S.items[p]); render();
      if (next) popPin(`[data-y="pin"][data-id="${cssEsc(key)}"]`);
      toast(next ? 'في المفضّلة' : 'أُزيلت من المفضّلة');
    },
    open(key) { const [p, id, it] = find(key); if (it) go({ v: 'details', p, id }); },
    moveUp(key) { const [p, , it] = find(key); if (it && canOrder(p) && stepGroup(p, it, -1)) { render(); void persistOrder(p); } },
    moveDown(key) { const [p, , it] = find(key); if (it && canOrder(p) && stepGroup(p, it, 1)) { render(); void persistOrder(p); } },
    toTop(key) { const [p, , it] = find(key); if (!it || !canOrder(p)) return; shiftGroup(p, it, true); dismiss(); render(); void persistOrder(p); },
    toBottom(key) { const [p, , it] = find(key); if (!it || !canOrder(p)) return; shiftGroup(p, it, false); dismiss(); render(); void persistOrder(p); },
    async toFirst(key) { const [p, , it] = find(key); if (!it || !canOrder(p)) return; dismiss(); if (!it.pin) await A.pin(key); if (!it.pin) return; shiftGroup(p, it, true); render(); await persistOrder(p); toast('صارت الأولى'); },
    tab(key) {
      const [p, k] = key.split('|'); if (S.tab[p] === k) return; const from = indPos(); S.tab[p] = k; setScroll(0); render({ flip: false, indicatorFrom: from });
      if (!RM && k !== 'avail') content.querySelector('.y-tb')?.animate?.([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: M.tab, easing: EASE });
    },
    filter(k) { S.filter = k; render(); },
    // الحركة الأصلية (قبل 3fa9e80): المفتاح ينقلب فورًا في مكانه، وبعد 200ms يأخذ الصف تمويه التعطيل أو يتركه، وفي
    // الجوال يخرج المفتاح بسلاسة ويدخل مكانه المفضّلة و› (أو العكس). إعادة الرسم الفورية كانت تقفز بالصف بلا حركة.
    // ومن إصلاحات 3fa9e80 تبقى: نقرة ثانية لا تُرسل أثناء الأولى (toggling)، والسجل المثبت يُحدَّث، والفشل يعيد الحالة
    async toggle(key) {
      const [p, id, it] = find(key);
      if (!it || !canToggle(p) || S.busy[id] || toggling.has(key)) return;
      const next = !it.on;
      toggling.set(key, next);
      const paint = (v) => doc.querySelectorAll(`[data-y="toggle"][data-id="${cssEsc(p + '|' + id)}"]`).forEach((b) => { b.classList.toggle('off', !v); b.setAttribute('aria-checked', String(!!v)); });
      paint(next); it.on = next;
      const settle = () => { toggling.delete(key); if (alive) render({ flip: false }); };
      try {
        await (p === 'stremio' ? registry.enable(id, next) : API[p].enable(it.pkg, next));
        const record = installed[p]?.find((row) => nativePackage(row) === id);
        if (record) record.enabled = next;
      } catch (error) {
        const current = find(key)[2];
        if (current) current.on = !next;
        paint(!next);
        if (alive) toast(fmtErr(error));
        settle();
        return;
      }
      sourcesChanged({ preserveAddonsView: true, reason: 'toggle' });
      const sel = p === 'stremio' ? `[data-k="st-${cssEsc(id)}"]` : `[data-k="${cssEsc(p + '-' + id)}"]`; const row = content.querySelector(sel);
      if (cur().v === 'details') { S.justToggled = key; settle(); return; }
      if (RM || !row || !alive) { settle(); return; }
      const swaps = p !== 'stremio' && !D; // في الجوال: المفتاح يحل محل المفضّلة و›
      setTimeout(() => {
        if (!alive) return void toggling.delete(key);
        row.classList.toggle('is-off', !it.on);
        if (!swaps) { settle(); return; }
        const out = [...row.querySelectorAll(':scope>.y-ib,:scope>.y-sw')];
        out.forEach((x) => x.animate?.([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.86) translateX(-6px)' }], { duration: M.sheetOut, easing: EIN, fill: 'forwards' }));
        setTimeout(() => {
          settle(); const r2 = content.querySelector(sel); if (!r2) return;
          [...r2.querySelectorAll(':scope>.y-ib,:scope>.y-sw')].forEach((x, n) => x.animate?.([{ opacity: 0, transform: 'scale(.86) translateX(10px)' }, { opacity: 1, transform: 'none' }], { duration: 240, delay: n * 50, easing: EASE, fill: 'backwards' }));
        }, M.sheetOut);
      }, 200);
    },
    enterSource(key) {
      const [p, , it] = find(key); if (!it?.on || it.bad || it.pending || S.busy[it.id]) return;
      const ch = challengeOf(it); if (ch && !onOpenNativeSource) { void verifyHost(ch.host); return; }
      if (p === 'stremio') { if (it.open) onOpenSource(it.raw); return; }
      if (it.isSite) return; // مواقع المانجا تُدار هنا ولا كتالوج مستقل لها (كما في المدير السابق)
      if (onOpenNativeSource) onOpenNativeSource({ ...it.raw, name: it.name, pkg: it.pkg, kind: KIND[p], content: it.content ?? it.raw?.content, _store: STORE[p], _url: it.url });
      else toast('افتح هذا المصدر من قسم الأنمي أو المانجا.');
    },
    site(key) { const [, , it] = find(key); const u = it?.site; if (!u) return; try { win.open(u, '_blank', 'noopener,noreferrer'); } catch { toast('تعذّر فتح الموقع'); } },
    reposFilter(p) { const selected = S.repoFilter[p]; sheet(`<div class="y-ttl">المستودعات</div><div class="y-ls y-repo-options">${[{ id: 'all', name: 'الكل' }, ...S.repos[p]].map((r) => `<button data-y="pickRepo" data-id="${esc(p + '|' + r.id)}" aria-pressed="${selected === r.id}">${r.id === 'all' ? `<span class="y-lg">${g('repo', 22)}</span>` : repoLogo(r)}<span class="y-repo-option-name">${esc(r.name)}</span><span class="y-ck ${selected === r.id ? 'on' : ''}">${selected === r.id ? g('check', 18) : ''}</span></button>`).join('')}</div>`); },
    pickRepo(key) { const i = key.indexOf('|'), p = key.slice(0, i), id = key.slice(i + 1); S.repoFilter[p] = id; setScroll(0); dismiss(); render({ flip: false }); },
    conf(key) {
      const [, , it] = find(key); if (!it?.conf) return;
      const link = configureLink(it.raw, registry); if (!link) { toast('تعذّر فتح صفحة الضبط'); return; }
      link.hidden = true; root.append(link); link.click(); setTimeout(() => link.remove(), 60_000);
    },
    async update(key) {
      const [p, , it] = find(key); if (!it?.nv) return;
      const ok = await run(it.id, 'update', async () => {
        if (p === 'stremio') { await registry.activateStaged(it.id); readStremio(); sourcesChanged({ preserveAddonsView: true }); }
        else await installNative(p, it);
      });
      if (ok) toast(`${it.name} محدّثة`);
    },
    async updAll(p) { for (const it of S.items[p].filter((x) => x.nv && !S.busy[x.id])) await A.update(`${p}|${it.id}`); },
    provUpd(k) { void A.updAll(k); },
    async retry(key) { const [p, , it] = find(key); if (!it) return; await run(it.id, 'retry', () => (p === 'stremio' ? registry.reinstall?.(it.id) : readNative(p, gen))); },
    async restore(key) { const [p, , it] = find(key); if (!it?.pending) return; if (await run(it.id, 'install', () => installNative(p, it))) toast(`${it.name} مثبتة`); },
    async install(key) {
      const [p, id] = [key.slice(0, key.indexOf('|')), key.slice(key.indexOf('|') + 1)]; const it = S.avail[p]?.find((x) => x.id === id); if (!it) return;
      if (await run(id, 'install', () => installNative(p, it))) toast(`${it.name} مثبتة`);
    },
    langs(p) {
      const counts = {}; S.avail[p].forEach((x) => (counts[x.lang] = (counts[x.lang] || 0) + 1));
      const list = Object.entries(counts).sort((a, b) => (a[0] === 'العربية' ? -1 : b[0] === 'العربية' ? 1 : b[1] - a[1]));
      const draw = (el) => { el.querySelector('.y-ls').innerHTML = list.map(([t, n]) => { const on = S.langs[p].has(t); return `<button data-y="lang" data-id="${esc(p + '|' + t)}"><span>${esc(t)}</span><i>${n}</i><span class="y-ck ${on ? 'on' : ''}" style="flex:none">${on ? g('check', 18) : ''}</span></button>`; }).join(''); };
      sheet(`<div class="y-ttl">اللغات<span data-y-cnt>${S.langs[p].size || 'كل اللغات'}${S.langs[p].size ? ' مختارة' : ''}</span></div><div class="y-ls"></div><button class="y-pri big" data-y="done">تم</button>`, { onMount: draw, label: 'اللغات' });
    },
    lang(key, btn) {
      const i = key.indexOf('|'), p = key.slice(0, i), t = key.slice(i + 1); const s = S.langs[p];
      if (s.has(t)) s.delete(t); else s.add(t);
      pref.langs[p] = [...s]; savePref();
      const on = s.has(t); const ck = btn.querySelector('.y-ck'); ck.classList.toggle('on', on); ck.innerHTML = on ? g('check', 18) : '';
      if (on && !RM) { const pth = ck.querySelector('path'); const L = pth?.getTotalLength?.() || 20; pth?.animate?.([{ strokeDasharray: L, strokeDashoffset: L }, { strokeDasharray: L, strokeDashoffset: 0 }], { duration: M.enter, easing: EASE }); ck.animate?.([{ transform: 'scale(.8)' }, { transform: 'scale(1.08)', offset: 0.6 }, { transform: 'none' }], { duration: M.press, easing: EASE }); }
      sheetEl.querySelector('[data-y-cnt]').textContent = s.size ? `${s.size} مختارة` : 'كل اللغات'; setScroll(0); render({ flip: false });
    },
    done: () => dismiss(),
    search() { if (S.searching) return; S.searching = true; render({ flip: false }); },
    closeSearch() { if (S.searching) back(); },
    removePhoto() { if (!sheetEl) return; sheetEl.repoImage = ''; refreshPhoto(sheetEl); },
    addRepo(p) { openRepoAdd(p); },
    raPaste() { const el = sheetEl; const inp = el?.querySelector('[data-y="raUrl"]'); if (!inp) return; (navigator.clipboard?.readText?.() || Promise.reject()).then((t) => { inp.value = (t || '').trim(); raCheck(el); }).catch(() => { inp.focus(); toast('الصق الرابط يدويًا'); }); },
    raRetry() { if (sheetEl) raCheck(sheetEl); },
    raOpen(key) { const i = key.indexOf('|'), p = key.slice(0, i), id = key.slice(i + 1); S.tab[p] = 'avail'; S.repoFilter[p] = id; dismiss(); if (cur().v !== p) go({ v: p }); else render({ flip: false }); },
    async raAdd(p, btn) {
      const el = sheetEl, d = el?.raData; if (!d || el.dataset.saving === '1') return;
      const nick = el.querySelector('[data-y="raNick"]').value.trim() || d.name; const image = el.raImage || d.image || '';
      el.dataset.saving = '1'; btn.disabled = true; btn.innerHTML = `<span class="y-spin" style="display:grid">${g('spin', 20)}</span>`;
      try {
        const out = await API[p].add(d.url);
        const url = httpUrl(out?.repo?.url) || d.url;
        pref.repoMeta[url] = { name: nick.slice(0, 40), image: image !== ghAvatar(d.url) ? image : '' }; savePref();
        if (sheetEl !== el) return;
        dismiss(); S.tab[p] = 'avail'; S.repoFilter[p] = url;
        sourcesChanged({ preserveAddonsView: true, reason: 'repo-add' });
        await readNative(p, gen); toast(`أُضيف ${nick} · ${d.n}`);
      } catch (e) { if (sheetEl === el) { el.dataset.saving = '0'; btn.disabled = false; btn.innerHTML = `${g('plus', 20)}أضف`; el.querySelector('.y-ra-msg').innerHTML = esc(fmtErr(e)); el.querySelector('.y-ra-msg').dataset.kind = 'err'; } }
    },
    updSheet() {
      const groups = PROVS.map((p) => [p, S.items[p].filter((x) => x.nv)]).filter(([, a]) => a.length); if (!groups.length) { toast('كل الإضافات محدّثة'); return; }
      const n = groups.reduce((s, [, a]) => s + a.length, 0);
      sheet(`<div class="y-ttl">التحديثات<span>${n}</span></div><div>${groups.map(([p, a]) => `<div class="y-up-h">${logo(p, PROV[p].name)}<span>${PROV[p].name}</span></div>${a.map((it) => `<div class="y-up-row" data-k="u-${p}-${esc(it.id)}">${itLogo(it)}<div class="y-tx"><div class="y-nm">${esc(it.name)}</div><div class="y-mt"><span class="y-up"><bdi>${esc(it.ver)}</bdi> ← <bdi>${esc(it.nv)}</bdi></span></div></div><span class="y-prog"><i style="width:0"></i></span></div>`).join('')}`).join('')}</div><button class="y-pri big" data-y="updEverything">${g('update', 20)}حدّث الكل</button>`, { label: 'التحديثات' });
    },
    async updEverything(_, btn) {
      if (btn) btn.disabled = true; const el = sheetEl;
      for (const [p, it] of PROVS.flatMap((p) => S.items[p].filter((x) => x.nv && !S.busy[x.id]).map((x) => [p, x]))) {
        const r = el?.querySelector(`[data-k="u-${p}-${cssEsc(it.id)}"]`); r?.querySelector('.y-prog')?.classList.add('ind');
        await A.update(`${p}|${it.id}`);
        if (r) { r.querySelector('.y-prog')?.classList.remove('ind'); if (!S.items[p].find((x) => x.id === it.id)?.nv) { r.classList.add('done'); r.querySelector('.y-up').textContent = 'محدّثة'; } }
      }
      setTimeout(() => { if (sheetEl === el) dismiss(); }, 450);
    },
    editRepo(key) { const [p, i] = key.split('|'); const r = S.repos[p][+i]; if (r) openRepoEditor(p, r); },
    repoSave(key) {
      const el = sheetEl; if (!el || el.dataset.imageBusy === '1') return;
      const i = key.indexOf('|'), p = key.slice(0, i), url = key.slice(i + 1); const r = S.repos[p].find((x) => x.id === url); if (!r) return;
      const name = el.querySelector('[data-y="repoName"]').value.trim() || r.name;
      pref.repoMeta[url] = { name: name.slice(0, 80), image: el.repoImage || '' }; const stored = savePref();
      r.name = pref.repoMeta[url].name; r.image = el.repoImage || ghAvatar(url);
      dismiss(); render({ flip: false }); toast(stored ? 'تم حفظ المستودع' : 'حُفظ لهذه الجلسة فقط');
    },
    repoMenu(key) {
      const [p, i] = key.split('|'); const r = S.repos[p][+i]; if (!r) return;
      sheet(`<div class="y-prev">${repoLogo(r, 'xl')}<div class="y-tx"><div class="y-nm">${esc(r.name)}</div><div class="y-mt" style="direction:ltr;justify-content:flex-end">${esc(r.url.replace(/^https?:\/\//, ''))}</div></div></div><div class="y-menu"><button data-y="editRepo" data-id="${esc(key)}">${g('sliders')}تعديل اللقب والصورة</button><button data-y="copyRaw" data-id="${esc(r.url)}">${g('copy')}انسخ الرابط</button><button class="red" data-y="repoDel" data-id="${esc(key)}">${g('trash')}أزل المستودع</button></div>`);
    },
    async repoDel(key, btn) {
      const [p, i] = key.split('|'); const r = S.repos[p][+i]; if (!r) return;
      if (btn) btn.disabled = true;
      try { await API[p].remove(r.url); } catch (e) { toast(fmtErr(e)); if (btn) btn.disabled = false; return; }
      delete pref.repoMeta[r.url]; savePref(); dismiss();
      sourcesChanged({ preserveAddonsView: true, reason: 'repo-remove' });
      await readNative(p, gen); toast('أُزيل المستودع؛ الإضافات المثبتة باقية');
    },
    itemMenu(key) {
      const [p, , it] = find(key); if (!it) return;
      const st = p === 'stremio', raw = it.raw || {};
      const extra = [
        it.site ? `<button data-y="site" data-id="${esc(key)}">${g('site')}افتح الموقع الأصلي</button>` : '',
        copyUrl(p, it) ? `<button data-y="copy" data-id="${esc(key)}">${g('copy')}انسخ الرابط</button>` : '',
        p === 'cloudstream' && !it.pending ? `<button data-y="reinstallAs" data-id="${esc(key)}">${g('update')}${it.content === 'cinema' ? 'انقلها إلى الأنمي' : 'انقلها إلى السينما'}</button>` : '',
        st && raw.previousVersion && registry.rollback ? `<button data-y="rollback" data-id="${esc(key)}">${g('retry')}ارجع للإصدار ${esc(raw.previousVersion)}</button>` : '',
        !st && typeof API[p]?.rollback === 'function' ? `<button data-y="rollback" data-id="${esc(key)}">${g('retry')}ارجع للإصدار السابق</button>` : '',
        st && registry.stage ? `<button data-y="checkUpdate" data-id="${esc(key)}">${g('update')}افحص التحديث</button>` : '',
      ].join('');
      const ord = canOrder(p) ? `${it.pin && S.items[p].indexOf(it) === 0 ? '' : `<button data-y="toFirst" data-id="${esc(key)}">${g('pinOn')}اجعلها الأولى</button>`}<button data-y="toTop" data-id="${esc(key)}">${g('up')}للأعلى</button><button data-y="toBottom" data-id="${esc(key)}">${g('downMove')}للأسفل</button>` : '';
      sheet(`<div class="y-prev">${itLogo(it, 'xl')}<div class="y-tx"><div class="y-nm">${esc(it.name)}</div><div class="y-mt">${esc(st ? (TYPE[it.type] || '') + (it.ver ? ' · ' + it.ver : '') : repoName(p, it))}</div></div></div><div class="y-menu">${ord}${extra}<button class="red" data-y="askDel" data-id="${esc(key)}">${g('trash')}احذف</button></div>`);
    },
    async reinstallAs(key) { const [p, , it] = find(key); if (!it) return; dismiss(); const to = it.content === 'cinema' ? 'anime' : 'cinema'; if (await run(it.id, 'install', () => installNative(p, { ...it, content: to }, to))) toast(to === 'cinema' ? 'صارت في السينما' : 'صارت في الأنمي'); },
    async rollback(key) {
      const [p, , it] = find(key); if (!it) return; dismiss();
      await run(it.id, 'update', async () => {
        if (p === 'stremio') { await registry.rollback(it.id); readStremio(); }
        else { const r = await API[p].rollback(it.pkg); toast(`رجعنا إلى ${r?.version ?? 'الإصدار السابق'}`); await readNative(p, gen); }
        sourcesChanged({ preserveAddonsView: true });
      });
    },
    async checkUpdate(key) {
      const [, , it] = find(key); if (!it) return; dismiss();
      await run(it.id, 'update', async () => {
        const r = await registry.stage(it.id); readStremio();
        toast(r?.refused === 'DOWNGRADE_REFUSED' ? `المستودع يعرض إصدارًا أقدم (${String(r.version ?? '').slice(0, 40)})؛ رُفض حفاظًا على أمانك.` : r?.changed ? 'يوجد تحديث جاهز' : 'الإضافة محدّثة');
      });
    },
    copy(key) { const [p, , it] = find(key); const u = it && copyUrl(p, it); if (!u) { toast('لا يوجد رابط متاح'); return; } A.copyRaw(u); },
    async copyRaw(u) { try { await navigator.clipboard.writeText(u); dismiss(); toast('نُسخ الرابط'); } catch { toast('تعذّر النسخ'); } },
    askDel(key) {
      const [, , it] = find(key); if (!it) return;
      sheet(`<div class="y-prev">${itLogo(it, 'xl')}<div class="y-tx"><div class="y-nm">حذف ${esc(it.name)}؟</div><div class="y-mt">${it.pending ? 'يُزال اختيارها من حسابك؛ مكتبتك وتقدّمك باقيان' : 'تقدر تثبّتها من جديد؛ مكتبتك وتقدّمك باقيان'}</div></div></div><div class="y-btns"><button class="y-sec" data-y="done">إلغاء</button><button class="y-pri big y-danger" data-y="del" data-id="${esc(key)}">احذف</button></div>`);
    },
    async del(key, btn) {
      const [p, id, it] = find(key); if (!it) return;
      if (btn) btn.disabled = true;
      try {
        if (p === 'stremio') await registry.remove(id);
        else if (it.isSite) await sites.remove(it.raw.id);
        else await API[p].uninstall(it.pkg);
      } catch (e) { toast(fmtErr(e)); if (btn) btn.disabled = false; return; }
      sourcesChanged({ preserveAddonsView: true, reason: 'remove' });
      if (cur().v === 'details') afterSheetClose = () => back();
      dismiss();
      if (p === 'stremio') readStremio(); else { installed[p] = (installed[p] || []).filter((x) => nativePackage(x) !== it.pkg); pending[p] = (pending[p] || []).filter((x) => nativePackage(x) !== it.pkg); if (it.isSite) siteRows = siteRows.filter((s) => s !== it.raw); rebuild(p); }
      setTimeout(() => { render(); toast(`حُذفت ${it.name}`); }, 120);
      if (p !== 'stremio') void readNative(p, gen);
    },
    guard() {
      sheet(`<div class="y-ttl">تحديات الحماية<span>${S.challenges.length}</span></div><p class="y-source-note">أكمل التحقق في صفحة الموقع. قد يطلب الموقع التحقق من جديد بعد انتهاء الجلسة.</p><div data-guard-list>${guardRows()}</div><button class="y-pri big" data-y="done">تم</button>`, { label: 'تحديات الحماية' });
    },
    verify(host, btn) { void verifyHost(host, btn); },
    hubMenu() {
      sheet(`<div class="y-ttl">نقل الإضافات</div><div class="y-menu"><button data-y="exportAll">${g('share')}صدّر إضافاتي إلى ملف</button><label class="y-menu-file"><input class="y-file" type="file" accept=".json,application/json" data-y="importFile" hidden>${g('file')}استورد ملف «إضافاتي»</label></div>`, { label: 'نقل الإضافات' });
    },
    exportAll() { void showExport(); },
    async saveExport() {
      const el = sheetEl, text = el?.exportText; if (!text) return; const name = transferFileName();
      try {
        const native = globalThis.Capacitor?.Plugins?.SystemUi;
        if (globalThis.Capacitor?.getPlatform?.() === 'android' && native?.shareFile) await native.shareFile({ name, text, mime: 'application/json', title: 'إضافاتي من فانتارا' });
        else { const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })); const a = doc.createElement('a'); a.href = url; a.download = name; doc.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30_000); }
        toast('جاهز. افتح الملف على جهازك الآخر من «نقل الإضافات».');
      } catch (e) { toast(fmtErr(e)); }
    },
    async copyExport() { try { await navigator.clipboard.writeText(sheetEl?.exportText || ''); toast('نُسخ'); } catch { toast('تعذّر النسخ هنا؛ احفظ الملف بدلًا منه.'); } },
    importOne(key) { const el = sheetEl; const t = el?.importItems?.find((i) => i.key === key); if (t) void importInstall(el, [t]); },
    importAll() { const el = sheetEl; if (el) void importInstall(el, el.importItems); },
  };

  // ── الالتقاط: نقرة، كتابة، إرسال، ضغط ──
  function onClick(e) {
    if (performance.now() < suppressClickUntil && e.target.closest?.('.y-order-list')) { e.preventDefault(); e.stopPropagation(); return; }
    const t = e.target.closest?.('[data-y]');
    if (!t) return;
    const a = t.dataset.y;
    if (a === 'scrim') { if (e.target === t) dismiss(); return; }
    if (['url', 'q', 'repoName', 'repoFile', 'addForm', 'raUrl', 'raNick', 'raFile', 'importFile', 'grip'].includes(a)) return;
    if (!A[a]) return;
    e.preventDefault(); e.stopPropagation();
    A[a](t.dataset.id, t);
  }
  function onInput(e) {
    const a = e.target.dataset?.y;
    if (a === 'q') { S.q = e.target.value; if (available) setScroll(0); render({ flip: false }); }
    if (a === 'raNick') e.target.dataset.touched = '1';
    if (a === 'raUrl' && sheetEl) { clearTimeout(sheetEl.raT); sheetEl.raT = setTimeout(() => raCheck(sheetEl), 400); }
    if (a === 'url') { S.url = e.target.value; e.target.classList.toggle('ltr', !!S.url); const b = content.querySelector('.y-add .y-pri'); if (b) b.disabled = !validUrl(S.url); }
  }
  async function onSubmit(e) {
    if (e.target.dataset?.y !== 'addForm') return; e.preventDefault();
    const u = S.url.trim(); if (!validUrl(u) || !registry.inspect) return;
    const btn = content.querySelector('.y-add .y-pri'); btn.disabled = true; btn.innerHTML = `<span class="y-spin" style="display:grid">${g('spin', 20)}</span>`;
    let preview;
    try { preview = await registry.inspect(u); }
    catch (err) { if (alive) { toast(fmtErr(err)); render({ flip: false }); btn.disabled = !validUrl(S.url); btn.textContent = 'تثبيت الإضافة'; } return; }
    if (!alive || cur().v !== 'stremio') return;
    btn.disabled = false; btn.textContent = 'تثبيت الإضافة';
    const m = preview?.manifest || {}; const a = { ...m, capabilities: m.capabilities || [] };
    if (S.items.stremio.some((x) => x.id === m.key)) { toast(`${m.name} مثبتة مسبقًا`); return; }
    const conts = [...new Set((m.contentTypes || []).map((t) => CONTENT_AR[t]).filter(Boolean))].join(' · ') || '—';
    const el = sheet(`<div class="y-prev">${logo(null, m.name, 'xl', [httpUrl(m.logo)].filter(Boolean))}<div class="y-tx"><div class="y-nm">${esc(m.name || 'إضافة')}</div><div class="y-mt">الإصدار ${esc(m.version || '—')}${m.configuration?.configurable ? ' · قابلة للضبط' : ''}</div></div></div><div class="y-kv" style="margin:0;background:var(--surface-2)"><div><span>تقدّم</span><b>${TYPE[remoteType(a)]}</b></div><div><span>المحتوى</span><b>${esc(conts)}</b></div></div><div class="y-btns"><button class="y-sec" data-y="done">إلغاء</button><button class="y-pri big" data-y="confirmAdd">تثبيت</button></div>`, { label: 'تثبيت إضافة' });
    el.preview = preview;
  }
  A.confirmAdd = async (_, btn) => {
    const el = sheetEl; if (!el?.preview) return;
    btn.disabled = true; btn.innerHTML = `<span class="y-spin" style="display:grid">${g('spin', 20)}</span>`;
    try {
      const out = await registry.install(el.preview);
      const id = out?.manifest?.key || el.preview?.manifest?.key;
      S.url = ''; const input = content.querySelector('[data-y="url"]'); if (input) input.value = '';
      dismiss(); readStremio(); sourcesChanged({ preserveAddonsView: true, reason: 'addon-install' });
      setTimeout(() => { render(); toast(`${el.preview?.manifest?.name || 'الإضافة'} مثبتة`); content.querySelector(`[data-k="st-${cssEsc(id)}"]`)?.scrollIntoView?.({ block: 'center', behavior: RM ? 'auto' : 'smooth' }); }, 80);
    } catch (e) { btn.disabled = false; btn.textContent = 'تثبيت'; toast(fmtErr(e)); }
  };
  async function onChange(e) {
    const t = e.target;
    if (t.matches?.('[data-y="raFile"]')) { const el = sheetEl; try { el.raImage = await readPhoto(t.files?.[0], 256); const img = el.querySelector('.y-ra-img img'); img.src = el.raImage; img.hidden = false; el.querySelector('.y-ra-img b').hidden = true; } catch { toast('تعذّر قراءة الصورة'); } finally { t.value = ''; } }
    if (t.matches?.('[data-y="repoFile"]')) { const el = sheetEl; el.dataset.imageBusy = '1'; repoError(el, ''); try { el.repoImage = await readPhoto(t.files?.[0], 384); refreshPhoto(el); } catch { repoError(el, 'تعذّر قراءة الصورة. اختر PNG أو JPEG أو WebP بحجم أقل من 20MB.'); } finally { el.dataset.imageBusy = '0'; t.value = ''; } }
    if (t.matches?.('[data-y="importFile"]')) {
      const f = t.files?.[0]; t.value = ''; if (!f) return;
      try { const d = extensionsFromFile(await f.text()); if (!d) throw new Error('هذا ليس ملف «إضافاتي» من فانتارا.'); showImport(d); } catch (err) { toast(fmtErr(err)); }
    }
  }
  function onImgLoad(e) {
    const img = e.target, box = img?.closest?.('[data-logo]');
    if (box && img.naturalWidth > 0) box.dataset.loaded = '';
  }
  function onImgError(e) {
    const img = e.target, box = img?.closest?.('[data-logo]');
    if (!box) return;
    delete box.dataset.loaded;
    const candidates = JSON.parse(box.dataset.logo), next = Number(img.dataset.candidate ?? 0) + 1;
    if (candidates[next]) { img.dataset.candidate = next; img.src = candidates[next]; }
    else img.remove();
  }
  // ── الضغط: تصغير خفيف ثم ارتداد ──
  const PRESS = '.y-stat-btn.has,.y-ra-paste,.y-ib,.y-pri,.y-sec,.y-get,.y-chip,.y-act,.y-prov,.y-del,.y-tab,.y-lang,.y-ch-btn,.y-menu>button,.y-ls>button,.y-row[data-y="open"]';
  let pressed = null;
  const depth = (el) => (el.matches('.y-prov,.y-row,.y-menu>button,.y-ls>button,.y-del') ? 0.975 : 0.92);
  function pressDown(e) {
    if (RM || e.button > 0) return; const el = e.target.closest?.(PRESS); if (!el || el.closest('[disabled]') || e.target.closest('input') || !el.animate) return;
    const inner = e.target.closest('.y-ib,.y-get,.y-sw'); const t = inner && el !== inner && el.contains(inner) ? inner : el;
    pressed = { el: t, s: depth(t), x: e.clientX, y: e.clientY };
    pressed.a = t.animate([{ transform: 'none' }, { transform: `scale(${pressed.s})` }], { duration: 90, easing: EASE, fill: 'forwards' });
  }
  function pressUp() {
    if (!pressed) return; const { el, s, a } = pressed; pressed = null; a.cancel();
    el.animate([{ transform: `scale(${s})` }, { transform: `scale(${1 + (1 - s) * 0.3})`, offset: 0.55 }, { transform: 'none' }], { duration: M.press, easing: 'ease-out' });
  }
  function pressMove(e) { if (pressed && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 10) { pressed.a.cancel(); pressed = null; } }
  // ── السحب للترتيب (التصور v1.2.6): داخل مجموعة واحدة (المفضّلة أو البقية)، رأسيًا. المقبض في Stremio يبدأ فورًا،
  // وضغطة مطوّلة على أي صف في البقية. الحركة كلها transform على الصف المسحوب وجيرانه فقط.
  const feedback = () => { try { navigator.vibrate?.(12); } catch {} };
  function layoutRect(el) { const r = el.getBoundingClientRect(), tr = win.getComputedStyle(el).transform; let x = 0, y = 0; if (tr && tr !== 'none') { const m = new DOMMatrixReadOnly(tr); x = m.m41; y = m.m42; } return { left: r.left - x, top: r.top - y, right: r.right - x, bottom: r.bottom - y, width: r.width, height: r.height }; }
  function clearHold() { if (hold) { clearTimeout(hold.timer); hold = null; } }
  function beginHold(target, x, y, id, kind) {
    if (drag || hold || sheetEl) return;
    const card = target.closest?.('.y-order-list[data-list="installed"]>[data-id]');
    if (!card || (!target.closest('.y-grip') && target.closest('button:not(.y-ext-info),input'))) return;
    const grid = card.parentElement; if (grid.children.length < 2 || !canOrder(grid.dataset.order)) return;
    hold = { card, grid, id, kind, x, y, timer: null };
    if (target.closest('.y-grip')) startDrag(); else hold.timer = setTimeout(startDrag, 320);
  }
  function startDrag() {
    if (!hold) return; const h = hold; clearHold(); const { card, grid } = h; if (!card.isConnected) return;
    if (pressed) { pressed.a.cancel(); pressed = null; }
    for (const el of grid.children) el.getAnimations?.().forEach((a) => a.cancel());
    const r = layoutRect(card);
    drag = { ...h, order: [...grid.children], offsetY: h.y - r.top, raf: 0 };
    card.classList.add('drag'); grid.classList.add('is-sorting'); feedback();
    if (h.kind === 'mouse') try { grid.setPointerCapture(h.id); } catch {}
    const loop = () => {
      if (!drag) return; const d = drag, top = 96, bottom = (win.innerHeight || 800) - 64;
      const dy = d.y < top ? -Math.min(12, (top - d.y) / 7) : d.y > bottom ? Math.min(12, (d.y - bottom) / 7) : 0;
      const bounds = d.grid.getBoundingClientRect();
      if (dy && ((dy < 0 && bounds.top < top) || (dy > 0 && bounds.bottom > bottom))) { const s = scroller(); if (s) s.scrollTop += dy; else win.scrollBy(0, dy); moveDrag(); }
      d.raf = requestAnimationFrame(loop);
    };
    drag.raf = requestAnimationFrame(loop);
  }
  function moveDrag() {
    const d = drag; if (!d) return; const { card, grid } = d;
    const bounds = grid.getBoundingClientRect(), r = layoutRect(card);
    const clamp = (v, min, max) => Math.min(Math.max(v, min), Math.max(min, max));
    const rawTop = d.y - d.offsetY, top = clamp(rawTop, bounds.top, bounds.bottom - r.height), cy = rawTop + r.height / 2;
    const order = [...grid.children], index = order.indexOf(card), others = order.filter((x) => x !== card);
    let target = null, dist = Infinity;
    for (const el of others) { const b = layoutRect(el); const delta = cy - (b.top + b.height / 2), before = order.indexOf(el) < index; if ((before && delta <= -3) || (!before && delta >= 3)) { const score = Math.abs(delta); if (score < dist) { target = el; dist = score; } } }
    if (target) {
      const before = order.indexOf(target) < index; const old = new Map(others.map((x) => [x, x.getBoundingClientRect()]));
      others.forEach((x) => x.getAnimations?.().forEach((a) => a.cancel()));
      grid.insertBefore(card, before ? target : target.nextSibling);
      if (!RM) others.forEach((x) => { const a = old.get(x), b = layoutRect(x); if (Math.abs(a.top - b.top) + Math.abs(a.left - b.left) > 1) x.animate([{ transform: `translateY(${a.top - b.top}px)` }, { transform: 'none' }], { duration: 150, easing: EASE }); });
    }
    const b = layoutRect(card); card.style.transform = `translateY(${top - b.top}px)`;
  }
  function moveHold(x, y, id) { if (hold && hold.id === id && Math.hypot(x - hold.x, y - hold.y) > 9) clearHold(); if (drag && drag.id === id) { drag.x = x; drag.y = y; moveDrag(); } }
  function finishDrag(id, cancel = false) {
    if (hold && hold.id === id) clearHold(); if (!drag || drag.id !== id) return;
    const d = drag, { card, grid } = d; drag = null; cancelAnimationFrame(d.raf); suppressClickUntil = performance.now() + 400;
    if (d.kind === 'mouse' && grid.hasPointerCapture?.(id)) grid.releasePointerCapture(id);
    const previous = card.getBoundingClientRect();
    [...grid.children].forEach((x) => x.getAnimations?.().forEach((a) => a.cancel()));
    card.style.transform = ''; card.classList.remove('drag'); grid.classList.remove('is-sorting');
    let moved = false;
    if (cancel) d.order.forEach((x) => grid.append(x));
    else {
      const p = grid.dataset.order, ids = [...grid.children].map((x) => x.dataset.id), a = S.items[p], set = new Set(ids), shown = new Map(a.filter((x) => set.has(x.id)).map((x) => [x.id, x]));
      let i = 0; S.items[p] = pinFirst(a.map((x) => (set.has(x.id) ? shown.get(ids[i++]) : x)));
      moved = ids.join() !== d.order.map((x) => x.dataset.id).join();
      if (moved) { feedback(); void persistOrder(p); }
    }
    const r = layoutRect(card); if (!RM) card.animate([{ transform: `translateY(${previous.top - r.top}px)` }, { transform: 'none' }], { duration: 160, easing: EASE });
    if (deferredRender || moved) { deferredRender = false; render({ flip: false }); }
  }
  const dDown = (e) => { if (e.pointerType === 'touch' || e.button !== 0) return; beginHold(e.target, e.clientX, e.clientY, e.pointerId, 'mouse'); };
  const dMove = (e) => { if (e.pointerType === 'touch') return; moveHold(e.clientX, e.clientY, e.pointerId); };
  const dUp = (e) => { if (e.pointerType === 'touch') return; finishDrag(e.pointerId, e.type !== 'pointerup'); };
  const tStart = (e) => { if (e.touches.length !== 1) { clearHold(); if (drag) finishDrag(drag.id, true); return; } const tc = e.changedTouches[0]; beginHold(e.target, tc.clientX, tc.clientY, tc.identifier, 'touch'); };
  const tMove = (e) => { const tc = [...e.changedTouches].find((x) => x.identifier === (drag?.id ?? hold?.id)); if (!tc) return; if (drag && e.cancelable) e.preventDefault(); moveHold(tc.clientX, tc.clientY, tc.identifier); };
  const tEnd = (e) => { for (const tc of e.changedTouches) { if (drag?.id === tc.identifier && e.cancelable) e.preventDefault(); finishDrag(tc.identifier, e.type === 'touchcancel'); } };
  root.addEventListener('pointerdown', dDown); root.addEventListener('pointermove', dMove); root.addEventListener('pointerup', dUp); root.addEventListener('pointercancel', dUp); root.addEventListener('lostpointercapture', dUp);
  root.addEventListener('touchstart', tStart, { passive: true }); root.addEventListener('touchmove', tMove, { passive: false }); root.addEventListener('touchend', tEnd, { passive: false }); root.addEventListener('touchcancel', tEnd, { passive: false });
  root.addEventListener('contextmenu', (e) => { if (e.target.closest?.('.y-order-list')) e.preventDefault(); });
  // سحب مقبض الورقة لتحت يقفلها
  let grabD = null;
  function grabDown(e) { const gb = e.target.closest?.('.y-sheet .y-grab'); if (!gb || !sheetEl) return; const pan = gb.closest('.y-pan'); grabD = { pan, y: e.clientY, t: performance.now(), dy: 0, id: e.pointerId }; try { gb.setPointerCapture(e.pointerId); } catch {} pan.getAnimations?.().forEach((a) => a.cancel()); }
  function grabMove(e) { if (!grabD || e.pointerId !== grabD.id) return; grabD.dy = Math.max(0, e.clientY - grabD.y); grabD.pan.style.transform = `translateY(${grabD.dy}px)`; }
  function grabEnd(e) {
    if (!grabD || e.pointerId !== grabD.id) return; const g0 = grabD; grabD = null; const v = g0.dy / Math.max(1, performance.now() - g0.t);
    if (g0.dy > 90 || v > 0.6) { const el = sheetEl; if (el) el.dataset.dragged = '1'; g0.pan.animate([{ transform: `translateY(${g0.dy}px)` }, { transform: 'translateY(100%)' }], { duration: M.sheetOut, easing: EIN, fill: 'forwards' }); el?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: M.sheetOut, fill: 'forwards' }).finished.then(() => dismiss()).catch(() => dismiss()); }
    else { g0.pan.animate([{ transform: `translateY(${g0.dy}px)` }, { transform: 'none' }], { duration: M.enter, easing: SPRING }); g0.pan.style.transform = ''; }
  }
  function onKey(e) {
    if (e.key === 'Enter' && e.target.dataset?.y === 'raUrl') { e.preventDefault(); const b = sheetEl?.querySelector('[data-y="raAdd"]'); if (b && !b.disabled) b.click(); else if (sheetEl) raCheck(sheetEl); return; }
    if (e.key === 'Escape' && (sheetEl || S.searching)) { e.preventDefault(); back(); }
    if (e.key === 'Enter' && e.target.matches?.('.y-stat-btn.has')) A.updSheet();
  }
  function onResize() {
    const n = (win.innerWidth || 0) >= 1000;
    if (n !== D) { D = n; injectCss(); closeSheet(true); renderedView = ''; render({ flip: false }); }
    else placeInd();
    scheduleAvailable();
    scheduleSheetViewport();
  }
  for (const node of [root, layer]) {
    node.addEventListener('click', onClick, true);
    node.addEventListener('input', onInput);
    node.addEventListener('change', onChange);
    node.addEventListener('submit', onSubmit, true);
    node.addEventListener('pointerdown', pressDown, true);
    node.addEventListener('pointerup', pressUp, true);
    node.addEventListener('pointercancel', pressUp, true);
    node.addEventListener('pointermove', pressMove, { passive: true });
    node.addEventListener('load', onImgLoad, true);
    node.addEventListener('error', onImgError, true);
    node.addEventListener('keydown', onKey);
  }
  layer.addEventListener('pointerdown', grabDown, true);
  layer.addEventListener('pointermove', grabMove);
  layer.addEventListener('pointerup', grabEnd);
  layer.addEventListener('pointercancel', grabEnd);
  win.addEventListener?.('resize', onResize);
  win.addEventListener?.('scroll', scheduleAvailable, { capture: true, passive: true });
  const removeVerification = verification?.subscribe?.(receiveChallenges) || (() => {});
  try { const saved = verification?.list?.(); if (saved?.then) saved.then(receiveChallenges).catch(() => {}); else if (saved) receiveChallenges(saved); } catch {}
  const removePulse = pulse?.onChange?.(() => { if (API.stremio) readStremio(); scheduleRender(); }) || (() => {});
  win.visualViewport?.addEventListener('resize', scheduleSheetViewport);
  root.addEventListener('addon-configured', () => { if (!alive) return; readStremio(); render(); sourcesChanged({ preserveAddonsView: true }); });

  // ── عقد القشرة: back/snapshot/close/reload ──
  root.back = back;
  root.snapshot = () => ({ stack: S.stack.map((c) => ({ v: c.v, p: c.p, id: c.id })), tab: { ...S.tab }, scrollY: getScroll() });
  root.close = () => {
    alive = false; gen++; removeVerification(); removePulse(); clearTimeout(toastT);
    win.removeEventListener?.('scroll', scheduleAvailable, true);
    if (availableFrame != null) win.cancelAnimationFrame?.(availableFrame);
    win.removeEventListener?.('resize', onResize); win.visualViewport?.removeEventListener('resize', scheduleSheetViewport);
    closeSheet(true); layer.remove();
    if (bar) { bar.classList.remove('y-bar'); if (barStyle == null) bar.removeAttribute('style'); else bar.setAttribute('style', barStyle); bar.inert = false; bar.querySelector('.y-bar-q')?.remove(); bar.removeEventListener('input', onInput); }
    if (titleEl) titleEl.hidden = false;
    if (toolsEl) { toolsEl.removeEventListener('click', onClick, true); toolsEl.classList.remove('y-bar-tools'); toolsEl.innerHTML = ''; }
    backBtn?.classList.remove('y-back-fixed');
  };
  root.reload = () => { void refresh(); };
  root.hub = { S, A, render, refresh };
  render({ flip: false });
  // المستدعي يُلحق الجذر بالصفحة متزامنًا بعد الرجوع: الربط في المهمة الدقيقة نفسها، فلا إطار بشريط غير منسّق ولا سباق مؤقت
  queueMicrotask(attachBar);
  void refresh().then(() => { if (alive && Number.isFinite(initialState.scrollY)) setScroll(initialState.scrollY); });
  return root;
}

// ── الأنماط: نص التصور المعتمد كما هو (حد واحد)، ثم تعديلات المالك ──
function css(D, innerWidth) {
  const sz = (d, m) => (D ? d : m);
  return `
.y{color:var(--text-1);padding-bottom:96px;-webkit-tap-highlight-color:transparent}
.y button,.y-sheet button,.y-bar button{font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer;-webkit-tap-highlight-color:transparent;text-align:inherit}
.y .y-lg,.y-sheet .y-lg{width:${sz(52, 48)}px;height:${sz(52, 48)}px;border-radius:${sz(14, 13)}px;flex:none;overflow:hidden;background:var(--surface-3);display:grid;place-items:center}
.y-lg[data-logo]{position:relative}
.y-lg[data-logo]>img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;visibility:hidden}
.y-lg[data-loaded]>img{visibility:visible}
.y-lg[data-loaded]>b{visibility:hidden}
.y-lg b{font-size:${sz(21, 19)}px;font-weight:700;color:var(--text-1)}
.y-lg.y-mk{background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line-strong);color:var(--text-1)}
.y .y-lg.xl,.y-sheet .y-lg.xl{width:${sz(72, 64)}px;height:${sz(72, 64)}px;border-radius:${sz(20, 18)}px}
.y .y-lg.xxl{width:${sz(96, 88)}px;height:${sz(96, 88)}px;border-radius:${sz(26, 24)}px}
.y-tx{flex:1;min-width:0}
.y-nm{font-size:${sz(19, 18)}px;font-weight:700;line-height:1.3;color:var(--text-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.y-mt{font-size:${sz(15.5, 15)}px;color:var(--text-3);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:8px}
.y-dot{width:7px;height:7px;border-radius:50%;background:var(--text-1);flex:none}
.y-up{color:var(--text-1);font-weight:600}
.y-bad{color:var(--danger);font-weight:600}
.y-ib{width:${sz(52, 48)}px;height:${sz(52, 48)}px;display:grid!important;place-items:center;color:var(--text-1)!important;flex:none;border-radius:16px;transition:background-color .15s,color .2s}
.y-ib.on{color:var(--accent)!important}
.y-ib.dim{color:var(--text-2)!important}
@media (hover:hover){.y-ib:hover{background:var(--surface-2)}}
.y-spin{animation:y-rot .8s linear infinite}
@keyframes y-rot{to{transform:rotate(-360deg)}}
.y-tools{display:flex;align-items:center;gap:12px;margin-bottom:${sz(20, 16)}px}
.y-lang{height:${sz(48, 46)}px;padding:0 ${sz('16px 0 20px', '14px 0 18px')}!important;border-radius:24px;background:var(--surface-1)!important;display:inline-flex!important;align-items:center;gap:10px;font-size:${sz(16.5, 16)}px!important;font-weight:700!important;color:var(--text-1)!important;max-width:70%}
.y-lang span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.y-lang i{font-style:normal;font-weight:600;color:var(--text-3)}
.y-head{display:grid;grid-template-columns:auto minmax(0,1fr);gap:${sz(18, 14)}px;align-items:center;margin-bottom:${sz(28, 22)}px}
.y-head .y-nm{font-size:${sz(28, 25)}px}
.y-head .y-mt{font-size:${sz(16, 15)}px}
.y-tabs{position:relative;display:flex;align-items:center;gap:${sz(32, 24)}px;border-bottom:1px solid var(--line-strong);margin-bottom:${sz(22, 18)}px}
.y-tab{height:${sz(54, 50)}px;display:flex!important;align-items:center;gap:8px;font-size:${sz(17, 16.5)}px!important;font-weight:700!important;color:var(--text-3)!important;border-bottom:2px solid transparent!important;margin-bottom:-1px!important;transition:color .15s}
.y-tab.on{color:var(--text-1)!important}
.y-ind{position:absolute;bottom:-1px;left:0;height:2px;border-radius:2px;background:var(--accent);pointer-events:none}
.y-tab i{font-style:normal;font-weight:600;font-size:14.5px;color:var(--text-3)}
.y-pri{height:${sz(44, 42)}px;padding:0 ${sz(20, 18)}px!important;border-radius:${sz(14, 13)}px;background:var(--accent)!important;color:var(--on-accent,#fff)!important;font-size:${sz(16, 15.5)}px!important;font-weight:700!important;display:inline-flex!important;align-items:center;justify-content:center;gap:8px;flex:none;transition:opacity .2s}
.y-pri.big{height:52px;font-size:16.5px!important;border-radius:16px}
.y-pri[disabled]{opacity:.35;pointer-events:none}
.y-sec{height:52px;padding:0 20px!important;border-radius:16px;background:var(--surface-3)!important;color:var(--text-1)!important;font-size:16.5px!important;font-weight:700!important;display:inline-flex!important;align-items:center;justify-content:center}
.y-chips{display:flex;gap:8px;margin-bottom:${sz(20, 16)}px;overflow-x:auto;scrollbar-width:none}
.y-chips::-webkit-scrollbar{display:none}
.y-chip{height:${sz(42, 40)}px;padding:0 ${sz(18, 16)}px!important;border-radius:21px;background:var(--surface-1)!important;font-size:${sz(15.5, 15)}px!important;font-weight:600!important;color:var(--text-2)!important;display:inline-flex!important;align-items:center;white-space:nowrap;flex:none;transition:background-color .15s,color .15s}
.y-chip.on{background:var(--text-1)!important;color:var(--bg)!important}
.y-list{background:var(--surface-1);border-radius:${sz(24, 22)}px;padding:${sz('6px 10px 6px 18px', '4px 6px 4px 14px')};display:grid;grid-template-columns:repeat(${D ? 2 : 1},minmax(0,1fr));column-gap:${sz(36, 0)}px}
.y-row{display:flex;align-items:center;gap:${sz(16, 14)}px;min-height:${sz(80, 74)}px;padding:${sz(12, 10)}px 0;position:relative;border-top:1px solid var(--line)}
.y-list>.y-row:nth-child(-n+${D ? 2 : 1}){border-top:0}
.y-row[data-y="open"]{cursor:pointer}
.y-prog{position:absolute;inset:auto 0 -1px 0;height:2px;background:var(--surface-3);border-radius:2px;overflow:hidden}
.y-prog i{display:block;height:100%;background:var(--accent);transition:width .25s linear}
.y-out{height:40px;padding:0 18px!important;border-radius:12px;border:1.5px solid var(--line-strong)!important;font-size:15px!important;font-weight:700!important;color:var(--text-1)!important;display:inline-flex!important;align-items:center;flex:none}
.y-out.muted{border-color:transparent!important;color:var(--text-3)!important;pointer-events:none}
.y-sw{width:52px;height:32px;border-radius:16px!important;background:var(--text-1)!important;position:relative;flex:none;transition:background-color .2s}
.y-sw{transition:background-color .2s,box-shadow .2s!important}
.y-sw::after{content:"";position:absolute;top:3px;left:3px;width:26px;height:26px;border-radius:13px;background:var(--bg);transition:left 240ms ${SPRING},width 160ms ${EASE},background-color .2s}
.y-sw:active::after{width:33px}
.y-sw.off:active::after{left:16px}
.y-sw.off{background:var(--surface-3)!important;box-shadow:inset 0 0 0 1px var(--line-strong)}
.y-sw.off::after{left:23px;background:var(--text-3)}
.y-grid{display:grid;grid-template-columns:repeat(${innerWidth >= 1700 ? 3 : D ? 2 : 1},minmax(0,1fr));gap:${sz(16, 12)}px}
.y-card{background:var(--surface-1);border-radius:${sz(24, 22)}px;padding:${sz('18px 20px', '16px 16px')};display:grid;gap:${sz(14, 12)}px;position:relative}
.y-card.drag{z-index:5;box-shadow:0 18px 50px rgba(0,0,0,.55),inset 0 0 0 1px var(--line-strong);background:var(--surface-2)}
.y-card .y-r1{display:flex;align-items:center;gap:${sz(14, 12)}px;cursor:pointer}
.y-card .y-r2{display:flex;align-items:center;gap:2px;margin:0 -8px -6px;padding-top:${sz(10, 8)}px;border-top:1px solid var(--line)}
.y-sp{flex:1}
.y-grip{width:28px;align-self:stretch;color:var(--text-3)!important;display:grid!important;place-items:center;flex:none;touch-action:none;cursor:grab;margin-inline-start:-6px}
.y-add{background:var(--surface-1);border-radius:${sz(24, 22)}px;padding:${sz(20, 16)}px;display:grid;gap:12px;margin-bottom:${sz(16, 14)}px}
${D ? '.y-add{grid-template-columns:1fr auto;align-items:center}.y-add .y-pri.big{padding:0 28px!important}' : ''}
.y-in{height:56px;border-radius:16px;background:var(--bg);box-shadow:inset 0 0 0 1px var(--line-strong);display:flex;align-items:center;gap:12px;padding:0 18px;color:var(--text-3);transition:box-shadow .15s}
.y-in:focus-within{box-shadow:inset 0 0 0 1.5px var(--text-2)}
.y-in input{all:unset;flex:1;min-width:0;font-size:16.5px;color:var(--text-1);height:100%}
.y-in input::placeholder{color:var(--text-3)}
.y-in input.ltr{direction:ltr;text-align:left}
.y-sum{font-size:${sz(15.5, 15)}px;color:var(--text-3);margin:0 4px ${sz(22, 18)}px}
.y-prov-main{display:flex!important;align-items:center;gap:14px;min-width:0;flex:1;text-align:start!important}.y-prov-main .y-nm{display:block;text-align:right}.y-prov .y-mt{flex-wrap:wrap;white-space:normal;gap:3px 8px}.y-prov .y-up{font-size:.9em}.y-hub{display:grid;grid-template-columns:repeat(${D ? 2 : 1},minmax(0,1fr));gap:${sz(14, 12)}px}
.y-prov{display:flex;align-items:center;gap:${sz(18, 14)}px;padding:${sz('20px 14px 20px 22px', '16px 8px 16px 16px')};border-radius:${sz(24, 22)}px;background:var(--surface-1);cursor:pointer;transition:background-color .15s}
@media (hover:hover){.y-prov:hover,.y-row[data-y="open"]:hover{background:var(--surface-2)}}
.y .y-prov .y-lg{width:${sz(60, 56)}px;height:${sz(60, 56)}px;border-radius:${sz(17, 16)}px}
.y-prov .y-nm{font-size:${sz(21, 19.5)}px}
.y-sheet{position:fixed;inset:0;z-index:2000;display:flex;align-items:${D ? 'center' : 'flex-end'};justify-content:center;background:rgba(0,0,0,.62);color:var(--text-1);font-family:inherit}
.y-pan{width:${D ? '520px' : '100%'};max-height:88vh;overflow:auto;background:var(--surface-1);border-radius:${D ? '28px' : '28px 28px 0 0'};padding:${sz('26px', '12px 18px calc(28px + env(safe-area-inset-bottom))')};display:grid;gap:16px;box-sizing:border-box}
.y-grab{width:40px;height:4px;border-radius:2px;background:var(--line-strong);margin:2px auto 6px}
.y-prev{display:flex;align-items:center;gap:16px}
.y-prev .y-nm{font-size:23px}
.y-btns{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.y-ttl{display:flex;align-items:center;justify-content:space-between;font-size:22px;font-weight:700}
.y-ttl span{color:var(--text-3);font-size:15px;font-weight:500}
.y-ls>button{display:flex!important;align-items:center;gap:14px;min-height:60px;width:100%;font-size:17px!important;font-weight:600!important;color:var(--text-1)!important}
.y-ls>button+button{border-top:1px solid var(--line)!important}
.y-ls span{flex:1}
.y-ls i{font-style:normal;color:var(--text-3);font-weight:500;font-size:15.5px}
.y-ck{width:26px;height:26px;border-radius:8px;box-shadow:inset 0 0 0 2px var(--line-strong);display:grid;place-items:center;flex:none;transition:background-color .15s}
.y-ck.on{background:var(--text-1);box-shadow:none;color:var(--bg)}
.y-menu>button{display:flex!important;align-items:center;gap:16px;min-height:60px;width:100%;font-size:17px!important;font-weight:600!important;color:var(--text-1)!important}
.y-menu>button+button{border-top:1px solid var(--line)!important}
.y-menu>button.red{color:var(--danger)!important}
.y-det{display:grid;justify-items:center;text-align:center;gap:6px;margin-bottom:${sz(24, 20)}px}
.y-det .y-nm{font-size:${sz(30, 26)}px;margin-top:10px}
.y-acts{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:${sz(16, 14)}px}
.y-act{height:${sz(84, 80)}px;border-radius:20px;background:var(--surface-1)!important;display:grid!important;place-items:center;align-content:center;gap:6px;font-size:14.5px!important;font-weight:600!important;color:var(--text-2)!important;text-align:center!important}
.y-act svg{color:var(--text-1)}
.y-act.on svg{color:var(--accent)}
.y-act[disabled]{opacity:.4;pointer-events:none}
.y-kv{background:var(--surface-1);border-radius:${sz(24, 22)}px;padding:4px ${sz(20, 16)}px;margin-bottom:${sz(16, 14)}px}
.y-kv>div{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:60px;font-size:16px}
.y-kv>div+div{border-top:1px solid var(--line)}
.y-kv span{color:var(--text-3)}
.y-kv b{font-weight:600;text-align:end}
.y-del{height:56px;width:100%;border-radius:18px;background:var(--surface-1)!important;color:var(--danger)!important;font-size:16.5px!important;font-weight:700!important;display:flex!important;align-items:center;justify-content:center;gap:10px}
.y-wide{max-width:${D ? '760px' : 'none'};margin-inline:auto}
.y-empty{display:grid;justify-items:center;text-align:center;gap:10px;padding:${sz('70px 0', '56px 0')}}
.y-empty .y-nm{font-size:22px;margin-top:8px}
.y-empty .y-pri{margin-top:14px}
.y-sec-t{font-size:15px;font-weight:700;color:var(--text-3);margin:${sz('26px 4px 12px', '22px 4px 10px')}}
.y-toast{position:fixed;left:50%;bottom:calc(28px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:3000;background:var(--text-1);color:var(--bg);font-weight:700;font-size:15.5px;padding:14px 22px;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.5);white-space:nowrap;pointer-events:none}
.y-bar-tools{display:flex;align-items:center;gap:4px;margin-inline-start:auto}
.y-bar-tools .y-ib{width:48px;height:48px}
.y-bar-q{flex:1;display:flex;align-items:center;gap:10px;height:46px;border-radius:23px;background:var(--surface-1);padding:0 16px;margin-inline:8px;color:var(--text-3)}
.y-bar-q input{all:unset;flex:1;min-width:0;font-size:17px;color:var(--text-1)}
.y-bar-q input::placeholder{color:var(--text-3)}
.y-sw-row{display:flex;gap:12px;flex-wrap:wrap}
.y-swatch{width:48px;height:48px;border-radius:50%!important;box-shadow:inset 0 0 0 2px rgba(255,255,255,.08)}
.y-swatch.on{box-shadow:0 0 0 3px var(--surface-1),0 0 0 5px var(--text-1)}
@media (prefers-reduced-motion:reduce){.y *,.y-sheet *{transition:none!important;animation:none!important}}

/* VANTARA · Mobile refinement. Shell and desktop layout remain intact. */
@media (max-width:999px){
.v35 #utilityBody:has([data-y-root]){padding:0!important}
.v35 [data-y-root]{padding:0!important;margin:0!important;max-width:none!important;width:100%!important}
.y{--yg:clamp(14px,4.1vw,20px);padding:18px var(--yg) calc(36px + env(safe-area-inset-bottom,0px));max-width:540px;margin-inline:auto;line-height:1.5}
.y-bar{padding-inline:8px!important;min-height:calc(60px + env(safe-area-inset-top,0px))!important;gap:4px!important;position:sticky!important;top:0;z-index:40;isolation:isolate}
.y-bar h1{font-size:18px!important;flex:1;min-width:0;text-align:start!important;line-height:1.4}
.y-bar .page-top-right{flex:none}.y-bar-tools{gap:0!important;flex:none;margin-inline-start:auto!important}
.y-bar button,.y-bar-tools .y-ib{width:44px!important;height:44px!important;border-radius:12px!important}
.y-bar .y-bar-q{min-width:0;margin:0 2px!important;height:46px;border-radius:23px;gap:8px;padding-inline:12px;background:var(--surface-1);box-shadow:inset 0 0 0 1px var(--line-strong)}
.y-bar .y-bar-q:focus-within{box-shadow:inset 0 0 0 1px var(--text-3)}
.y-bar-q:before,.y-bar-q:after{content:none!important;display:none!important}
.y-bar-q input{font-size:16px!important;min-width:0!important;width:100%!important;background:transparent!important;border:0!important;box-shadow:none!important;padding:0!important;outline:none!important}
.y-overview{margin:0 0 26px}.y-overview h2{font-size:26px;letter-spacing:-.35px;line-height:1.35;font-weight:760;margin:0 0 5px;color:var(--text-1)}
.y-overview p{font-size:13px;color:var(--text-3);margin:0;line-height:1.65}
.y-overview-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid var(--line-strong);border-radius:16px;margin-top:18px;padding:14px 0;background:var(--surface-1)}
.y-overview-stats>div{display:grid;gap:2px;justify-items:center;min-width:0;padding-inline:3px}.y-overview-stats>div+div{border-inline-start:1px solid var(--line-strong)}
.y-overview-stats b{font-size:25px;line-height:1.12;font-weight:700;font-variant-numeric:tabular-nums;direction:ltr}.y-overview-stats span{font-size:11.5px;color:var(--text-2);text-align:center;white-space:normal}
.y-hub-group{margin-bottom:24px}.y-group-head{display:flex;align-items:center;justify-content:space-between;margin:0 2px 10px;color:var(--text-3)}.y-group-head h3{font-size:13px;font-weight:650;margin:0;color:var(--text-2)}.y-group-head span{font-size:12px;font-variant-numeric:tabular-nums}
.y-hub{gap:8px}.y-prov{gap:6px;padding:12px 10px 12px 12px;border:1px solid var(--line);border-radius:16px;min-height:80px;background:var(--surface-1)}
.y-prov-main{gap:12px!important;min-height:52px}.y .y-prov .y-lg{width:48px;height:48px;border-radius:13px}.y-prov .y-nm{font-size:17px;line-height:1.35;white-space:normal;overflow-wrap:anywhere;overflow:visible}.y-prov .y-mt{font-size:12px;line-height:1.55;gap:2px 8px;margin-top:3px}.y-prov .y-up{font-size:12px;color:var(--text-2);font-weight:600}.y-prov .y-up:before{content:'•';margin-inline-end:5px;color:var(--text-3)}
.y .y-ib{width:44px;height:44px;border-radius:12px}.y .y-ib svg{width:21px!important;height:21px!important}.y .y-prov>span.y-ib,.y .y-row>span.y-ib{width:22px;height:44px;color:var(--text-3)!important}.y .y-prov>span.y-ib svg,.y .y-row>span.y-ib svg{width:19px!important;height:19px!important}
.y-head{gap:13px;margin-bottom:22px;padding:0 1px}.y .y-lg.xl{width:58px;height:58px;border-radius:15px}.y-head .y-nm{font-size:24px;line-height:1.2;white-space:normal;overflow-wrap:anywhere}.y-head .y-mt{font-size:13px;display:block;white-space:normal;line-height:1.5;margin-top:5px;overflow-wrap:anywhere}
.y-add{border:1px solid var(--line);border-radius:16px;padding:12px!important;gap:10px;margin-bottom:16px;min-width:0}.y-add:before{content:'إضافة باستخدام رابط';font-size:13px;font-weight:650;color:var(--text-2);padding:0 2px}
.y .y-in,.y-sheet .y-in{height:50px;border-radius:12px;gap:10px;padding:0 12px!important;margin:0!important;min-width:0;max-width:100%;width:100%;box-shadow:inset 0 0 0 1px var(--line-strong);border:0!important;background:var(--bg)!important;box-sizing:border-box}
.y-in:before,.y-in:after{content:none!important}.y .y-in input,.y-sheet .y-in input{min-width:0!important;width:100%!important;font-size:16px!important;padding:0!important;margin:0!important;box-shadow:none!important;border:0!important;background:transparent!important}
.y .y-pri,.y-sheet .y-pri{min-height:44px;height:44px;border-radius:12px;font-size:14px!important;color:var(--on-accent,#fff)!important;white-space:nowrap}.y .y-pri.big,.y-sheet .y-pri.big{height:48px;font-size:14px!important;border-radius:12px}.y .y-pri[disabled]{background:var(--surface-3)!important;color:var(--text-3)!important;opacity:1!important}
.y-chips{gap:6px;margin-bottom:14px;overflow-x:auto;justify-content:stretch}.y .y-chip{height:44px;min-width:0;flex:1;justify-content:center;padding:0 9px!important;font-size:13px!important;border-radius:12px;border:1px solid var(--line)!important}.y .y-chip.on{background:var(--text-1)!important;color:var(--bg)!important}
.y-grid{gap:9px}.y-card{padding:12px!important;border-radius:16px;border:1px solid var(--line);gap:9px;min-width:0}.y-card .y-r1{gap:9px;min-width:0}.y-card .y-r1 .y-lg{width:44px;height:44px;border-radius:11px}.y .y-grip{width:30px;min-height:44px;margin-inline-start:-5px}.y-grip svg{width:20px!important}.y-card .y-r2{gap:0;margin:0 -3px -5px;padding-top:4px}.y-card .y-r2>.y-ib{width:44px}.y-card .y-r2>.y-ib:last-child{color:var(--text-3)!important}.y-card .y-mt{white-space:normal;display:flex;flex-wrap:wrap;gap:4px;line-height:1.4}.y-card .y-nm{font-size:16px;overflow-wrap:anywhere;white-space:normal}
.y .y-sw,.y-sheet .y-sw{width:46px;height:28px;box-sizing:border-box;min-width:46px}.y-sw:after{width:22px;height:22px;left:3px}.y-sw.off:after{left:21px}.y-sw:active:after{width:22px}.y-sw.off:active:after{left:21px}
.y .y-sw:before,.y-sheet .y-sw:before{content:'';position:absolute;inset:-8px -2px}
.y-tabs{gap:0;margin-bottom:16px;justify-content:space-between}.y .y-tab{height:48px;min-width:0;gap:5px;justify-content:center;flex:1;font-size:13px!important;white-space:nowrap}.y-tab i{font-size:12px;font-variant-numeric:tabular-nums}.y-ind{height:2px}
.y-tools{gap:8px;margin-bottom:10px}.y .y-lang{height:44px;font-size:13px!important;border-radius:12px;padding:0 12px!important;max-width:100%;gap:7px}.y-lang svg{width:18px!important;height:18px!important}
.y-list{padding:0 12px!important;border:1px solid var(--line);border-radius:16px;gap:0}.y-row{gap:9px;min-height:69px;padding:10px 0!important;min-width:0}.y-row .y-lg{width:42px;height:42px;border-radius:11px}.y-row .y-nm{font-size:15.5px;white-space:normal;overflow-wrap:anywhere;line-height:1.35}.y-row .y-mt{font-size:12px;gap:5px;white-space:normal;flex-wrap:wrap;line-height:1.4}.y .y-out{min-height:44px;border-radius:10px;padding:0 13px!important;font-size:13px!important}.y-dot{width:5px;height:5px}
.y-det{gap:5px;margin:8px 0 24px}.y .y-det .y-lg.xxl{width:82px;height:82px;border-radius:22px}.y-det .y-nm{font-size:25px;white-space:normal;overflow-wrap:anywhere;max-width:100%}.y-det .y-mt{font-size:13px;white-space:normal}
.y-acts{gap:6px;margin-bottom:16px}.y .y-act{height:76px;border:1px solid var(--line)!important;border-radius:14px;font-size:12px!important;gap:5px}.y-act svg{width:23px!important;height:23px!important}
.y-kv{border:1px solid var(--line);border-radius:16px;padding:0 14px;margin-bottom:12px}.y-kv>div{min-height:54px;font-size:14px;gap:12px;flex-wrap:wrap}.y-kv b{overflow-wrap:anywhere;min-width:0}.y .y-del{height:48px;border-radius:12px;font-size:14px!important;border:1px solid var(--line)!important}.y-empty{padding:40px 6px;gap:6px}.y-empty .y-nm{font-size:20px;white-space:normal}.y-empty .y-mt{white-space:normal;font-size:13px;text-align:center;display:block}
.y-sheet{padding:0;overscroll-behavior:contain}.y-pan{max-height:calc(100dvh - max(24px,env(safe-area-inset-top)));max-width:540px;border-radius:24px 24px 0 0;padding:10px 18px calc(20px + env(safe-area-inset-bottom,0px));gap:14px;border:1px solid var(--line-strong);border-bottom:0;overscroll-behavior:contain}.y-grab{width:36px;height:4px;background:var(--text-4);margin-bottom:4px}.y-ttl{font-size:19px;gap:10px;line-height:1.4;flex-wrap:wrap}.y-ttl span{font-size:13px}.y-prev{gap:12px;min-width:0}.y-prev .y-nm{font-size:19px;white-space:normal;overflow-wrap:anywhere}.y-prev .y-mt{font-size:13px;white-space:normal;overflow-wrap:anywhere;display:block}.y-sheet .y-sec{min-height:48px;height:48px;border-radius:12px;font-size:14px!important}.y-menu>button,.y-ls>button{min-height:52px;font-size:15px!important;gap:12px}.y-toast{max-width:calc(100% - 32px);width:max-content;white-space:normal;text-align:center;font-size:13px;padding:12px 16px;border-radius:12px;overflow-wrap:anywhere}
.y button:focus-visible,.y-bar button:focus-visible,.y-sheet button:focus-visible{outline:2px solid var(--accent-text)!important;outline-offset:2px}
@media(max-width:359px){.y{--yg:12px}.y-prov{gap:3px;padding:10px 7px}.y-prov-main{gap:8px!important}.y .y-prov .y-lg{width:42px;height:42px}.y-prov .y-nm{font-size:16px}.y .y-prov>span.y-ib,.y .y-row>span.y-ib{width:18px}.y-card .y-r1{gap:6px}.y-card .y-r2>.y-ib{width:42px}.y .y-tab{font-size:12px!important;gap:3px}.y-overview-stats span{font-size:10.5px}.y-overview h2{font-size:24px}}
}


/* V1.1: localized controls; maintain existing layout and theme. */
.y .y-mk,.y-sheet .y-mk{color:var(--accent-text)}
.y .y-add:before{content:none!important;display:none!important}.y-add-label{font-size:13px;font-weight:650;color:var(--text-2);display:block;padding:0 2px}.y .y-add{background:transparent;border:0;padding:0!important;gap:9px}.y .y-add .y-in{background:var(--surface-1)!important;box-shadow:inset 0 0 0 1px var(--line-strong)}
.y .y-card.drag{cursor:grabbing;box-shadow:0 12px 28px #0007,inset 0 0 0 1px var(--line-strong);will-change:transform;transition:none!important}.y-grid{overflow-anchor:none}.y-grip{touch-action:none!important}.y-grip:active{cursor:grabbing}
.y .y-ext-row{display:grid;grid-template-columns:minmax(0,1fr);gap:7px;padding:12px 0!important}.y-ext-main,.y-ext-actions{display:flex;align-items:center;gap:8px;min-width:0}.y .y-ext-info{display:flex;align-items:center;gap:10px;flex:1;min-width:0;text-align:start;min-height:48px}.y-ext-info .y-tx{min-width:0;display:block}.y-ext-info .y-nm{display:block}.y-ext-info .y-mt{display:flex;flex-wrap:wrap;gap:3px 7px}.y-repo-name{color:var(--text-3);font-size:11.5px;unicode-bidi:isolate}.y-repo-name:before{content:'· ';color:var(--text-3)}.y-ext-actions{border-top:1px solid var(--line);padding-top:4px}.y-switch-label{font-size:12px;color:var(--text-3);white-space:nowrap}.y .y-enter{display:inline-flex;align-items:center;justify-content:center;gap:4px;border-radius:10px;background:var(--surface-2);min-height:44px;padding:0 10px!important;font-size:12px;font-weight:650;white-space:nowrap}.y .y-enter:disabled{opacity:.4;cursor:default}.y-ext-row.is-off .y-ext-info .y-lg{opacity:.55}.y .y-detail-enter{width:100%;margin:0 0 12px}.y-source-note{font-size:14px;color:var(--text-2);line-height:1.7}
.y .y-repo-filter{min-width:0;flex:1;justify-content:center}.y-repo-filter span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.y-repo-logo{position:relative}.y-repo-logo img{position:absolute;inset:0}.y-repo-options>button{gap:12px;min-height:64px}.y-repo-options .y-lg{flex:none;width:42px;height:42px;border-radius:10px}.y-repo-options .y-ck{flex:none!important}.y-repo-option-name{min-width:0;overflow-wrap:anywhere}.y .y-sw:focus-visible{outline:2px solid var(--accent-text)!important;outline-offset:3px}
@media(min-width:1000px){.y .y-add{grid-template-columns:1fr auto}.y-add-label{grid-column:1/-1}.y-ext-row{max-width:100%}}
@media(max-width:359px){.y-ext-actions{gap:5px}.y .y-enter{padding:0 7px!important;font-size:11px}.y-switch-label{font-size:11px}.y .y-repo-filter{padding:0 7px!important}}

/* V1.2.2 — vertical-only sorting, independent installed/available and priority groups */
.y .y-order-list.y-grid,.y .y-order-list.y-list{grid-template-columns:minmax(0,1fr)}
.y .y-order-list.is-sorting>.drag{touch-action:none;z-index:8}
.y .y-order-list>.y-avail-row{gap:8px}.y .y-avail-row .y-grip{width:24px!important;flex:none}.y .y-avail-row .y-tx{min-width:0}.y .y-avail-row .y-mt{white-space:normal;line-height:1.4;overflow-wrap:anywhere}.y .y-avail-row.drag .y-lg{animation:y-jiggle .16s ease-in-out 3 alternate}.y .y-order-section:has([data-list="available"]) .y-order-head{color:var(--text-2)}
@media(max-width:359px){.y .y-avail-row{gap:6px}.y .y-avail-row .y-lg{width:36px;height:36px}.y .y-avail-row .y-grip{width:22px!important}}

.y-order-section{margin:0 0 22px;min-width:0}.y-order-head{display:flex;justify-content:space-between;align-items:center;margin:0 2px 9px;color:var(--text-2);font-size:12.5px;font-weight:650}.y-order-head span:last-child{font-variant-numeric:tabular-nums;color:var(--text-3);font-weight:500}.y-order-list{position:relative;overflow-anchor:none;isolation:isolate}.y-order-list[data-pin="1"]{--group-border:var(--accent-line)}.y-order-list[data-pin="1"].y-list{border-color:var(--group-border)}.y-order-list[data-pin="1"]>.y-card{border-color:var(--group-border)}.y-order-list>.y-row.drag{z-index:6;background:var(--surface-2);box-shadow:0 8px 24px #0006;outline:1px solid var(--line-strong);border-radius:12px;transition:none!important}.y-order-list .y-grip{width:28px!important;min-height:44px;touch-action:none!important;margin-inline-start:0!important}.y-ext-main .y-grip{align-self:stretch}.y-order-list.is-sorting>.drag{cursor:grabbing;z-index:8;outline:1px solid var(--accent-line);will-change:transform}.y-order-list:not([data-order="stremio"]).is-sorting>.drag>.y-ext-main{animation:y-jiggle .16s ease-in-out 3 alternate;transform-origin:center}.y-order-list.is-sorting{touch-action:none}.y-order-list.is-sorting>*{user-select:none}.y-order-list[data-pin="1"]{border-radius:16px}.y-order-list[data-pin="1"]>.y-card{background:color-mix(in srgb,var(--surface-1) 96%,var(--accent));border-color:var(--accent-line)}.y-order-list[data-pin="1"].y-list{background:color-mix(in srgb,var(--surface-1) 96%,var(--accent));border:1px solid var(--accent-line);padding-inline:10px}.y-order-list[data-pin="1"] .y-ib.on{color:var(--accent-text)!important}.y-order-section:has([data-pin="1"]) .y-order-head{color:var(--accent-text)}.y-order-section+.y-order-section{border-top:1px solid var(--line);padding-top:16px}.y .y-sw:not(.off),.y-sheet .y-sw:not(.off){background:var(--accent)!important}.y .y-sw:not(.off)::after,.y-sheet .y-sw:not(.off)::after{background:var(--on-accent)}.y :focus-visible,.y-sheet :focus-visible,.y-bar :focus-visible{outline:2px solid var(--accent)!important;outline-offset:3px}.y-bar .y-bar-q:focus-within{box-shadow:inset 0 0 0 1px var(--accent-line)}@keyframes y-jiggle{from{transform:rotate(-.7deg)}to{transform:rotate(.7deg)}}
.y-bar .y-bar-q{min-width:0;flex:1 1 0;overflow:hidden}.y-bar .y-bar-q input{flex:1 1 0;width:0!important;min-width:0!important}.y-bar:has(.y-bar-q) .page-top-right,.y-bar:has(.y-bar-q) .y-bar-tools{width:44px!important;flex:0 0 44px!important}
.y .y-repo-add-row{display:flex;align-items:center;justify-content:center;gap:9px;margin-top:12px;width:100%;min-height:50px;border:1px solid var(--line-strong);border-radius:14px;background:var(--surface-1);color:var(--text-1);font-size:14px;font-weight:650}.y .y-repo-add-row svg{color:var(--accent-text)}.y .y-repo-add-row:active{background:var(--surface-2)}.y-repo-editor{display:grid;gap:22px;min-width:0}.y-editor-title{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}.y-editor-title h2{font-size:23px;font-weight:750;margin:3px 0 4px;line-height:1.35}.y-editor-kicker{font-size:12px;font-weight:650;color:var(--accent-text);direction:ltr;text-align:right}.y-editor-title p,.y-photo-copy p,.y-editor-help{font-size:12px;line-height:1.65;color:var(--text-3);margin:0}.y-editor-title .y-ib{width:44px;height:44px;background:var(--surface-2);border-radius:12px}.y-photo-block{display:flex;align-items:center;gap:16px;padding:15px;background:var(--surface-2);border:1px solid var(--line);border-radius:16px;position:relative}.y-repo-photo{width:80px;height:80px;flex:none;display:grid;place-items:center;position:relative;border-radius:19px;background:var(--surface-3);color:var(--text-2);border:1px dashed var(--line-strong);cursor:pointer}.y-repo-photo img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit}.y-repo-photo.has-photo{border-style:solid}.y-photo-plus{position:absolute;bottom:-4px;inset-inline-end:-4px;width:25px;height:25px;border-radius:50%;display:grid;place-items:center;background:var(--accent);color:var(--on-accent,#fff);border:2px solid var(--surface-2)}.y-photo-copy{min-width:0;flex:1}.y-photo-copy strong{font-size:14px;font-weight:700}.y-photo-label,.y-sheet .y-photo-remove{display:inline-flex;align-items:center;min-height:38px;font-size:13px;font-weight:650;color:var(--accent-text);cursor:pointer;margin-inline-end:12px}.y-sheet .y-photo-remove{color:var(--text-3)}.y-file{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none}.y-editor-fields{display:grid;gap:8px}.y-editor-fields>label:not(.y-in){display:flex;align-items:center;justify-content:space-between;font-size:14px;font-weight:650}.y-editor-fields>label small{font-size:11px;color:var(--text-3);font-weight:500}.y-editor-fields .y-in{height:52px!important;border-radius:13px!important;background:var(--bg)!important;border:1px solid var(--line-strong)!important;box-shadow:none!important}.y-editor-fields .y-in:focus-within{border-color:var(--accent)!important}.y-editor-fields .y-in+label{margin-top:8px}.y-editor-help{margin-top:0}.y-repo-error{color:var(--danger);font-size:12px;line-height:1.6;margin:0}.y-editor-footer{display:grid;gap:8px;padding-top:14px;border-top:1px solid var(--line)}.y-editor-footer .y-pri,.y-editor-footer .y-sec{width:100%;justify-content:center;display:flex;align-items:center;gap:8px;min-height:48px}.y-editor-footer .y-sec{background:transparent!important;min-height:44px}.y-repo-editor [hidden]{display:none!important}.y-sheet .y-repo-editor .y-photo-label{touch-action:manipulation}.y-pan:has(.y-repo-editor){overflow-y:auto;max-height:calc(100dvh - 18px);overscroll-behavior:contain}.y-repo-photo:focus-within{outline:2px solid var(--accent-text)}@media(max-width:359px){.y-photo-block{padding:12px;gap:12px}.y-repo-photo{width:68px;height:68px}.y-repo-editor{gap:16px}.y-order-list .y-grip{width:24px!important}.y-ext-main{gap:5px}.y-editor-title h2{font-size:21px}}

/* v1.2.3: discovery list, native keyboard geometry and stable navigation */
.y-bar .y-back-fixed{width:48px!important;height:48px!important;min-width:48px!important;min-height:48px!important;flex:0 0 48px!important;display:grid!important;place-items:center!important;margin:0!important;padding:0!important;transform:none!important;touch-action:manipulation}
.y-bar .y-back-fixed svg{width:24px!important;height:24px!important;flex:none;transform:none!important}
.y-bar .page-top-right{flex:0 0 48px!important;min-width:48px!important}.y-bar:has(.y-bar-q) .page-top-right{width:48px!important;flex:0 0 48px!important}
.y .y-available-list>.y-avail-row{gap:10px;min-height:65px;touch-action:pan-y}.y .y-available-list .y-tx{min-width:0}.y .y-available-list .y-nm{overflow-wrap:anywhere}.y .y-available-list .y-out{min-height:44px;min-width:60px}
.y-sheet{inset:auto 0 auto 0;top:var(--visible-top,0px);height:var(--visible-h,100dvh);max-height:var(--visible-h,100dvh)}
.y-sheet .y-pan{max-height:calc(var(--visible-h,100dvh) - 16px)}
.y-sheet.y-editor-sheet .y-pan{display:flex;flex-direction:column;gap:6px;overflow:hidden;padding:8px 0 0;max-height:calc(var(--visible-h,100dvh) - 12px);width:min(100%,540px);min-height:0}
.y-editor-sheet .y-repo-editor{display:flex;flex-direction:column;gap:0;min-height:0;overflow:hidden}
.y-editor-sheet .y-editor-title{flex:none;padding:8px 18px 12px;align-items:center;border-bottom:1px solid var(--line)}
.y-editor-sheet .y-editor-title h2{font-size:21px}.y-editor-sheet .y-editor-title .y-ib{flex:0 0 44px;background:transparent!important;border:1px solid var(--line)}
.y-editor-sheet .y-editor-body{min-height:0;overflow:auto;overscroll-behavior:contain;padding:16px 18px;display:flex;flex-direction:column;gap:18px;scroll-padding:10px;touch-action:pan-y}
.y-editor-sheet .y-photo-block{background:transparent;border:0;padding:0;gap:12px;flex:none}.y-editor-sheet .y-repo-photo{width:68px;height:68px;border-radius:16px}.y-editor-sheet .y-photo-copy p{font-size:12px}.y-editor-sheet .y-photo-plus{bottom:-2px;inset-inline-end:-2px}
.y-editor-sheet .y-editor-fields{flex:none;gap:8px}.y-editor-sheet .y-editor-fields .y-in{height:48px!important;border-radius:12px!important;overflow:visible}.y-sheet .y-in input:focus,.y-sheet .y-in input:focus-visible,.y .y-in input:focus,.y .y-in input:focus-visible,.y-bar .y-bar-q input:focus,.y-bar .y-bar-q input:focus-visible{outline:none!important;box-shadow:none!important;border:0!important}
.y-sheet .y-in:focus-within,.y .y-in:focus-within,.y-bar .y-bar-q:focus-within{border-color:var(--accent)!important;box-shadow:0 0 0 1px var(--accent-line)!important}
.y-editor-sheet .y-editor-footer{flex:none;padding:12px 18px max(14px,env(safe-area-inset-bottom));background:var(--surface-1);border-top:1px solid var(--line);margin:0}
.y-editor-sheet .y-editor-footer .y-pri{min-height:48px}.y-compact-sheet.y-editor-sheet .y-pan{max-height:var(--visible-h,100dvh);border-radius:16px 16px 0 0;padding-top:4px}.y-compact-sheet .y-grab,.y-compact-sheet .y-editor-title p,.y-compact-sheet .y-editor-kicker{display:none!important}.y-compact-sheet .y-editor-title{padding:4px 14px}.y-compact-sheet .y-editor-title h2{font-size:18px;margin:0}.y-compact-sheet .y-editor-body{padding:10px 14px;gap:14px}.y-compact-sheet .y-editor-footer{padding:8px 14px}.y-compact-sheet .y-editor-footer .y-pri{min-height:44px}
@media(max-width:359px){.y-editor-sheet .y-editor-body{padding-inline:14px}.y-editor-sheet .y-editor-title,.y-editor-sheet .y-editor-footer{padding-inline:14px}.y .y-available-list>.y-avail-row{gap:7px}.y .y-available-list .y-out{min-width:54px}}
/* v1.2.4 — لون الثيم في مواضعه فقط، سطر واحد، المعطّلة باهتة */
.y{padding-bottom:140px!important}
.y .y-mk,.y-sheet .y-mk{color:var(--text-1)}
.y-order-list[data-pin="1"].y-list{background:var(--surface-1)!important;border-color:var(--line)!important}
.y-order-list[data-pin="1"]>.y-card{background:var(--surface-1)!important;border-color:var(--line)!important}
.y-order-section:has([data-pin="1"]) .y-order-head{color:var(--text-2)!important}
.y-order-list[data-pin="1"] .y-ib.on{color:var(--accent)!important}
.y .y-sw:not(.off),.y-sheet .y-sw:not(.off){background:var(--text-1)!important}
.y .y-sw:not(.off)::after,.y-sheet .y-sw:not(.off)::after{background:var(--bg)!important}
.y .y-overview{margin-top:4px}
.y-stat-btn{cursor:pointer;border-radius:14px;transition:background-color .15s}
.y-stat-btn.has b{color:var(--accent)}
@media (hover:hover){.y-stat-btn.has:hover{background:var(--surface-2)}}
.y .y-ext-row{display:flex!important;align-items:center;gap:2px!important;min-height:72px;padding:8px 0!important}
.y .y-ext-row .y-ext-info{display:flex!important;align-items:center;gap:12px;flex:1;min-width:0;text-align:start!important;padding:0!important;background:none!important}
.y .y-ext-row .y-tx{display:grid;min-width:0}
.y .y-ext-row .y-nm{font-size:17px}
.y .y-ext-row .y-mt{font-size:13.5px;flex-wrap:nowrap}
.y .y-ext-row .y-ext-info,.y .y-ext-row .y-lg,.y .y-ext-row .y-nm,.y .y-card .y-r1>[data-y="open"]>*,.y .y-card .y-r2{transition:opacity 260ms ${EASE},filter 260ms ${EASE}}
.y .y-ext-row.is-off .y-ext-info{opacity:.36}
.y .y-ext-row .y-sw{margin-inline:8px 10px}
.y .y-card.is-off .y-r1>[data-y="open"]>*,.y .y-card.is-off .y-r2{opacity:.36}
.y-ra{display:grid;gap:12px;padding:2px 0 4px}
.y-ra-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.y-ra-head h2{font-size:20px;font-weight:700;margin:0;color:var(--text-1)}
.y-ra-head .y-ib{width:40px!important;height:40px!important;margin-inline-end:-8px}
.y-ra .y-in{height:52px;border-radius:14px}
.y-ra .y-pri.big{height:50px!important;min-height:50px!important;border-radius:14px}
.y-ra .y-pri[disabled]{opacity:1!important;background:var(--surface-3)!important;color:var(--text-3)!important}
.y-ra .y-in{padding-inline:16px 8px}
.y-ra-url input{direction:ltr;text-align:left}
.y-ra-paste{height:36px;padding:0 14px!important;border-radius:11px;background:var(--surface-3)!important;font-size:14px!important;font-weight:700!important;color:var(--text-1)!important;flex:none}
.y-ra-msg{margin:-4px 6px -2px;font-size:13.5px;min-height:18px;line-height:18px;color:var(--text-3);display:flex;align-items:center;gap:10px}
.y-ra-msg[data-kind="err"]{color:var(--danger)}
.y-ra-msg button{color:var(--text-1)!important;font-weight:700!important;text-decoration:underline!important;text-underline-offset:3px}
.y-ra-prev{display:flex;align-items:center;gap:14px;padding:12px;border-radius:16px;background:var(--surface-2);height:88px;box-sizing:border-box}
.y-ra-prev.is-empty .y-ra-img{pointer-events:none}
.y-ra-prev.is-empty .y-ra-img b{color:var(--text-3);background:transparent;box-shadow:inset 0 0 0 1.5px var(--line-strong)}
.y-ra-prev.is-empty .y-photo-plus{display:none}
.y-ra-prev.is-empty .y-ra-count{color:var(--text-3)}
.y-ra-img{position:relative;width:64px;height:64px;flex:none;cursor:pointer}
.y-ra-sheet .y-pan{transition:none}
.y-ra-img img,.y-ra-img b{width:64px;height:64px;border-radius:18px;display:grid;place-items:center;object-fit:cover;background:var(--surface-3);font-size:26px;font-weight:700;color:var(--text-1)}
.y-ra-img .y-photo-plus{background:var(--text-1)!important;color:var(--bg)!important}
.y-ra-meta{flex:1;min-width:0;display:grid;gap:6px}
.y-ra-nick{display:grid;gap:2px;cursor:text}
.y-ra-nick span{font-size:12px;color:var(--text-3);font-weight:600}
.y-ra-nick input{all:unset;font-size:19px;font-weight:700;color:var(--text-1);border-bottom:1px solid var(--line-strong);padding:2px 0 5px;min-width:0}
.y-ra-nick input:focus{border-color:var(--text-2)}
.y-ra-count{font-size:13.5px;color:var(--text-3)}
.y-up-h{display:flex;align-items:center;gap:10px;font-size:14px;font-weight:700;color:var(--text-2);margin:4px 0 2px}
.y-up-h .y-lg{width:28px!important;height:28px!important;border-radius:9px!important}
.y-up-row{position:relative;display:flex;align-items:center;gap:12px;min-height:64px}
.y-up-row+.y-up-row{border-top:1px solid var(--line)}
.y-up-row .y-lg{width:44px!important;height:44px!important;border-radius:12px!important}
.y-up-row.done .y-up{color:var(--text-3)}
.y-sheet .y-grab{touch-action:none;cursor:grab;padding:8px 40px;margin:-6px auto 0;box-sizing:content-box;background-clip:content-box}

/* v1.2.5 — الكمبيوتر: عمود واحد مثل Nuvio */
${D?`
.v35 [data-y-root]{max-width:1240px!important;width:100%!important;margin-inline:auto!important}
.y{max-width:1240px;margin-inline:auto}
.y .y-hub,.y .y-list,.y .y-grid{grid-template-columns:minmax(0,1fr)!important}
.y .y-list,.y .y-order-list[data-pin="1"].y-list{padding:0!important;background:none!important;border:0!important;display:grid;gap:10px;column-gap:0}
.y .y-grid{gap:10px}
.y .y-drow,.y .y-list>.y-avail-row,.y .y-list>.y-row{background:var(--surface-1);border-radius:20px;padding:14px 16px 14px 20px!important;min-height:96px;border-top:0!important;gap:16px!important;transition:background-color .15s;box-sizing:border-box}
@media (hover:hover){.y .y-drow:hover,.y .y-list>.y-avail-row:hover,.y .y-list>.y-row:hover{background:var(--surface-2)}}
.y .y-drow .y-ext-info{gap:18px!important}
.y .y-lg.dl{width:72px!important;height:72px!important;border-radius:20px!important}
.y .y-drow{min-height:108px!important}
.y-dn{font-size:21px!important}
.y .y-list>.y-avail-row .y-lg,.y .y-list>.y-row>.y-lg{width:56px!important;height:56px!important;border-radius:16px!important}
.y-dn{display:flex;align-items:center;gap:10px;font-size:20px;font-weight:700;color:var(--text-1);line-height:1.3;min-width:0}
.y-dn>span:first-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.y-chipv{font-size:12.5px;font-weight:600;color:var(--text-2);background:var(--surface-3);padding:3px 9px;border-radius:8px;direction:ltr;flex:none}
.y .y-drow .y-mt,.y .y-list>.y-avail-row .y-mt{font-size:14.5px!important;margin-top:5px}
.y .y-list>.y-avail-row .y-nm,.y .y-list>.y-row .y-nm{font-size:18px}
.y-dacts{display:flex;align-items:center;gap:4px;flex:none}
.y .y-dacts .y-ib{width:50px!important;height:50px!important;border-radius:14px}
.y .y-dacts .y-ib[disabled]{opacity:.25;pointer-events:none}
.y-dsep{width:1px;height:28px;background:var(--line-strong);margin-inline:8px;flex:none}
.y-dup{height:46px;padding:0 16px!important;border-radius:14px;font-size:15.5px!important;background:var(--surface-3)!important;color:var(--text-1)!important;font-weight:700!important;font-size:14.5px!important;display:inline-flex!important;align-items:center;gap:8px;flex:none;transition:background-color .15s}
@media (hover:hover){.y-dup:hover{background:var(--line-strong)!important}}
.y .y-drow .y-sw{margin:0 6px}
.y .y-dprov{min-height:128px!important;padding:22px 24px!important;gap:22px!important;border-radius:24px!important;border:0!important}
.y .y-dprov .y-lg.dxl{width:96px!important;height:96px!important;border-radius:28px!important}
.y .y-dprov{min-height:148px!important}
.y .y-faces .y-lg{width:34px!important;height:34px!important;border-radius:10px!important}
.y .y-dprov .y-dn{font-size:25px}
.y .y-dprov .y-mt{font-size:15px!important;margin-top:4px}
.y-faces{display:flex;align-items:center;gap:6px;margin-top:12px}
.y .y-faces .y-lg{width:30px!important;height:30px!important;border-radius:9px!important;box-shadow:none}
.y-faces i{font-style:normal;font-size:13px;font-weight:600;color:var(--text-3);margin-inline-start:4px}
.y .y-overview{display:block!important;margin:0 0 8px}
.y .y-overview-stats{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid var(--line-strong);border-radius:22px;padding:22px 0;background:var(--surface-1)}
.y .y-overview-stats>div{display:grid;gap:4px;justify-items:center;align-content:center;margin:0 10px;padding:6px 0}
.y .y-overview-stats>div+div{border-inline-start:1px solid var(--line-strong)}
.y .y-overview-stats b{font-size:36px;line-height:1.1;font-weight:700;font-variant-numeric:tabular-nums;direction:ltr;color:var(--text-1)}
.y .y-overview-stats .y-stat-btn.has b{color:var(--accent)}
.y .y-overview-stats span{font-size:14px;color:var(--text-2)}
.y .y-hub-group{margin-top:26px}
.y .y-hub-group .y-group-head{display:flex;align-items:center;justify-content:space-between;margin:0 4px 12px}
.y .y-hub-group .y-group-head h3{font-size:15px;font-weight:700;margin:0;color:var(--text-2)}
.y .y-hub-group .y-group-head span{font-size:13px;color:var(--text-3)}
.y .y-hub{display:grid;gap:12px}
.y .y-ib.danger{color:var(--text-2)!important}
@media (hover:hover){.y .y-ib.danger:hover{color:var(--danger)!important}}
.y .y-head .y-lg.xl{width:96px!important;height:96px!important;border-radius:28px!important}
.y .y-tab{font-size:18px!important;height:58px!important}
.y .y-lang{height:50px!important;font-size:17px!important}
.y-bar .y-ib{width:52px!important;height:52px!important}
.y-bar .y-ib svg{width:28px!important;height:28px!important}
.y .y-drow .y-sw{transform:scale(1.12)}
.y .y-head .y-nm{font-size:30px}
.y [data-tip]{position:relative}
.y [data-tip]:hover::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);background:var(--text-1);color:var(--bg);font-size:12.5px;font-weight:700;padding:6px 10px;border-radius:8px;white-space:nowrap;pointer-events:none;z-index:30;animation:y-tip .14s ease-out}
@keyframes y-tip{from{opacity:0;transform:translate(-50%,4px)}}
.y .y-wide{max-width:900px}
`:''}
/* ── تعديلات المالك على v1.2.6 ── */
/* المفتاح: المعطّل أسود (لا لون الثيم)، والمفعّل تنعكس ألوانه: مسار فاتح ومقبض أسود */
.y .y-sw.off,.y-sheet .y-sw.off{background:#000!important;box-shadow:inset 0 0 0 1.5px var(--line-strong)!important}
.y .y-sw.off::after,.y-sheet .y-sw.off::after{background:var(--text-2)!important}
.y .y-sw:not(.off),.y-sheet .y-sw:not(.off){background:var(--text-1)!important;box-shadow:none!important}
.y .y-sw:not(.off)::after,.y-sheet .y-sw:not(.off)::after{background:#000!important}
/* أحجام وتباين أعلى من التصور (طلب المالك بعد التجربة): أيقونات 24px بلون النص الأول، وأسماء وشعارات أكبر */
.y .y-ib svg,.y-sheet .y-ib svg{width:${sz(26, 24)}px!important;height:${sz(26, 24)}px!important}
.y .y-ib.dim,.y-sheet .y-ib.dim{color:var(--text-1)!important}
.y .y-prov>span.y-ib,.y .y-row>span.y-ib{color:var(--text-2)!important}
.y .y-prov>span.y-ib svg,.y .y-row>span.y-ib svg{width:22px!important;height:22px!important}
.y .y-grip{color:var(--text-2)!important}.y .y-grip svg{width:22px!important;height:24px!important}
.y .y-mt{color:var(--text-2)}
.y .y-card .y-nm,.y .y-ext-row .y-nm,.y .y-avail-row .y-nm{font-size:${sz(18, 17)}px}
.y .y-card .y-lg,.y .y-ext-row .y-lg,.y .y-avail-row .y-lg{width:${sz(56, 48)}px;height:${sz(56, 48)}px}
.y .y-sw,.y-sheet .y-sw{width:52px;height:32px;min-width:52px}
.y .y-sw::after,.y-sheet .y-sw::after{width:26px;height:26px;top:3px;left:3px}
.y .y-sw.off::after,.y-sheet .y-sw.off::after{left:23px}
.y .y-get svg{width:24px!important;height:24px!important}.y .y-get{width:46px;height:46px}
/* صف إجراءات التفاصيل: كل الأزرار في سطر واحد مهما كان عددها (Stremio خمسة، والأصلية أربعة) */
.y .y-acts{grid-template-columns:none;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr)}
.y .y-act{min-width:0}
/* فاصل الأرقام: خط مستقيم لا يلتف مع زاوية زر «تحديثات» */
.y-overview-stats>div+div{border-inline-start:0!important;position:relative}
.y-overview-stats>div+div::before{content:'';position:absolute;inset-inline-start:0;top:2px;bottom:2px;width:1px;background:var(--line-strong)}
.y-sw[disabled]{opacity:.5}
/* زر التثبيت: أيقونة في دائرة 44px (هدف لمس كامل) */
.y .y-get{width:44px;height:44px;flex:none;display:grid;place-items:center;border-radius:50%;padding:0;color:var(--text-1);background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line-strong);position:relative}
.y .y-get svg{width:22px!important;height:22px!important}
@media (hover:hover){.y .y-get:hover{background:var(--surface-3)}}
.y .y-get.busy{background:none;box-shadow:none;color:var(--text-2)}
.y .y-get.busy svg,.y-spin svg{animation:y-rot .8s linear infinite}
@keyframes y-rot{to{transform:rotate(360deg)}}
/* لا نسبة مزيفة: شريط غير محدد المدة */
.y-prog.ind i{width:38%!important;animation:y-ind 1.15s cubic-bezier(.4,0,.2,1) infinite;transition:none}
@keyframes y-ind{from{transform:translateX(170%)}to{transform:translateX(-170%)}}
/* تحديات الحماية */
.y-guard .y-lg{color:var(--warning,#e8b04b);background:color-mix(in srgb,var(--warning,#e8b04b) 14%,var(--surface-2))}
.y-ch-btn{flex:none;min-height:40px;padding:0 16px!important;border-radius:20px!important;background:var(--surface-3)!important;color:var(--text-1)!important;font-weight:700!important;font-size:14px!important}
.y-ch-btn[disabled]{opacity:.55}
.y-sheet [data-guard-list]{min-width:0;padding-inline:3px}
.y-ch-row{display:grid;grid-template-columns:44px minmax(0,1fr) 76px;gap:10px;min-width:0;max-width:100%;padding-block:8px}
.y-ch-row .y-ch-btn{width:76px;padding:0!important;text-align:center}
.y-ch-row .y-tx,.y-ch-row .y-nm,.y-ch-url{display:block;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.y-ch-url{font-size:12px;color:var(--text-2);text-align:start;unicode-bidi:isolate}
.y-ch-logo{position:relative;display:grid;width:44px}
.y-ch-shield{position:absolute;inset-block-start:-5px;inset-inline-start:-4px;display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--surface-3);color:var(--warning,#e8b04b);box-shadow:0 0 0 2px var(--surface-1)}
.y .y-available-list{display:block;overflow-anchor:none}
.y .y-available-list>.y-avail-row{box-sizing:border-box;height:${sz(96, 74)}px;min-height:0;margin-block-end:${sz(10, 0)}px}
.y .y-available-list .y-nm,.y .y-available-list .y-mt{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.y .y-ext-row .y-nm,.y .y-ext-row .y-mt,.y .y-card .y-nm,.y .y-card .y-mt,.y .y-card-d .y-mt{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.y .y-card.is-off .y-r2{visibility:hidden}
.y .y-card.is-off .y-grip{visibility:hidden}
.y .y-ext-row.is-off .y-ext-info,.y .y-card-d.is-off .y-ext-info,.y .y-card.is-off .y-r1>[data-y="open"]>*{filter:blur(1.3px);opacity:.42}
.y-in-ro{color:var(--text-3);gap:10px}.y-in-ro span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}
.y-menu>.y-menu-file{display:flex;align-items:center;gap:16px;min-height:60px;width:100%;font-size:17px;font-weight:600;color:var(--text-1);cursor:pointer}
.y-danger{background:var(--danger)!important;color:#fff!important}
.y-kv>div>.y-ch-btn{margin-inline-start:auto}
`;
}
