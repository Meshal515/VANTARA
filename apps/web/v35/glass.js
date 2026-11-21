/**
 * التأثير الزجاجي (Glass): خيار مظهر مستقل بجانب «الحالي» (قرار المالك، 21 نوفمبر).
 * الخطة والقرارات والأدلة: docs/audits/GLASS_UI_PLACEMENT.md، والمرجع البصري النهائي نموذج v9
 * (docs/audits/glass/vantara-dock-glass.html). الأرقام هنا مقفلة من النموذج (القسم 0.1 في الخطة).
 *
 * ما يفعله هذا الملف فقط: يقرر مستوى الزجاج للجهاز، ويكتب سمتين على <html>، ويبني مرشحات الانكسار.
 * المظهر الحالي = السمة غائبة، فلا تنطبق أي قاعدة من glass.css ولا يُبنى شيء هنا.
 */
import { readAppearance, readPreference, writePreference, glassChosen } from './appearance.js';

/** أرقام v9 المقفلة. أي تغيير فيها يحتاج أمر المالك. */
export const GLASS = Object.freeze({
  pos: Object.freeze({ travel: Object.freeze({ k: 190, c: 21 }), follow: Object.freeze({ k: 420, c: 38 }) }),
  lift: Object.freeze({ up: Object.freeze({ k: 700, c: 42 }), down: Object.freeze({ k: 300, c: 24 }) }),
  wobble: Object.freeze({ k: 520, c: 24 }),
  form: Object.freeze({ k: 300, c: 30 }),
  rest: 40, // دائرة ساكنة
  lifted: Object.freeze({ w: 78, h: 60 }), // الضغط والسحب
  flight: 0.6, // ارتفاع الطيران بعد النقر
  flightGap: 14, // يبقى مرفوعًا ما دام أبعد من هذا عن هدفه
  stretchMax: 0.24,
  stretchPerSpeed: 1 / 1500,
  glyphLift: 0.2,
  switchLift: 0.1,
  closeAfterMs: 140, // المبدّل ينغلق بعد هبوط العدسة على القسم
  closeWithinPx: 6,
  dispersion: 0.26,
  compact: 0.85,
});

const SVGNS = 'http://www.w3.org/2000/svg';
const TIER_KEY = 'vantara.glass.tier.v1';
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

/**
 * محرك يكسر الضوء بمرشح SVG في backdrop-filter: Chromium وحده (مُقاس في Chromium 153؛ Safari وFirefox
 * غير مُتحقق منهما فيأخذان الضباب). WebKit على iOS يلبس اسم Chrome (CriOS) فيُستثنى.
 */
export function engineRefracts(nav = globalThis.navigator) {
  const brands = nav?.userAgentData?.brands;
  if (Array.isArray(brands) && brands.some((b) => /Chromium/i.test(b?.brand ?? ''))) return true;
  const ua = String(nav?.userAgent ?? '');
  return /\bChrome\/\d+/.test(ua) && !/\b(CriOS|FxiOS|EdgiOS)\b/.test(ua);
}

/**
 * مستوى الزجاج: a كامل (انكسار وتشتت)، b انكسار بلا تشتت، c ضباب بلا انكسار، off المظهر الحالي.
 * القدرة أولًا، ثم ما نزل إليه مراقب الأداء على هذا الجهاز. لا حكم بالذاكرة ولا بعدد الأنوية.
 */
export function glassTier({ storage = globalThis.localStorage, appearance = readAppearance(storage), win = globalThis } = {}) {
  if (!glassChosen(appearance)) return 'off';
  if (win?.matchMedia?.('(prefers-reduced-transparency: reduce)')?.matches) return 'off';
  const engine = engineRefracts(win?.navigator) ? 'a' : 'c';
  const stepped = readPreference(TIER_KEY, storage);
  const order = ['a', 'b', 'c', 'off'];
  if (order.includes(stepped)) return order[Math.max(order.indexOf(engine), order.indexOf(stepped))];
  return engine;
}

