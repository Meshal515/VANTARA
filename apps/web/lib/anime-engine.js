/**
 * جسر محرك الأنمي الأصلي (`AnimeEngine` في أندرويد).
 *
 * الواجهة لا تعرف مصدرًا ولا دومينًا ولا سيرفرًا: تطلب «هذا الأنمي، الحلقة 12»
 * والمحرك يجمع كل النسخ من كل المصادر ويرتّب كل طرق التشغيل ويتولّى التبديل.
 *
 * البيان (`/anime/sources.json`) يُقرأ من حزمة الويب نفسها، فيتحدّث مع كل
 * تحديث للواجهة بلا APK. وعلى الويب (بلا المحرك) تُرجع الدوال `null` بدل
 * بيانات تشبه الحقيقية: شاشة تقول «داخل التطبيق فقط» أصدق من شاشة مكسورة.
 */

const bridge = () => globalThis.Capacitor?.Plugins?.AnimeEngine ?? null;

export const available = () => bridge() !== null;

let configured = null;

/** يرسل البيان للمحرك مرة لكل تشغيل (أو من جديد إن طُلب). */
export function configure({ force = false, fetchImpl = globalThis.fetch } = {}) {
  const plugin = bridge();
  if (!plugin) return Promise.resolve(null);
  if (configured && !force) return configured;
  configured = (async () => {
    const res = await fetchImpl('/anime/sources.json', { cache: 'no-cache' });
    const manifest = await res.json();
    const out = await plugin.configure({ manifest });
    if (!out?.ok) throw new Error(`بيان المصادر مرفوض: ${(out?.errors ?? []).join('، ')}`);
    return manifest;
  })().catch((e) => {
    configured = null;
    throw e;
  });
  return configured;
}

async function call(method, args = {}) {
  const plugin = bridge();
  if (!plugin) return null;
  await configure();
  return plugin[method](args);
}

/** بحث موحّد: أعمال مدموجة، كل عمل بنسخه من كل المصادر مرتّبة بالصحة. */
export async function search(query, content = 'anime') {
  return (await call('search', { query, content }))?.works ?? null;
}

/** أفضل عمل يطابق عناوين أنمي AniList (إنجليزي/روماجي/أصلي). */
export async function findWork(titles) {
  const tried = new Set();
  for (const t of titles.filter(Boolean)) {
    const q = String(t).replace(/\s*\(.*?\)\s*/g, ' ').trim();
    if (!q || tried.has(q.toLowerCase())) continue;
    tried.add(q.toLowerCase());
    const works = await search(q);
    if (!works) return null;
    const hit = pickWork(works, titles);
    if (hit) return hit;
  }
  return null;
}

const fold = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** يختار العمل الذي يطابق أحد العناوين تمامًا بعد التطبيع، وإلا الأقرب. */
export function pickWork(works, titles) {
  const wanted = titles.filter(Boolean).map(fold);
  const exact = works.find((w) => w.copies.some((c) => wanted.includes(fold(c.title))));
  if (exact) return exact;
  const score = (w) => {
    const words = new Set(fold(w.title).split(' '));
    return Math.max(...wanted.map((t) => {
      const tw = t.split(' ').filter(Boolean);
      return tw.length ? tw.filter((x) => words.has(x)).length / Math.max(tw.length, words.size) : 0;
    }));
  };
  const best = works.map((w) => [w, score(w)]).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 0.75 ? best[0] : null;
}

export async function episodes(anime) {
  return (await call('episodes', { anime }))?.episodes ?? null;
}

/**
 * يفتح جلسة الحلقة (كل النسخ ← كل السيرفرات) ويشغّلها في المشغّل الأصلي.
 * يرجع عدد طرق التشغيل التي وُجدت.
 */
export async function play({ copies, episode, title, position = 0, quality = 1080, variant = 'SUB' }) {
  const out = await call('streams', { copies, episode, quality, variant });
  if (!out) return null;
  const count = out.candidates?.length ?? 0;
  if (count) await bridge().play({ session: out.session, title, position });
  return { session: out.session, count };
}

export async function sources() {
  return (await call('sources'))?.sources ?? null;
}

export async function health() {
  return (await call('health'))?.records ?? null;
}

export const unblock = (key) => call('unblock', { key });

/** فحص مصدر خطوة خطوة: [{label, state: ok|warn|fail, detail}]. */
export async function diagnose(sourceId, query) {
  return (await call('diagnose', { sourceId, query }))?.steps ?? null;
}
export const crawl = (sourceId) => call('crawl', { sourceId });
export const stopCrawl = (sourceId) => call('stopCrawl', { sourceId });

/** يستمع لتقدّم المشغّل (سجل المشاهدة) وتقدّم الحلب. يرجع دالة الإلغاء. */
export function on(event, handler) {
  const plugin = bridge();
  if (!plugin?.addListener) return () => {};
  const handle = plugin.addListener(event, handler);
  return () => Promise.resolve(handle).then((h) => h?.remove?.());
}
