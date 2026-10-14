/**
 * أقسام VANTARA — هيكل واحد، وهوية لكل قسم.
 *
 * القشرة (الترويسة، التنقّل، الأوراق، الملف) واحدة في كل الأقسام، ويتغيّر
 * فوقها ما يخصّ القسم: الألوان كلها من متغيّرات `[data-section]` في
 * `core.css`، والمسمّيات (فصل/حلقة، اقرأ/شاهد) من هنا، والرئيسية لكل قسم
 * بتركيبها: المانجا أغلفة طولية، والأنمي بانرات عريضة وحلقات.
 */

import { isDesktop } from '../pwa/platform.js';

export const SECTIONS = {
  manga: { id: 'manga', word: 'MANGA', sub: 'مانجا · مانهوا', ready: true, unit: 'فصل', verb: 'اقرأ', theme: '#08070c' },
  anime: { id: 'anime', word: 'ANIME', sub: 'مسلسلات · أفلام', ready: true, unit: 'حلقة', verb: 'شاهد', theme: '#05070d' },
  cinema: { id: 'cinema', word: 'CINEMA', sub: 'أفلام · مسلسلات', ready: true, unit: 'فيلم', verb: 'شاهد', theme: '#0a0707' },
};

const KEY = 'vantara.section';

/** القسم المحفوظ؛ السينما لويندوز عند أول دخول، والمانجا للمنصتين الحاليتين. */
export function readSection(storage = globalThis.localStorage, g = globalThis) {
  const initial = isDesktop(g) ? 'cinema' : 'manga';
  try {
    const id = storage?.getItem(KEY);
    return SECTIONS[id]?.ready ? id : initial;
  } catch {
    return initial;
  }
}

export function writeSection(id, storage = globalThis.localStorage) {
  if (!SECTIONS[id]?.ready) return false;
  try {
    storage?.setItem(KEY, id);
  } catch {
    // تخزين ممنوع (نافذة خاصة): القسم يبقى للجلسة فقط
  }
  return true;
}