/** يكتب المادة والمستوى على <html> ويبني مرشحات العدسة. يُستدعى مع كل تطبيق للمظهر. */
export function syncGlass({ doc = globalThis.document, storage = globalThis.localStorage, appearance = readAppearance(storage) } = {}) {
  const html = doc?.documentElement;
  if (!html) return 'off';
  const tier = glassTier({ appearance, win: doc.defaultView ?? globalThis, storage });
  if (tier === 'off') {
    delete html.dataset.material;
    delete html.dataset.glassTier;
    bindGlassTabs(doc, false);
    return tier;
  }
  html.dataset.material = 'glass';
  html.dataset.glassTier = tier;
  if (tier !== 'c') { ensureLensFilter(doc, tier); ensureFamilyFilters(doc, tier); }
  else for (const k of FAMILY_VARS) html.style.removeProperty(k);
  if (doc.body) bindGlassTabs(doc, true);
  return tier;
}

// ── مراقب الأداء: يقيس فواصل الإطارات أثناء تفاعل الزجاج وحده، وينزل مستوى عند تراجع متكرر ──
let badSessions = 0;
/**
 * جلسة تفاعل انتهت (سحب أو نقر حتى استقرار العدسة). الميزانية من المعدل الفعلي للجلسة نفسها (وسيط الفواصل)،
 * لا من معدل الشاشة. ثلاث جلسات متتالية نسبتها 95 فوق 1.25 من الوسيط تنزل مستوى وتحفظه للجهاز.
 * الأرقام مبدئية تضبطها المعايرة (الخطة 4.6 و5.4).
 * @returns {string|null} المستوى الجديد إن نزل
 */
export function noteSession(dts, { doc = globalThis.document, storage = globalThis.localStorage } = {}) {
  const f = dts.filter((d) => d > 0 && d < 250).sort((a, b) => a - b);
  if (f.length < 20) return null;
  const median = f[Math.floor(f.length / 2)], p95 = f[Math.floor(f.length * 0.95)];
  badSessions = p95 > median * 1.25 ? badSessions + 1 : 0;
  if (badSessions < 3) return null;
  badSessions = 0;
  const html = doc?.documentElement;
  const now = html?.dataset.glassTier ?? 'a';
  const next = { a: 'b', b: 'c', c: 'off' }[now];
  if (!next) return null;
  writePreference(TIER_KEY, next, storage);
  syncGlass({ doc, storage });
  doc?.defaultView?.dispatchEvent?.(new (doc.defaultView.CustomEvent ?? CustomEvent)('vantara:glass-tier', { detail: next }));
  return next;
}
export const resetGlassTier = (storage = globalThis.localStorage) => writePreference(TIER_KEY, '', storage);

// ── خرائط الانكسار (من v9 كما هي) ──
const enc = (n) => 128 + clamp(n, -1, 1) * 127;
function toURL(doc, data, W, H) {
  const c = doc.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext?.('2d');
  if (!x || typeof ImageData !== 'function') return null;
  x.putImageData(new ImageData(data, W, H), 0, 0);
  return c.toDataURL('image/png');
}
/** سطح محدّب: الحافة تنحني للداخل بقوة، والوسط يكبّر قليلًا. بيضاوية تتمدد مع العنصر (وحدات الصندوق). */
function lensMap(doc, N, { bevel, magnify }) {
  const data = new Uint8ClampedArray(N * N * 4), R = N / 2;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u = (i + 0.5 - R) / R, w = (j + 0.5 - R) / R, rho = Math.hypot(u, w), k = (j * N + i) * 4;
    data[k + 2] = 128;
    data[k + 3] = 255;
    if (!rho) { data[k] = data[k + 1] = 128; continue; }
    const r = Math.min(rho, 1), t = Math.min(1, (1 - r) / bevel), m = (1 - t) ** 3;
    data[k] = enc(-(u / rho) * (m * (1 - magnify) + r * magnify));
    data[k + 1] = enc(-(w / rho) * (m * (1 - magnify) + r * magnify));
  }
  return toURL(doc, data, N, N);
}
const sd = (px, py, hw, hh, r) => {
  const qx = Math.abs(px) - hw + r, qy = Math.abs(py) - hh + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
};
/** كبسولة بمقاسها الفعلي: انحناء على الحافة فقط. */
function capMap(doc, w, h, r, bevel) {
  const q = 2, W = Math.round(w * q), H = Math.round(h * q), hw = W / 2, hh = H / 2, R = r * q, B = bevel * q;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const px = i + 0.5 - hw, py = j + 0.5 - hh, k = (j * W + i) * 4, d = Math.min(0, sd(px, py, hw, hh, R));
    data[k + 2] = 128;
    data[k + 3] = 255;
    const t = Math.min(1, -d / B), m = (1 - t) ** 3;
    const gx = sd(px + 1, py, hw, hh, R) - sd(px - 1, py, hw, hh, R), gy = sd(px, py + 1, hw, hh, R) - sd(px, py - 1, hw, hh, R), len = Math.hypot(gx, gy) || 1;
    data[k] = enc(-gx / len * m);
    data[k + 1] = enc(-gy / len * m);
  }
  return toURL(doc, data, W, H);
}

