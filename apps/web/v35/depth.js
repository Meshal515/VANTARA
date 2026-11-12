/**
 * العمق مع التمرير — ملف واحد لكل الأنماط في كل الأقسام (قرار المالك، 12 نوفمبر).
 *
 * كل نمط صف في DEPTH_SPECS: طبقات تتحرك مع تمرير الصفحة (translate/z/دوران/تكبير/شفافية).
 * محرك واحد يولّد منها:
 *  - CSS بخط زمني للتمرير (animation-timeline: scroll(root)) يجري على المؤلِّف مع الإصبع، لا متأخرًا
 *    إطارًا كما يحدث بجافاسكربت في WebView أندرويد (التمرير على خيط مستقل).
 *  - طبقات collapse-hero لما بعد رفع الإصبع (الانزلاق)، بالأرقام نفسها حرفيًا.
 * الدخول والخروج والتبديل ليست هنا: page-motion.js. والصفحة المغادرة تتجمّد حركاتها هناك، فلا يحتاج
 * أي نمط استثناءً.
 *
 * طبقة العمق لا تشارك عنصرها حركة دخول: خاصية animation واحدة للعنصر، فحركة الدخول على العنصر نفسه
 * تُسقط العمق أو يُسقطها. لذلك عمق «المعرض» على حاوية الغلاف (.mw-lift) ودخوله على الغلاف نفسه.
 */
import { bindCollapsingHero } from './collapse-hero.js';

export const DEPTH_SPECS = Object.freeze({
  anime: Object.freeze({
    // «الأساسي»: البنر ينطوي للخلف ويغيب، والغلاف يصعد ويميل ويصغر، واللوقو يتبعه بفارق
    core: [
      { sel: '.aw-bg', at: 'hero', span: true, p: 900, y: [0, 0.42], z: [0, -140], rx: [0, 34], s: [1, 1.14], o: [1, 0] },
      { sel: '.aw-cover', range: [0, 0.52], p: 800, y: [0, -40], z: [0, -90], rx: [0, 38], s: [1, 0.84], o: [1, 0], hold: 0.45 },
      { sel: '.aw-stage .an-mark', range: [0.04, 0.6], p: 700, y: [0, -26], z: [0, -60], rx: [0, 46], s: [1, 0.86], o: [1, 0], hold: 0.4 },
    ],
  platform: [
    { sel: '.aw-bg', at: 'hero', span: true, y: [0, 0.35], s: [1, 1.05], o: [1, 0.4] },
    { sel: '.wl-htxt', range: [0, 0.4], y: [0, -20], o: [1, 0] },
  ],
  card: [
    { sel: '.aw-bg', at: 'hero', span: true, y: [0, 0.25] },
    { sel: '.wl-stage3d > .wl-card', range: [0, 0.45], p: 900, y: [0, -24], z: [0, 30], rx: [6, 0], ry: [-18, 0] },
  ],
  screen: [
    { sel: '.aw-hero', at: 'self', range: [0, 0.6], p: 1000, y: [0, 40], z: [0, -260], rx: [0, 4], s: [1, 0.92], o: [1, 0.15] },
    { sel: '.wl-top .wl-cover', range: [0, 0.38], y: [0, -16] },
  ],
  episode: [
    { sel: '.aw-hero', at: 'self', range: [0, 0.4], p: 900, y: [0, 30], z: [0, -60], rx: [0, 7], s: [1, 0.95], o: [1, 0.3] },
    { sel: '.wl-now', range: [0, 0.4], o: [1, 0.4] },
  ],
}),
  // السينما: الصورة تنزل بنصف سرعة الصفحة وتكبر فتغوص خلفها (كان cn-art-depth وheroFrame بنسختين)
  cinema: Object.freeze({
    current: [{ sel: '.cn-detail-art > .cn-img', span: true, y: [0, 0.5], s: [1, 1.12] }],
    premiere: [{ sel: '.cn-detail-art > .cn-img', span: true, y: [0, 0.5], s: [1, 1.12] }],
    marquee: [{ sel: '.cn-detail-art > .cn-img', span: true, y: [0, 0.5], s: [1, 1.12] }],
    // «الملصق» بشخصيته (قرار المالك): خلفية هادئة تتحرك 24px وتكبر ×1.03 فقط، بدل 240px و×1.12
    poster: [{ sel: '.cn-detail-art > .cn-img', span: true, px: true, y: [0, 24], s: [1, 1.03] }],
  }),
  // المانجا (قرار المالك، 12 نوفمبر): لكل نمط شخصيته مع التمرير، بالمحرك نفسه. الطبقات حاويات لا تحمل
  // حركة دخول (الغلاف والبنر يدخلان بحركتهما في manga.css)، فلا يُسقط أحدهما الآخر.
  manga: Object.freeze({
    // «كلاسيكي»: كتاب يُغلق؛ الغلاف ينعطف جانبًا ويتراجع، والضوء خلفه يتأخر ويخفت
    page: [
      { sel: '.detail-glow', span: true, y: [0, 0.4], o: [1, 0.35] },
      { sel: '.detail-head > .detail-cover', range: [0, 0.4], p: 900, y: [0, -10], z: [0, -120], ry: [0, -16] },
    ],
    // «المعرض»: الغلاف يميل للخلف ويتراجع كصفحة تُطوى (أرقامه السابقة)
    gallery: [{ sel: '.mw-stage > .mw-lift', range: [0, 0.45], p: 1000, y: [0, -22], z: [0, -175], rx: [0, 13] }],
    // «الملف»: البنر يتأخر عن الصفحة ويكبر خلفها، وصف الهوية يقترب نحوك
    profile: [
      { sel: '.mw-ban', at: 'self', span: true, y: [0, 0.45], s: [1, 1.08] },
      { sel: '.mw-idrow', range: [0, 0.35], p: 900, y: [0, -14], z: [0, 60] },
    ],
    // «من حيث وقفت»: البطاقة تنقلب للخلف كورقة في رزمة، ورقم الفصل يكبر نحوك
    resume: [
      { sel: '.mw-resume', at: 'self', range: [0, 0.4], p: 900, rx: [0, -12], z: [0, -90], o: [1, 0.5] },
      { sel: '.mw-resume .mw-big', range: [0, 0.3], y: [0, -6], s: [1, 1.12] },
    ],
    // «ويبتوني»: الفن الطولي يُقرأ كشريط؛ ينزلق أبطأ من الصفحة ويكبر قليلًا، والاسم فوقه يصعد ويغيب
    webtoon: [
      { sel: '.mw-stage > .mw-lift', at: 'hero', span: true, y: [0, 0.35], s: [1, 1.04] },
      { sel: '.mw-stage > .mw-center', range: [0, 0.3], y: [0, -30], o: [1, 0] },
    ],
  }),
});

