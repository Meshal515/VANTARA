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
 * يبدأ تجهيز الحلقة ويرجع فورًا: كل سيرفر من كل مصدر بحالته الآن
 * (`RESOLVING`/`READY`/`UNAVAILABLE`/`FAILED`)، وما يتغيّر بعدها يصل بحدث
 * `route` ({session, route})، ونهاية التجهيز بحدث `prepared`.
 */
export async function prepare({ copies, episode, quality = 1080, variant = 'SUB' }) {
  return (await call('prepare', { copies, episode, quality, variant })) ?? null;
}

export async function routes(session) {
  return (await call('routes', { session })) ?? null;
}

/** «شغّل الأفضل»: ينتظر أول سيرفر يجهز إن لم يجهز شيء بعد. */
export async function best(session, prefer = null, waitMs = 45_000) {
  return (await call('best', { session, prefer, waitMs })) ?? null;
}

/** أفضل رابط داخل سيرفر اختاره المستخدم. */
export async function pick(session, route) {
  return (await call('pick', { session, route }))?.candidate ?? null;
}

/** يفتح المشغّل الأصلي على جلسة مجهّزة (والسيرفر المختار إن وُجد). */
export async function open(args) {
  const plugin = bridge();
  if (!plugin) return null;
  await plugin.play(args);
  return true;
}

export const closeSession = (session) => call('closeSession', { session });

/** ما أرسله المشغّل (لحظات وترشيحات) ولم يصل المجلس بعد. يُفرَّغ بالقراءة. */
export async function outbox() {
  return (await call('outbox'))?.items ?? [];
}

// ───────────── نموذج ورقة السيرفرات (نفس قاعدة المشغّل الأصلي) ─────────────

const bucket = (q) => (q == null ? null : q >= 1000 ? 1080 : q >= 700 ? 720 : q >= 460 ? 480 : 360);
const ORDER = { READY: 0, RESOLVING: 1, FAILED: 2, UNAVAILABLE: 3 };

/** [[«1080p»، سيرفرات]…] من الأعلى، ثم غير المحددة، وغير المتاحة في الآخر. */
export function groupRoutes(list) {
  const usable = list.filter((r) => r.state !== 'UNAVAILABLE');
  const groups = new Map();
  for (const r of usable) {
    const b = bucket(r.quality);
    if (!groups.has(b)) groups.set(b, []);
    groups.get(b).push(r);
  }
  const out = [...groups.entries()]
    .sort((a, b) => (b[0] ?? -1) - (a[0] ?? -1))
    .map(([b, rs]) => [b == null ? 'جودة غير محددة' : `${b}p`, rs.sort((x, y) => ORDER[x.state] - ORDER[y.state])]);
  const dead = list.filter((r) => r.state === 'UNAVAILABLE');
  if (dead.length) out.push(['غير متاح', dead]);
  return out;
}

/** يدمج تحديث سيرفر في القائمة مكانه (أو يضيفه آخرها). */
export function upsertRoute(list, route) {
  const i = list.findIndex((r) => r.id === route.id);
  if (i < 0) return [...list, route];
  const next = list.slice();
  next[i] = route;
  return next;
}

/** «12:10» من الملّي ثانية. */
export function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** عنوان اللحظة في المجلس، ومنه تُقرأ بدايتها عند صديقك. */
export const momentLabel = (episode, startMs, endMs) => `الحلقة ${episode} · ${clock(startMs)}–${clock(endMs)}`;

export function momentStart(label) {
  const m = /·\s*(\d+(?::\d{2}){1,2})\s*[–-]/.exec(String(label ?? ''));
  if (!m) return null;
  return m[1].split(':').reduce((acc, part) => acc * 60 + Number(part), 0) * 1000;
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