const CH = { r: '1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0', g: '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0', b: '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0' };
function defs(doc) {
  let svg = doc.getElementById('g-defs');
  if (!svg) {
    svg = doc.createElementNS(SVGNS, 'svg');
    svg.id = 'g-defs';
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    doc.body?.append(svg);
  }
  return svg;
}
/**
 * مرشح انكسار بوحدات الصندوق: الخريطة تتمدد مع العنصر فلا تتبدل أثناء تغير حجمه. التشتت: الأزرق ينكسر أكثر
 * من الأحمر فتفترق الألوان على الحافة وحدها. المستوى b تمريرة واحدة بلا تشتت.
 */
function glassFilter(doc, id, href, S, spread, tier) {
  if (!href) return null;
  doc.getElementById(id)?.remove();
  const f = doc.createElementNS(SVGNS, 'filter');
  for (const [a, v] of Object.entries({ id, x: 0, y: 0, width: 1, height: 1, primitiveUnits: 'objectBoundingBox', 'color-interpolation-filters': 'sRGB' })) f.setAttribute(a, String(v));
  const D = tier === 'a' ? GLASS.dispersion * spread : 0;
  const img = `<feImage href="${href}" x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="map"/>`;
  const pass = (ch, k) => `<feDisplacementMap in="SourceGraphic" in2="map" scale="${(S * k).toFixed(4)}" xChannelSelector="R" yChannelSelector="G" result="d${ch}"/><feColorMatrix in="d${ch}" type="matrix" values="${CH[ch]}" result="${ch}"/>`;
  f.innerHTML = D > 0
    ? `${img}${pass('r', 1 - D)}${pass('g', 1)}${pass('b', 1 + D)}<feBlend in="r" in2="g" mode="screen" result="rg"/><feBlend in="rg" in2="b" mode="screen"/>`
    : `${img}<feDisplacementMap in="SourceGraphic" in2="map" scale="${S.toFixed(4)}" xChannelSelector="R" yChannelSelector="G"/>`;
  defs(doc).append(f);
  return `url(#${id})`;
}

let lensBuilt = null;
/** مرشح العدسة الواحد لكل الأحجام: انحناء ~7px ساكنة ويثخن مع الحجم (~14px مرفوعة). */
function ensureLensFilter(doc, tier) {
  if (lensBuilt === tier && doc.getElementById('g-lens')) return;
  const url = glassFilter(doc, 'g-lens', lensMap(doc, 160, { bevel: 0.5, magnify: 0.25 }), 14 / 40, 1, tier);
  if (url) doc.documentElement.style.setProperty('--g-lens-f', `${url} saturate(1.6) brightness(1.1)`);
  lensBuilt = tier;
}

/** مرشحات كبسولات الشريط بمقاساتها (v9): انحناء 6px في حافة 12px، ونصف التشتت، وضباب 1.5px. */
export function capFilters(caps, { doc = caps[0]?.ownerDocument ?? globalThis.document } = {}) {
  const tier = doc?.documentElement?.dataset.glassTier;
  caps.forEach((cap, k) => {
    if (tier !== 'a' && tier !== 'b') { cap.style.removeProperty('--g-cap-f'); return; }
    const w = cap.offsetWidth, h = cap.offsetHeight;
    if (!w || !h) return;
    const url = glassFilter(doc, `g-cap${k}`, capMap(doc, w, h, 28, 12), 12 / w, 0.5, tier);
    if (url) cap.style.setProperty('--g-cap-f', `${url} blur(1.5px) saturate(1.7) brightness(1.05)`);
  });
}

