/**
 * عمق أعلى صفحة عمل الأنمي مع التمرير: البنر ينطوي للخلف ويغيب، والغلاف يصعد ويميل ويصغر،
 * واللوقو يتبعه بفارق. هذه المعادلات نفسها في anime.css (aw-banner-out / aw-cover-out /
 * aw-mark-out): CSS يحرّكها مع الإصبع، وهذه تُكتب أثناء الانزلاق بعد رفعه (collapse-hero.js).
 * أي تغيير هنا يُغيَّر هناك بنفس الأرقام، والاختبار يقارن بينهما.
 */
import { lerp } from './collapse-hero.js';

const f1 = (n) => n.toFixed(1);
const f2 = (n) => n.toFixed(2);
const f4 = (n) => n.toFixed(4);
/** شفافية ثابتة حتى `hold` ثم تخفت خطيًا إلى الصفر (keyframe عند hold في CSS). */
const fadeAfter = (t, hold) => (t <= hold ? 1 : 1 - (t - hold) / (1 - hold));

export const DEPTH = {
  banner: { perspective: 900, y: 0.42, z: -140, rx: 34, scale: 1.14 },
  cover: { perspective: 800, y: -40, z: -90, rx: 38, scale: 0.84, hold: 0.45, range: [0, 0.52] },
  mark: { perspective: 700, y: -26, z: -60, rx: 46, scale: 0.86, hold: 0.4, range: [0.04, 0.6] },
};

const tilt = (d, t, y) =>
  `perspective(${d.perspective}px) translate3d(0, ${f1(y)}px, ${f1(lerp(0, d.z, t))}px) rotateX(${f2(lerp(0, d.rx, t))}deg) scale(${f4(lerp(1, d.scale, t))})`;

export const bannerAt = (t, span) => ({ transform: tilt(DEPTH.banner, t, lerp(0, span * DEPTH.banner.y, t)), opacity: 1 - t });
export const coverAt = (t) => ({ transform: tilt(DEPTH.cover, t, lerp(0, DEPTH.cover.y, t)), opacity: fadeAfter(t, DEPTH.cover.hold) });
export const markAt = (t) => ({ transform: tilt(DEPTH.mark, t, lerp(0, DEPTH.mark.y, t)), opacity: fadeAfter(t, DEPTH.mark.hold) });

/** طبقات collapse-hero للصفحة: المدى بالبكسل من ارتفاع البطل (span) وارتفاع الشاشة (vh). */
export function animeDepthLayers({ bg, cover, mark }) {
  return [
    { node: bg, range: (span) => [0, span], at: bannerAt },
    { node: cover, range: (_, vh) => DEPTH.cover.range.map((r) => r * vh), at: coverAt },
    { node: mark, range: (_, vh) => DEPTH.mark.range.map((r) => r * vh), at: markAt },
  ];
}