const lerpN = (a, b, t) => a + (b - a) * t;
export function layerValue(l, t, span) {
  // span: المدى ارتفاع البطل والإزاحة نسبة منه؛ px: الإزاحة بالبكسل كما هي ولو كان المدى ارتفاع البطل
  const k = l.span && !l.px ? span : 1;
  const v = (pair, d) => (pair ? lerpN(pair[0], pair[1], t) : d);
  const transform = `perspective(${l.p ?? 1000}px) translate3d(0px, ${(v(l.y, 0) * k).toFixed(1)}px, ${v(l.z, 0).toFixed(1)}px) rotateX(${v(l.rx, 0).toFixed(2)}deg) rotateY(${v(l.ry, 0).toFixed(2)}deg) scale(${v(l.s, 1).toFixed(4)})`;
  // hold: الشفافية ثابتة حتى نسبة hold من المدى ثم تخفت خطيًا (الغلاف واللوقو في «الأساسي»)
  const fade = l.hold == null || t <= l.hold ? (l.hold == null ? t : 0) : (t - l.hold) / (1 - l.hold);
  return { transform, opacity: l.o ? lerpN(l.o[0], l.o[1], fade) : 1 };
}

/**
 * طبقات collapse-hero لنمط، وقواعد CSS المطابقة لها (تُحقن في <style>).
 * span = ارتفاع البطل بالبكسل، vh = ارتفاع الشاشة؛ المدى بالبكسل كي يطابق مسار JS حرفيًا.
 * `scope` محدد صفحة النمط في القسم (الأنمي: `.v35 .aw[data-style='<look>']`).
 */