// ── م2 لبقية الأسطح (الخطة 1 و8): مرشح لكل عائلة تشتت × شكل، بوحدات الصندوق فيعمل لأي مقاس قريب من شكله ──
// العائلات: التنقل والأزرار 26، والقارئ 14، والمشغّل 10. الأشكال: دائرة (زر 40)، وكبسولة (~160)، وشريط عريض (~360).
// القوة نسبة من العرض، فضُبطت لكل شكل على مقاسه النموذجي ليبقى انحناء الحافة ~6px.
export const FAMILIES = Object.freeze({ nav: 1, reader: 14 / 26, player: 10 / 26 });
const SHAPES = Object.freeze({
  c: { map: (doc) => lensMap(doc, 96, { bevel: 0.45, magnify: 0 }), S: 10 / 40 },
  p: { map: (doc) => capMap(doc, 160, 48, 24, 12), S: 12 / 160 },
  b: { map: (doc) => capMap(doc, 360, 56, 28, 12), S: 12 / 360 },
});
const FAMILY_VARS = Object.keys(FAMILIES).flatMap((f) => Object.keys(SHAPES).map((sh) => `--g-m2${sh}-${f}`));
let familiesBuilt = null;
function ensureFamilyFilters(doc, tier) {
  if (familiesBuilt === tier && doc.getElementById('g-m2c-nav')) return;
  const maps = Object.fromEntries(Object.entries(SHAPES).map(([k, v]) => [k, v.map(doc)]));
  for (const [family, spread] of Object.entries(FAMILIES)) {
    for (const [sh, { S }] of Object.entries(SHAPES)) {
      const url = glassFilter(doc, `g-m2${sh}-${family}`, maps[sh], S, spread, tier);
      if (url) doc.documentElement.style.setProperty(`--g-m2${sh}-${family}`, `${url} blur(1.5px) saturate(1.7) brightness(1.05)`);
    }
  }
  familiesBuilt = tier;
}


// ── عدسة الأقسام المجزأة (قرار المالك: تبويبات السينما فوق البطل، ومكتبتي والأصدقاء، وأقسام الشريط الجانبي) ──
// عدسة م1 تنزلق بانتقال CSS (لا حركة من JavaScript إطارًا بإطار): JS يكتب الموضع والمقاس فقط حين يتغير المحدد.
// تحفظ آخر موضع لكل مجموعة، فإعادة بناء الألسنة (renderLibrary وkindTabs يبنيانها من جديد) تنزلق ولا تقفز.
// في الكمبيوتر: مرور الفأرة يميل العدسة قليلًا نحو العنصر دون تغيير المحدد.
const TAB_GROUPS = Object.freeze([
  { sel: '.social-tabs', item: '.social-tab', fill: true },
  { sel: '.library-tabs', item: '.library-tab', padX: 12, h: 34 },
  { sel: '.cn-kinds', item: '.cn-kind', padX: 12, h: 32 },
  { sel: '.mw-tabs', item: 'button', padX: 12, h: 34 },
  { sel: '.uv-tabs', item: 'button', padX: 12, h: 34 },
  { sel: '.drawer-sections', item: '.drawer-section', fill: true, tone: true },
]);
const TAB_SEL = TAB_GROUPS.map((g) => g.sel).join(',');
const ACTIVE = '.active, .on, [aria-selected="true"], [aria-checked="true"], [aria-pressed="true"]';
const lastSpot = new Map();
let tabsObserver = null, tabsResize = null, tabsQueued = false;

