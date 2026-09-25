/**
 * أقسام VANTARA — هيكل واحد، وهوية لكل قسم.
 *
 * القشرة (الترويسة، التنقّل، الأوراق، الملف) واحدة في كل الأقسام، ويتغيّر
 * فوقها ما يخصّ القسم: الألوان كلها من متغيّرات `[data-section]` في
 * `core.css`، والمسمّيات (فصل/حلقة، اقرأ/شاهد) من هنا، والرئيسية لكل قسم
 * بتركيبها: المانجا أغلفة طولية، والأنمي بانرات عريضة وحلقات.
 */

export const SECTIONS = {
  manga: { id: 'manga', word: 'MANGA', sub: 'مانجا · مانهوا', ready: true, unit: 'فصل', verb: 'اقرأ', theme: '#08070c' },
  anime: { id: 'anime', word: 'ANIME', sub: 'مسلسلات · أفلام', ready: true, unit: 'حلقة', verb: 'شاهد', theme: '#05070d' },
  cinema: { id: 'cinema', word: 'CINEMA', sub: 'قريبًا', ready: false, unit: 'فيلم', verb: 'شاهد', theme: '#0b0806' },
};

const KEY = 'vantara.section';

/** القسم المحفوظ، والمانجا إن لم يُحفظ شيء أو حُفظ قسم لم يجهز. */
export function readSection(storage = globalThis.localStorage) {
  try {
    const id = storage?.getItem(KEY);
    return SECTIONS[id]?.ready ? id : 'manga';
  } catch {
    return 'manga';
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
