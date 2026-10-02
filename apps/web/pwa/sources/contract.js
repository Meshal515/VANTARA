/**
 * عقد مصادر الويب الموحّد — لكل الأقسام الثلاثة.
 *
 *   مانجا:          search · popular · latest → { mangas, hasNextPage }
 *                   series(manga) → { manga, chapters } · pages(chapter) → [{index,url,imageUrl}]
 *   أنمي وسينما:    search(query) → [{url,title,thumbnail}]
 *                   episodes(item) → [{url,name,number}] · servers(episode) → [{name,url,referer}]
 *                   streams(server) → [{url,type:'hls'|'mp4',quality,referer,proxy}]
 *
 * التعريف (SourceDef) بيانات فقط: { id, label, content, engine, version, domain, config, probe }.
 * هنا التحقق من الاثنين: تعريف غير صالح لا يُحمَّل، ونتيجة مخالفة للعقد تُعامل كفشل.
 */

export const CONTENTS = Object.freeze(['manga', 'anime', 'cinema']);

const DOMAIN = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/** أخطاء التعريف (فارغة = صالح). `engines`: أسماء المحركات المتاحة. */
export function defErrors(def, engines) {
  const errors = [];
  if (!def || typeof def !== 'object') return ['ليس كائنًا'];
  if (typeof def.id !== 'string' || def.id.length < 3) errors.push('id');
  if (typeof def.label !== 'string' || !def.label) errors.push('label');
  if (!CONTENTS.includes(def.content)) errors.push('content');
  if (!engines.includes(def.engine)) errors.push(`engine:${def.engine}`);
  if (!Number.isInteger(def.version) || def.version < 1) errors.push('version');
  if (typeof def.domain !== 'string' || !DOMAIN.test(def.domain)) errors.push('domain');
  if (def.config !== undefined && (typeof def.config !== 'object' || Array.isArray(def.config))) errors.push('config');
  return errors;
}

/** بصمة ثابتة للتعريف (لكشف تعديل بلا رفع الإصدار). */
export function defHash(def) {
  const stable = (v) => (Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v);
  const s = JSON.stringify(stable(def));
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16);
}

const isText = (v) => typeof v === 'string' && v.trim().length > 0;

export function validManga(m) {
  return Boolean(m && isText(m.url) && isText(m.title));
}

export function validChapter(c) {
  return Boolean(c && isText(c.url) && typeof c.name === 'string');
}

export function validPage(p) {
  return Boolean(p && Number.isInteger(p.index) && /^https?:\/\//.test(String(p.imageUrl ?? '')));
}

/** يرفض نتيجة لا تطابق العقد بدل تمرير بيانات مكسورة للواجهة. */
export function checkListing(out) {
  if (!out || !Array.isArray(out.mangas)) throw new Error('نتيجة قائمة مخالفة للعقد');
  return { mangas: out.mangas.filter(validManga), hasNextPage: Boolean(out.hasNextPage) };
}

export function checkSeries(out) {
  if (!out || !validManga(out.manga) || !Array.isArray(out.chapters)) throw new Error('تفاصيل مخالفة للعقد');
  return { manga: out.manga, chapters: out.chapters.filter(validChapter) };
}

export function checkPages(list) {
  if (!Array.isArray(list)) throw new Error('صفحات مخالفة للعقد');
  return list.filter(validPage);
}