function placeTab(group, box) {
  const g = TAB_GROUPS.find((x) => box.matches(x.sel));
  if (!g || !box.isConnected) return;
  const items = [...box.querySelectorAll(`:scope > ${g.item}`)].filter((n) => !n.hidden);
  const active = items.find((n) => n.matches(ACTIVE));
  let ind = box.querySelector(':scope > .g-seg');
  if (!active || !active.offsetWidth) { if (ind) ind.dataset.off = ''; return; }
  const key = `${g.sel}@${box.closest('.page, .drawer, .dock')?.id ?? ''}`;
  if (!ind) {
    ind = box.ownerDocument.createElement('span');
    ind.className = 'g-seg';
    ind.setAttribute('aria-hidden', 'true');
    ind.dataset.init = '';
    box.prepend(ind);
    const prev = lastSpot.get(key);
    if (prev) for (const [k, v] of Object.entries(prev)) ind.style.setProperty(k, v);
    tabsResize?.observe(box);
  }
  const w = g.fill ? active.offsetWidth : active.offsetWidth + 2 * g.padX;
  const h = g.fill ? active.offsetHeight : g.h;
  const spot = {
    '--sx': `${active.offsetLeft + (active.offsetWidth - w) / 2}px`,
    '--sy': `${active.offsetTop + (active.offsetHeight - h) / 2}px`,
    '--sw': `${w}px`,
    '--sh': `${h}px`,
  };
  if (g.tone) spot['--tint'] = box.ownerDocument.defaultView?.getComputedStyle?.(active)?.getPropertyValue('--tone')?.trim() || 'var(--accent)';
  delete ind.dataset.off;
  const apply = () => { for (const [k, v] of Object.entries(spot)) ind.style.setProperty(k, v); lastSpot.set(key, spot); };
  if ('init' in ind.dataset && !lastSpot.has(key)) { apply(); (box.ownerDocument.defaultView?.requestAnimationFrame ?? globalThis.requestAnimationFrame)?.(() => delete ind.dataset.init); }
  else { delete ind.dataset.init; apply(); }
}
function placeAll(doc) {
  tabsQueued = false;
  for (const box of doc.querySelectorAll(TAB_SEL)) placeTab(null, box);
}
const queueTabs = (doc) => { if (!tabsQueued) { tabsQueued = true; queueMicrotask(() => placeAll(doc)); } };
const hoverNudge = (e) => {
  const box = e.target.closest?.(TAB_SEL);
  const ind = box?.querySelector(':scope > .g-seg');
  if (!ind) return;
  const g = TAB_GROUPS.find((x) => box.matches(x.sel));
  const item = e.target.closest?.(`${g.sel} > ${g.item}`);
  const active = box.querySelector(`:scope > ${g.item}:is(${ACTIVE})`);
  if (!item || !active || item === active || e.type === 'pointerout') return ind.style.setProperty('--hx', '0px');
  const d = (item.offsetLeft + item.offsetWidth / 2) - (active.offsetLeft + active.offsetWidth / 2);
  ind.style.setProperty('--hx', `${(d * 0.12).toFixed(1)}px`);
};

/** يربط عدسة الأقسام المجزأة في Glass، ويفكها ويزيل عدساتها حين يرجع المظهر الحالي. */
export function bindGlassTabs(doc = globalThis.document, on = doc?.documentElement?.dataset?.material === 'glass') {
  const win = doc?.defaultView ?? globalThis;
  if (!on) {
    tabsObserver?.disconnect(); tabsObserver = null;
    tabsResize?.disconnect(); tabsResize = null;
    doc?.removeEventListener?.('pointerover', hoverNudge, true);
    doc?.removeEventListener?.('pointerout', hoverNudge, true);
    doc?.querySelectorAll?.('.g-seg').forEach((n) => n.remove());
    return;
  }
  if (tabsObserver) return queueTabs(doc);
  const MO = win.MutationObserver ?? globalThis.MutationObserver;
  if (typeof MO !== 'function' || !doc.body) return;
  tabsObserver = new MO((records) => {
    for (const r of records) {
      const t = r.target;
      if (t.closest?.(TAB_SEL) || (r.type === 'childList' && [...r.addedNodes].some((n) => n.nodeType === 1 && (n.matches?.(TAB_SEL) || n.querySelector?.(TAB_SEL))))) return queueTabs(doc);
    }
  });
  tabsObserver.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-selected', 'aria-checked', 'aria-pressed', 'hidden'] });
  tabsResize = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(() => queueTabs(doc)) : null;
  if (win.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches) {
    doc.addEventListener('pointerover', hoverNudge, true);
    doc.addEventListener('pointerout', hoverNudge, true);
  }
  queueTabs(doc);
}
