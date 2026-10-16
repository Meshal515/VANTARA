/**
 * إضافة موقع مانجا برابطه (الويب والويندوز، حيث لا تعمل إضافات Mihon).
 *
 * أغلب مواقع المانجا العربية قوالب ووردبريس/بلوجر معروفة، ومحركاتنا تخدم كل قالب
 * (madara، mangathemesia، zeistmanga). نتعرّف على القالب من علاماته في الصفحة، ونبني
 * تعريف مصدر (SourceDef) بيانات فقط، ثم يمر بنفس فحص المصادر المشحونة (بحث ← تفاصيل
 * ← فصول ← صفحات) قبل أن يُضاف. لا كود من الموقع يعمل عندنا.
 */

const SIGNS = [
  // Madara: إضافة wp-manga في ووردبريس
  { engine: 'madara', any: [/wp-manga/i, /manga_get_chapters/i, /madara/i, /class="[^"]*c-blog-post/i] },
  // MangaThemesia: مجلد القالب mangareader وسكربتات tsfn/ts_reader وقوائم bsx/listupd
  { engine: 'mangathemesia', any: [/ts_reader/i, /mangathemesia/i, /themesia/i, /wp-content\/themes\/mangareader/i, /tsfn_/i, /class="[^"]*\blistupd\b/i, /class="[^"]*\bbsx\b/i] },
  // ZeistManga: قالب بلوجر (محركنا الوحيد لمواقع بلوجر)، وعلامة zeist تقوّيه
  { engine: 'zeistmanga', any: [/zeistmanga/i, /zeist/i], weighted: [[/blogger\.com|blogspot/i, 2]] },
];

/** محرك القالب من HTML الصفحة الرئيسية، أو null إن لم نعرفه. */
export function detectEngine(html) {
  const page = String(html ?? '');
  const scores = SIGNS.map((s) => ({
    engine: s.engine,
    score: s.any.filter((re) => re.test(page)).length + (s.weighted ?? []).reduce((sum, [re, w]) => sum + (re.test(page) ? w : 0), 0),
  }));
  const best = scores.filter((s) => s.score >= 1).sort((a, b) => b.score - a.score)[0];
  return best?.engine ?? null;
}

/** رابط يكتبه المستخدم ← أصل HTTPS نظيف. */
export function siteOrigin(input) {
  let raw = String(input ?? '').trim();
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  const url = new URL(raw);
  if (url.username || url.password || (url.port && url.port !== '443')) throw new Error('رابط الموقع غير صالح');
  if (!/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(url.hostname)) throw new Error('رابط الموقع غير صالح');
  return `https://${url.hostname.toLowerCase()}`;
}

/** اسم الموقع من <title> أو og:site_name، وإلا اسم المضيف. */
export function siteLabel(html, host) {
  const page = String(html ?? '');
  const og = /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{2,60})["']/i.exec(page)?.[1];
  const title = /<title[^>]*>([^<]{2,120})<\/title>/i.exec(page)?.[1];
  const raw = (og ?? title ?? host).replace(/\s+/g, ' ').trim();
  // «اسم الموقع – قراءة مانجا…» ← «اسم الموقع»
  return raw.split(/\s[|–—-]\s/)[0].slice(0, 40) || host;
}

/** أكثر مقطع مسار يسبق روابط الأعمال في الصفحة (/manga/x/ أو /serie/x/ …). */
function workPath(html, host) {
  const counts = new Map();
  const re = new RegExp(`(?:https?://${host.replace(/\./g, '\\.')})?/(manga|serie|series|manhwa|manhua|webtoon|webtoons|comics|komik|work)/[^/"'?#\\s]+/?["']`, 'gi');
  for (const m of String(html ?? '').matchAll(re)) counts.set(m[1].toLowerCase(), (counts.get(m[1].toLowerCase()) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * إعدادات تُجرَّب بالترتيب حتى ينجح الفحص: المواقع على نفس القالب تختلف في مسار
 * الأعمال وطريقة القائمة (التحميل التدريجي أو الأرشيف). أول ما ينجح يُحفظ.
 */
export function configVariants(engine, html, host) {
  const path = workPath(html, host);
  if (engine === 'madara') {
    const sub = path && path !== 'manga' ? { mangaSubString: path } : {};
    return [sub, { ...sub, listing: 'archive' }];
  }
  if (engine === 'mangathemesia') return path && path !== 'manga' ? [{ mangaDir: `/${path}` }, {}] : [{}];
  return [{}];
}

/** تعريف مصدر للموقع (بيانات فقط). المعرّف ثابت للمضيف فإعادة الإضافة تحدّثه. */
export function siteDef({ origin, html }) {
  const engine = detectEngine(html);
  if (!engine) throw new Error('لم نتعرّف على قالب هذا الموقع. المدعوم: Madara وMangaThemesia وZeistManga');
  const host = new URL(origin).hostname;
  return {
    id: `user.${host}`,
    label: siteLabel(html, host),
    content: 'manga',
    engine,
    version: 1,
    domain: host,
    config: {},
    user: true,
  };
}