export function depthMotion(section, look, { hero, dims, scope, hostOf = (h) => h?.closest('.aw'), prefix = 'wl' }) {
  const spec = DEPTH_SPECS[section]?.[look] ?? [];
  const nodeOf = (l) => () => (l.at === 'self' ? hero : l.at === 'hero' ? hero?.querySelector(l.sel) : hostOf(hero)?.querySelector(l.sel));
  // الأبعاد تُقرأ في كل مرة: البطل يتغيّر ارتفاعه حين تصل صورته، فيُعاد توليد CSS بالأرقام نفسها
  const rangeOf = (l) => (l.span ? [0, dims.span] : l.range.map((r) => Math.round(r * dims.vh)));
  const layers = spec.map((l) => ({ node: nodeOf(l), range: () => rangeOf(l), at: (t) => layerValue(l, t, dims.span) }));
  const css = () => `@supports (animation-timeline: scroll()){@media (prefers-reduced-motion: no-preference){${spec.map((l, i) => {
    const span = dims.span;
    const name = `${prefix}-${look}-${i}`;
    const [a, b] = rangeOf(l);
    const from = layerValue(l, 0, span);
    const to = layerValue(l, 1, span);
    const sel = l.at === 'self' ? `${scope} ${l.sel === '.aw-hero' ? '> .aw-hero' : l.sel}` : `${scope} ${l.sel}`;
    const hold = l.hold == null ? '' : `${Math.round(l.hold * 100)}%{opacity:${from.opacity}}`;
    return `@keyframes ${name}{from{transform:${from.transform};opacity:${from.opacity}}${hold}to{transform:${to.transform};opacity:${to.opacity}}}
html:not([data-motion='off']) ${sel}{animation:${name} linear both;animation-timeline:scroll(root block);animation-range:${a}px ${Math.max(a + 1, b)}px}`;
  }).join('\n')}}}`;
  return { layers, css };
}

/** الأنمي كما كان (work-looks.js يصدّرها بالاسم نفسه). */
export const lookMotion = (look, { hero, dims }) => depthMotion('anime', look, { hero, dims, scope: `.v35 .aw[data-style='${look}']` });

/**
 * يركّب عمق نمط على صفحته: يحقن CSS الخط الزمني في <style id> واحدة للقسم، يعيد توليدها حين يتغيّر ارتفاع
 * البطل أو الشاشة، ويربط تسليم الانزلاق (collapse-hero). نمط بلا صف في الجدول لا يحرّك شيئًا ولا يسجّل
 * مستمعًا. الأقسام الثلاثة تمر من هنا: لا نسخة ربط لكل قسم.
 * @param {{ hero: HTMLElement, bar?: HTMLElement|null, scope: string, styleId: string, spanOf: () => number, active: () => boolean, hostOf?: Function, prefix?: string }} o
 * @returns {() => void} فكّ الربط
 */
export function mountDepth(section, look, { hero, bar = null, scope, styleId, spanOf, active, hostOf, prefix }) {
  const doc = hero?.ownerDocument ?? globalThis.document;
  let tag = doc.getElementById(styleId);
  if (!tag) {
    tag = doc.createElement('style');
    tag.id = styleId;
    doc.head.append(tag);
  }
  if (!DEPTH_SPECS[section]?.[look]?.length) {
    tag.textContent = '';
    // الشريط ينطوي مع البطل حتى في نمط بلا طبقات عمق
    return bar ? bindCollapsingHero({ hero, bar, active }) : () => {};
  }
  const dims = { span: spanOf() || 300, vh: globalThis.innerHeight || 800 };
  const motion = depthMotion(section, look, { hero, dims, scope, ...(hostOf ? { hostOf } : {}), ...(prefix ? { prefix } : {}) });
  tag.textContent = motion.css();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    const next = { span: spanOf() || dims.span, vh: globalThis.innerHeight || dims.vh };
    if (next.span === dims.span && next.vh === dims.vh) return;
    Object.assign(dims, next);
    tag.textContent = motion.css();
  }) : null;
  ro?.observe(hero);
  const unbind = bindCollapsingHero({ hero, bar, layers: motion.layers, active });
  return () => { ro?.disconnect(); unbind(); };
}
