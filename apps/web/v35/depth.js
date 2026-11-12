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
 */
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
});

const lerpN = (a, b, t) => a + (b - a) * t;
export function layerValue(l, t, span) {
  const k = l.span ? span : 1;
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
    const sel = l.at === 'self' ? `${scope} > .aw-hero` : `${scope} ${l.sel}`;
    const hold = l.hold == null ? '' : `${Math.round(l.hold * 100)}%{opacity:${from.opacity}}`;
    return `@keyframes ${name}{from{transform:${from.transform};opacity:${from.opacity}}${hold}to{transform:${to.transform};opacity:${to.opacity}}}
html:not([data-motion='off']) ${sel}{animation:${name} linear both;animation-timeline:scroll(root block);animation-range:${a}px ${Math.max(a + 1, b)}px}`;
  }).join('\n')}}}`;
  return { layers, css };
}

/** الأنمي كما كان (work-looks.js يصدّرها بالاسم نفسه). */
export const lookMotion = (look, { hero, dims }) => depthMotion('anime', look, { hero, dims, scope: `.v35 .aw[data-style='${look}']` });
