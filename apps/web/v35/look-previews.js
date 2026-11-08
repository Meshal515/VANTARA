/**
 * لقطات المعاينة في «المظهر والتخصيص»: صور حقيقية من التطبيق (قرار المالك: ليست معاينة حية)
 * بمقاس الشاشة: هاتف وآيباد وحاسب. تُولَّد بـ`tools/ui-previews/generate-look-previews.mjs`
 * وتُحفظ webp صغيرة في `apps/web/v35/looks/`. اختبار look-previews.test.js يفشل إن غابت لقطة لنمط معرّف.
 */

import { stylesOf } from './appearance.js';

export const PREVIEW_DIR = '/v35/looks';
export const VIEWPORTS = Object.freeze([
  { id: 'phone', width: 390, height: 844, out: 300 },
  { id: 'ipad', width: 820, height: 1180, out: 360 },
  { id: 'pc', width: 1440, height: 900, out: 480 },
]);
const SECTIONS = ['manga', 'anime', 'cinema'];

/** لقطة صفحة عمل بنمط معيّن. */
export const workPreview = (section, style, vp) => `${PREVIEW_DIR}/work-${section}-${style}-${vp}.webp`;
/** لقطة رئيسية القسم (ألوان الأقسام، وقوالب الشاشة، ومعاينة الاستقلال). */
export const homePreview = (section, vp) => `${PREVIEW_DIR}/home-${section}-${vp}.webp`;

/** كل لقطة يحتاجها الإعداد: لكل نمط معرّف في كل قسم، ولكل رئيسية، بالمقاسات الثلاثة. */
export function requiredPreviews() {
  const out = [];
  for (const section of SECTIONS) {
    for (const vp of VIEWPORTS) {
      out.push(homePreview(section, vp.id));
      for (const s of stylesOf(section)) out.push(workPreview(section, s.id, vp.id));
    }
  }
  // الرئيسية الموحدة (تصميم واحد للتوحيد، تُولَّد من التطبيق نفسه)
  for (const vp of VIEWPORTS) out.push(homePreview('unified', vp.id));
  return out;
}

/**
 * `<picture>` يختار لقطة الجهاز الحالي بعرض الشاشة: حاسب من 1100، آيباد من 700، وإلا هاتف.
 * @param {(p: string) => string} pathOf vp ← المسار
 */
export function previewPicture(doc, pathOf, alt = '') {
  const pic = doc.createElement('picture');
  for (const [vp, media] of [['pc', '(min-width: 1100px)'], ['ipad', '(min-width: 700px)']]) {
    const s = doc.createElement('source');
    s.media = media;
    s.srcset = pathOf(vp);
    pic.append(s);
  }
  const img = doc.createElement('img');
  img.src = pathOf('phone');
  img.alt = alt;
  img.loading = 'lazy';
  img.decoding = 'async';
  pic.append(img);
  return pic;
}
