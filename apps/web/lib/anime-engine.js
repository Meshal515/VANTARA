/**
 * جسر محرك الأنمي الأصلي (`AnimeEngine` في أندرويد).
 *
 * الواجهة لا تعرف مصدرًا ولا دومينًا ولا سيرفرًا: تطلب «هذا الأنمي، الحلقة 12»
 * والمحرك يجمع كل النسخ من كل المصادر ويرتّب كل طرق التشغيل ويتولّى التبديل.
 *
 * البيان (`/anime/sources.json`) يُقرأ من حزمة الويب نفسها، فيتحدّث مع كل
 * تحديث للواجهة بلا APK. وعلى الويب (بلا المحرك) تُرجع الدوال `null` بدل
 * بيانات تشبه الحقيقية: شاشة تقول «داخل التطبيق فقط» أصدق من شاشة مكسورة.
 * والـPWA لها جسر حقيقي بنفس الواجهة: محركات ويب عبر جالب الويب.
 */

import { verifySourceDomains, nativeVerificationPlugin } from './source-verification.js';
import { addonCopies } from '../addons/video.js';
import { getAddonRuntime } from '../addons/runtime.js';
import { isNativeRuntimeCopy } from '../addons/cloudstream-runtime.js';
import { nativeAddonPreparation } from '../addons/native-preparation.js';
import { isNative, webPlugin, desktopPlugin } from '../pwa/platform.js';
import { withImdbEpisode } from './anime-imdb.js';
import { animeTitle } from './anime-title.js';
import { beginDiscovery, isDiscoveryDebug, setDiscoveryDebug } from './discovery-diagnostics.js';

// الجسر الأصلي، أو جسر الـPWA في المتصفح (pwa/bridges/anime.js)، أو null.
// داخل الـAPK `webPlugin()` يرجع null دائمًا.
const bridge = () => desktopPlugin('AnimeEngine') ?? globalThis.Capacitor?.Plugins?.AnimeEngine ?? webPlugin('AnimeEngine');

export const available = () => bridge() !== null;

/** A bridge/runtime promise that never settles must not block a work screen forever. */
export function withPhaseDeadline(promise, timeoutMs, code = 'PREPARE_STAGE_TIMEOUT', { signal } = {}) {
  let timer;
  let onAbort;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error('انتهت مهلة تجهيز السيرفرات');
        error.code = code;
        reject(error);
      }, timeoutMs);
    }),
    ...(signal ? [new Promise((_, reject) => {
      onAbort = () => reject(new DOMException('تم إلغاء تجهيز السيرفرات', 'AbortError'));
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    })] : []),
  ]).finally(() => {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  });
}

/**
 * بنر العمل وشعاره إلى كاش المشغّل الأصلي لحظة تجهيز السيرفرات، فتفتح شاشة التحميل بهما فورًا
 * بدل سواد ثم بنر ثم شعار. APK أقدم بلا الطريقة يرفض النداء فيُتجاهل؛ لا شيء ينتظره.
 */
export function warmArt(urls) {
  const list = [...new Set((urls ?? []).filter((u) => typeof u === 'string' && u.startsWith('https://')))];
  const plugin = globalThis.Capacitor?.Plugins?.AnimeEngine;
  if (!list.length || typeof plugin?.warmArt !== 'function') return;
  try { void Promise.resolve(plugin.warmArt({ urls: list })).catch(() => {}); } catch { /* تحسين لا شرط */ }
}

let configured = null;
const nativeAddonSessions = new Map();
const addonDiscoverySessions = new Map();
let nativeAddonLifecyclePlugin = null;
let nativeAddonLifecycleHandle = null;
function observeNativeAddonLifecycle(plugin) {
  if (!plugin.addListener || nativeAddonLifecyclePlugin === plugin) return;
  nativeAddonLifecycleHandle?.remove?.();
  nativeAddonLifecyclePlugin = plugin;
  const registered = plugin.addListener('sessionClosed', event => {
    const state = nativeAddonSessions.get(event.session);
    if (state && event.addonGeneration === state.generation) cancelNativeAddons(event.session);
  });
  Promise.resolve(registered).then(handle => {
    if (nativeAddonLifecyclePlugin === plugin) nativeAddonLifecycleHandle = handle;
    else handle?.remove?.();
  }).catch(() => { if (nativeAddonLifecyclePlugin === plugin) nativeAddonLifecyclePlugin = null; });
}
function cancelNativeAddons(session) {
  addonDiscoverySessions.delete(session);
  const state = nativeAddonSessions.get(session);
  if (!state) return;
  for (const job of state.jobs) job.cancel();
  state.snapshot?.release();
  nativeAddonSessions.delete(session);
}
function startNativeAddons(session, plan, plugin, state) {
  if (nativeAddonSessions.get(session) !== state) return;
  for (const source of plan.sourceIds) state.sources.add(source);
  const job = plan.start(session, plugin, { addonGeneration: state.generation });
  state.jobs.add(job);
  void job.done.catch(() => {}).finally(() => state.jobs.delete(job));
}

/** يرسل البيان للمحرك مرة لكل تشغيل (أو من جديد إن طُلب). */
export function configure({ force = false, fetchImpl = globalThis.fetch } = {}) {
  const plugin = bridge();
  if (!plugin) return Promise.resolve(null);
  if (configured && !force) return configured;
  configured = (async () => {
    const res = await fetchImpl('/anime/sources.json', { cache: 'no-cache' });
    const manifest = await res.json();
    const out = await plugin.configure({ manifest });
    setDiscoveryDebug(out?.debug === true);
    if (!out?.ok) throw new Error(`بيان المصادر مرفوض: ${(out?.errors ?? []).join('، ')}`);
    return manifest;
  })().catch((e) => {
    configured = null;
    throw e;
  });
  return configured;
}

async function call(method, args = {}, { signal } = {}) {
  const plugin = bridge();
  if (!plugin) return null;
  await configure();
  signal?.throwIfAborted();
  return plugin[method](args);
}

/** بحث موحّد: أعمال مدموجة، كل عمل بنسخه من كل المصادر مرتّبة بالصحة. */
export async function search(query, content = 'anime') {
  return (await call('search', { query, content }))?.works ?? null;
}

const humanListeners = new Set();
/**
 * مصدر يطلب من Cloudflare تحقق إنسان (الطلبات المخفية لا تستطيع حلّه):
 * `fn(sourceId)` لمتابعة الحالة بصمت. لا يُفتح تحقق أو إشعار تلقائي. يرجع دالة إلغاء الاشتراك.
 */
export function onNeedsHuman(fn) {
  humanListeners.add(fn);
  return () => humanListeners.delete(fn);
}

/** «تحقّق»: يُظهر صفحة تحقق المصدر بملء الشاشة، ثم يبحث فيه مرة. `{ok, error}`. */
export async function verify(sourceId) {
  try {
    if(nativeVerificationPlugin()){
      const sources=(await call('sources'))?.sources??[];
      const source=sources.find(s=>s.id===sourceId);
      return await verifySourceDomains({domains:[source?.domain].filter(Boolean),sourceName:source?.name,retry:()=>call('verify',{sourceId})});
    }
    return (await call('verify', { sourceId })) ?? { ok: false, error: 'المحرك غير متاح' };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/**
 * بحث متدفق: `onHit({sourceId, items, ms, error, skipped})` لكل مصدر لحظة يرد،
 * فأسرع مصدر يظهر بلا انتظار أبطئهم. يرجع `{done, cancel}`؛ `done` يكتمل بـtrue
 * حين يرد الجميع، أو null إن تعذّر البحث. محرك أقدم بلا البث يُغذّى من البحث
 * المجمّع (نفس الشكل، بزمن واحد للكل).
 */
export function searchStream(query, content = 'anime', onHit = () => {}, { timeoutMs = null, signal = undefined, diagnostic = null } = {}) {
  const plugin = bridge();
  if (!plugin) return { done: Promise.resolve(null), cancel() {} };
  const searchId = `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let handles = [];
  let settle;
  let over = false;
  const done = new Promise((r) => (settle = r));
  const end = (value) => {
    if (over) return;
    over = true;
    signal?.removeEventListener('abort', cancel);
    for (const h of handles) void Promise.resolve(h).then((x) => x?.remove?.());
    handles = [];
    settle(value);
  };
  const cancel = () => {
    if (over) return;
    try { void Promise.resolve(plugin.cancelSearch?.({ searchId })).catch(() => {}); } catch {}
    end(false);
  };
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  void (async () => {
    if (over) return;
    await configure();
    if (over) return;
    if (typeof plugin.searchStream !== 'function') {
      const t0 = Date.now();
      const works = await search(query, content).catch(() => null);
      if (!works) return end(null);
      const by = new Map();
      for (const c of works.flatMap((w) => w.copies ?? [])) by.set(c.sourceId, [...(by.get(c.sourceId) ?? []), c]);
      for (const [sourceId, items] of by) if (!over) onHit({ sourceId, items, ms: Date.now() - t0, error: null, skipped: false });
      return end(true);
    }
    // المستمعان قبل الطلب: أسرع مصدر قد يرد قبل أن يعود النداء نفسه
    const listen = async (name, fn) => {
      const handle = await plugin.addListener(name, fn);
      if (over) { handle?.remove?.(); return false; }
      handles.push(handle);
      return true;
    };
    if (!await listen('searchHit', (e) => {
        if (over || e.searchId !== searchId) return;
        if (e.needsHuman) for (const fn of humanListeners) fn(e.sourceId);
        onHit(e);
      })) return;
    if (!await listen('searchDone', (e) => {
      if (e.searchId !== searchId) return;
      if (e.error) diagnostic?.record('bridge_search_failed', { query, searchId, error: e.error, diagnostic: e.diagnostic });
      end(e.error ? null : true);
    })) return;
    await plugin.searchStream({ query, content, searchId, ...(timeoutMs ? { timeoutMs } : {}) });
  })().catch(error => { diagnostic?.record('bridge_search_failed', { query, searchId, error }); end(null); });
  return {
    done,
    cancel,
  };
}

/** نسخ وصلت بعد بدء التجهيز تُضاف للجلسة نفسها. يرجع عدد الجديد فعلًا. */
export async function extend(session, copies) {
  const plugin = bridge();
  if (!plugin?.extend || !session || !copies?.length) return 0;
  const discovery = addonDiscoverySessions.get(session);
  const mapped = copies.find(c => c.identity?.externalIds?.kitsu && c.identity.kind === discovery?.identity?.kind && c.identity.canonicalId === discovery?.identity?.canonicalId);
  if (mapped && discovery) discovery.identity = mapped.identity;
  if (isNative() && plugin.appendAddonStreams && plugin.extendAddonSources) {
    const state = nativeAddonSessions.get(session);
    if (!state) return 0;
    const native = copies.filter(isNativeRuntimeCopy);
    const external = copies.filter(c => !isNativeRuntimeCopy(c) && !state.sources.has(c.sourceId));
    let added = native.length ? (await withPhaseDeadline(plugin.extend({ session, copies: native, addonGeneration: state.generation }), 15_000, 'ENGINE_EXTEND_TIMEOUT').catch(() => null))?.added ?? 0 : 0;
    if (nativeAddonSessions.get(session) !== state) return 0;
    if (external.length) {
      const runtime = await withPhaseDeadline(getAddonRuntime(), 15_000, 'ADDON_RUNTIME_TIMEOUT'); await withPhaseDeadline(runtime.ready, 15_000, 'ADDON_READY_TIMEOUT');
      if (nativeAddonSessions.get(session) !== state) return 0;
      const plan = nativeAddonPreparation({ runtime, copies: external, episode: state.episode });
      const reserved = await withPhaseDeadline(plugin.extendAddonSources({ session, sourceIds: plan.sourceIds, addonGeneration: state.generation }), 15_000, 'ENGINE_EXTEND_TIMEOUT');
      if (nativeAddonSessions.get(session) !== state) return 0;
      if (reserved?.added) { startNativeAddons(session, plan, plugin, state); added += reserved.added; }
    }
    return added;
  }
  return (await plugin.extend({ session, copies }).catch(() => null))?.added ?? 0;
}

/**
 * أسماء الموسم كما تكتبها المواقع: AniList يسمّي موسمًا لاحقًا باسم فرعي («Tougen Anki: Nikko Kegon no Taki-hen»)،
 * والمواقع العربية ترقّمه («Tougen Anki Season 2» / «الموسم الثاني»). نتتبع سلسلة «الجزء السابق» التلفزيونية
 * حتى الموسم الأول، فنعرف اسمه الأصلي ورقم هذا الموسم. لا تخمين: سلسلة انقطع جلبها لا تعطي شيئًا.
 */
const SERIES_FORMATS = new Set(['TV', 'TV_SHORT', 'ONA']);
const seasonAliasCache = new Map();
const NO_ALIASES = Object.freeze({ titles: [], queries: [] });
/** ← {titles: أسماء للمطابقة «X Season N»، queries: اسم الموسم الأول للبحث فقط (لا يُطابَق به فيُقبل الموسم الأول)}. */
export async function seasonAliases(m, fetchDetail, { maxHops = 8 } = {}) {
  if (!m?.id || !SERIES_FORMATS.has(m.format)) return NO_ALIASES;
  if ([m.title, m.romaji].some(t => animeTitle(t ?? '').season != null)) return NO_ALIASES; // الرقم في اسمه أصلًا
  if (seasonAliasCache.has(m.id)) return seasonAliasCache.get(m.id);
  const prequelOf = (w) => (w?.relations ?? []).find(r => r.relation === 'الجزء السابق' && SERIES_FORMATS.has(r.format));
  let root = m;
  let n = 1;
  for (let p = prequelOf(m); p; p = prequelOf(root)) {
    if (n > maxHops) return NO_ALIASES;
    root = await fetchDetail(p.id).catch(() => null);
    if (!root) return NO_ALIASES; // سلسلة ناقصة: الرقم غير مؤكد
    n += 1;
  }
  const names = [...new Set([root.title, root.romaji].filter(Boolean).map(t => animeTitle(t).season == null ? t : null).filter(Boolean))];
  const out = n > 1 ? { titles: names.map(t => `${t} Season ${n}`), queries: names } : NO_ALIASES;
  seasonAliasCache.set(m.id, out);
  return out;
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

// علامات «عمل آخر من نفس السلسلة»: موسم، جزء، فيلم، OVA، «-hen»… كلمة منها في
// عنوان المصدر لا تحملها أسماء العمل ⇒ النسخة لموسم/عمل آخر، لا لهذا.
const SEQUEL = /(?:^|\s)(?:season|seasons|s\d{1,2}|part|cour|\d+(?:st|nd|rd|th)|ii|iii|iv|v|movie|movies|film|ova|oad|ona|special|specials|final|recap|hen|arc|shippuden|kai|الموسم|موسم|الجزء|جزء|فيلم|الفيلم|اوفا|أوفا|الخاصة|خاصة|النهائي)(?=\s|$)/u;
const YEAR = /(?:^|\D)((?:19|20)\d{2})(?!\d)/;

/**
 * حكم نسخة لعمل أنمي بعينه (هوية AniList): {ok, score, reason}.
 *   exact          عنوانها أحد أسماء العمل بعد التطبيع
 *   fuzzy ≥ 0.75   والكلمات الزائدة ليست علامة موسم/جزء/فيلم ليست في أسمائه،
 *                  وسنتها المكتوبة (إن وُجدت) قريبة من سنة العمل
 * reason ∈ title | sequel | year
 */
// وسم صيغة/نسخة بين قوسين ليس من الاسم: «Jujutsu Kaisen (TV)» = «Jujutsu Kaisen»
const FORMAT_TAG = /\s*[([]\s*(?:tv|dub|dubbed|sub|subbed|uncensored|مترجم|مدبلج)\s*[)\]]\s*/giu;

/**
 * عنوان النسخة كما تكتبه المواقع يحمل ضجيجًا ليس من اسم العمل: «مشاهدة انمي» في أوله، ورقم الحلقة وما بعده
 * («الحلقة 5 مترجمة اون لاين»، «Episode 05 English Subbed»، «第5話»)، ووسوم اللغة والجودة. يُزال من عنوان
 * المصدر وحده؛ رقم الموسم والجزء و«فيلم» تبقى، فالمطابقة بالموسم لا تتساهل.
 */
const SITE_VERB = /^\s*(?:مشاهدة|تحميل|شاهد)\s+/u;
const SITE_KIND = /^\s*(?:انمي|أنمي|إنمي)\s+/u;
const EPISODE_TAIL = /(?:^|[\s\-–|:])\s*(?:الحلقة|حلقة|episode|ep\.?)\s*\d+(?:\.\d+)?(?=\s|$|[^\d]).*$/iu;
const EPISODE_JA = /\s*第\s*\d+\s*[話话].*$/u;
const NOISE = /(?:^|\s)(?:مترجمة|مترجم|مدبلجة|مدبلج|اون\s*لاين|أون\s*لاين|online|english\s+subbed|english\s+dubbed|subbed|dubbed|raw|كاملة|كامل|hd|fhd|1080p|720p|480p|360p)(?=\s|$)/giu;
export function sourceTitle(raw) {
  const text = String(raw ?? '');
  const cleaned = text.replace(SITE_VERB, '').replace(SITE_KIND, '').replace(EPISODE_JA, '').replace(EPISODE_TAIL, '')
    .replace(NOISE, ' ').replace(/[\s\-–|:]+$/u, '').replace(/\s+/g, ' ').trim();
  return cleaned || text;
}

export function judgeAnimeCopy(c, titles, { year = null, format = null } = {}) {
  c = { ...c, title: sourceTitle(c?.title) };
  const wanted = titles.filter(Boolean).map(fold);
  const title = fold(String(c.title ?? '').replace(FORMAT_TAG, ' '));
  const y = Number(YEAR.exec(String(c.title ?? ''))?.[1] ?? NaN);
  if (year && Number.isFinite(y) && Math.abs(y - year) > 1 && !wanted.some((t) => t.includes(String(y)))) return { ok: false, score: 0, reason: 'year' };
  if (format && c.format && (format === 'MOVIE') !== (c.format === 'MOVIE')) return { ok: false, score: 0, reason: 'sequel', expected: format, actual: c.format };
  if (wanted.includes(title)) return { ok: true, score: 1, reason: null };
  const edition = animeTitle(title);
  const sourceMovie = c.format ? c.format === 'MOVIE' : edition.movie ? true : /\b(?:tv|series)\b|مسلسل/i.test(String(c.title ?? '')) ? false : null;
  const keys = wanted.map(animeTitle);
  const seasons = keys.map(k => k.season).filter(n => n != null);
  const parts = keys.map(k => k.part).filter(n => n != null);
  const words = new Set(edition.base.split(' '));
  let best = 0;
  let bestWanted = '';
  let compatible = false;
  for (const [index, key] of keys.entries()) {
    const tw = key.base.split(' ').filter(Boolean);
    const score = tw.length ? tw.filter((x) => words.has(x)).length / Math.max(tw.length, words.size) : 0;
    if (score > best) [best, bestWanted] = [score, wanted[index]];
    const movie = format ? format === 'MOVIE' : keys.some(k => k.movie);
    if (score >= 0.75 && (edition.season ?? 1) === (key.season ?? seasons[0] ?? 1)
      && (edition.part ?? 1) === (key.part ?? parts[0] ?? 1) && (sourceMovie == null || sourceMovie === movie)) compatible = true;
  }
  if (best < 0.75) return { ok: false, score: best, reason: 'title' };
  if (!compatible) return { ok: false, score: best, reason: 'sequel', expected: keys, actual: edition };
  const originalWords = new Set(title.split(' '));
  const extra = [...originalWords].filter((w) => !bestWanted.split(' ').includes(w)).join(' ');
  if (SEQUEL.test(` ${extra} `) && !wanted.some((t) => SEQUEL.test(` ${t} `)) && !(format === 'MOVIE' && edition.movie)) return { ok: false, score: best, reason: 'sequel' };
  return { ok: true, score: best, reason: null };
}

/**
 * نسخ العمل من نتائج وصلت حتى الآن (من أي عدد من المصادر): المطابقة التامة
 * لأحد العناوين أولًا، وإلا الأقرب المقبول (judgeAnimeCopy) ومعه كل نسخة بنفس
 * عنوانه. `null` إن لم يطابق شيء بعد.
 */
export function pickCopies(items, titles, criteria = {}) {
  const wanted = titles.filter(Boolean).map(fold);
  const seen = new Set();
  const all = items.filter((c) => c && !seen.has(`${c.sourceId}|${c.url}`) && seen.add(`${c.sourceId}|${c.url}`));
  const judged = all.map((c) => ({ c, j: judgeAnimeCopy(c, titles, criteria) })).filter((x) => x.j.ok);
  const own = (c) => fold(String(c.title ?? '').replace(FORMAT_TAG, ' '));
  let copies = judged.filter((x) => wanted.includes(own(x.c))).map((x) => x.c);
  if (!copies.length) {
    const best = judged.sort((a, b) => b.j.score - a.j.score)[0];
    if (!best) return null;
    copies = judged.filter((x) => own(x.c) === own(best.c)).map((x) => x.c);
  }
  // كل مصدر طابق العمل يشارك بأفضل نسخه، لا من كتب الاسم حرفيًا فقط: «Solo Leveling (Ore dake Level Up na Ken)»
  // في مصدر و«ore dake level up na ken» في آخر عمل واحد، وكان الأول يُسقط فتنقص السيرفرات (فحص المحاكي)
  const series = (c) => sourceTitle(c.title) === String(c.title ?? '').trim();
  const covered = new Set(copies.map((c) => c.sourceId));
  for (const x of [...judged].sort((a, b) => b.j.score - a.j.score || Number(series(b.c)) - Number(series(a.c)))) {
    if (covered.has(x.c.sourceId)) continue;
    covered.add(x.c.sourceId);
    copies.push(x.c);
  }
  // نسخة واحدة لكل مصدر: صفحة العمل نفسه (عنوان بلا رقم حلقة) قبل صفحات الحلقات، ثم الأولى (أسرع رد).
  // كانت Map تُبقي الأخيرة لا الأولى، فمصدر يعيد نتائجه حلقةً حلقة يدخل بصفحة حلقة اعتباطية
  const one = [];
  for (const c of [...copies.filter(series), ...copies.filter((c) => !series(c))]) if (!one.some((x) => x.sourceId === c.sourceId)) one.push(c);
  return { key: fold(one[0].title), title: one[0].title, thumbnail: one.find((c) => c.thumbnail)?.thumbnail ?? null, copies: one };
}

/**
 * مثل [findWork] لكن متدفقًا: يرجع العمل لحظة يطابق أول مصدر، ولا ينتظر أبطأ
 * المصادر (مصدر معطّل قد يأخذ 20 ثانية ليفشل). ما يصل بعدها من نسخ يُبلَّغ
 * عبر `onWork(work)` بالعمل نفسه وقد كبر. تستمر بقية الأسماء في الخلفية بعد أول تطابق.
 */
export function findWorkStream(titles, onWork = () => {}, criteria = {}) {
  return new Promise((resolve, reject) => {
    const { signal } = criteria;
    const trace = criteria.diagnostic ?? beginDiscovery({ titles, format: criteria.format, year: criteria.year });
    if (signal?.aborted) { reject(new DOMException('تم إلغاء البحث', 'AbortError')); return; }
    let first = null;
    let next = 0;
    let uncertain = false;
    const items = [];
    const tried = new Set();
    const queries = [...titles, ...(criteria.queries ?? [])].filter(Boolean).map((t) => String(t).replace(/\s*\(.*?\)\s*/g, ' ').trim()).filter((q) => q && !tried.has(q.toLowerCase()) && tried.add(q.toLowerCase()));
    // English and romaji must not wait behind each other's slow sources.
    // Matching still uses the complete canonical titles and season/year guards.
    const worker = async () => {
      await configure();
      while (next < queries.length && !signal?.aborted) {
        const query = queries[next++];
        trace.record('query_started', { query });
        const { done } = searchStream(query, 'anime', (hit) => {
          trace.record('source_page', { query, sourceId: hit.sourceId, page: hit.page, hasNext: hit.hasNext, stop: hit.stop,
            received: hit.items?.length ?? 0, error: hit.error, diagnostic: hit.diagnostic, skipped: hit.skipped });
          // سطر واحد لكل مصدر وصفحة: المقبول بعناوينه، والمرفوض بعدد كل سبب وثلاثة أمثلة. سطر لكل نتيجة كان
          // يملأ السجل (200 حدث) ويُسقط أحداثًا أقدم أهم منه (مصدر يعيد كتالوجه كله لأي بحث)
          if (isDiscoveryDebug() && hit.items?.length) {
            const judged = hit.items.map((copy) => ({ copy, j: judgeAnimeCopy(copy, titles, criteria) }));
            const rejected = judged.filter((x) => !x.j.ok);
            trace.record('candidates', { sourceId: hit.sourceId, query, page: hit.page,
              accepted: judged.filter((x) => x.j.ok).map((x) => x.copy.title).slice(0, 8),
              rejected: rejected.reduce((m, x) => ({ ...m, [x.j.reason ?? '?']: (m[x.j.reason ?? '?'] ?? 0) + 1 }), {}),
              examples: rejected.slice(0, 3).map((x) => ({ title: x.copy.title, reason: x.j.reason, score: Math.round((x.j.score ?? 0) * 100) / 100 })) });
          }
          if (hit.error || hit.skipped) uncertain = true;
          items.push(...(hit.items ?? []));
          const work = pickCopies(items, titles, criteria);
          if (!work) return;
          if (!first) {
            first = work;
            resolve(work);
          } else if (work.copies.length > first.copies.length) {
            first = work;
            onWork(work);
          }
        }, { signal, diagnostic: trace });
        if (await done === null) uncertain = true;
        if (signal?.aborted) throw new DOMException('تم إلغاء البحث', 'AbortError');
      }
    };
    void Promise.all([worker(), worker()]).then(() => {
      trace.record('discovery_complete', { sources: first?.copies?.map(c => c.sourceId) ?? [], uncertain, aliasesSearched: next, aliasesTotal: queries.length });
      if (first) return;
      if (uncertain) reject(new Error('تعذّر التحقق من بعض المصادر — أعد المحاولة'));
      else resolve(null);
    }, reject);
  });
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
export async function prepare({ copies, episode, quality = 1080, variant = 'SUB', preferredSourceId = null, preferredServer = null, probe = false, session = undefined, identity = null, signal = undefined }) {
  signal?.throwIfAborted();
  const plugin = bridge();
  const native = isNative() && plugin?.appendAddonStreams;
  const id = session ?? `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let state;
  const phase = (promise, timeoutMs, code) => withPhaseDeadline(promise, timeoutMs, code, { signal });
  if (native) {
    cancelNativeAddons(id);
    state = { episode, sources: new Set(), jobs: new Set(), generation: globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}` };
    nativeAddonSessions.set(id, state);
    observeNativeAddonLifecycle(plugin);
  }
  const context = { identity: identity ? { ...identity, episode: Number(episode) } : null };
  addonDiscoverySessions.set(id, context);
  const deferMapping = identity?.kind === 'anime' && !identity.externalIds?.kitsu && copies.some(isNativeRuntimeCopy);
  const discovery = deferMapping ? withAddonCopies([], context.identity).catch(() => []) : null;
  const attachDiscovery = () => {
    if (!discovery) return;
    void discovery.then(extra => addonDiscoverySessions.get(id) === context && extra.length ? extend(id, extra) : null).catch(() => {});
  };
  try {
  if (identity && !deferMapping) {
    copies = await phase(withAddonCopies(copies, context.identity), 45_000, 'ADDON_DISCOVERY_TIMEOUT');
    const mapped = copies.find(c => c.identity?.externalIds?.kitsu);
    if (mapped) context.identity = mapped.identity;
  }
  if (native) {
    if (nativeAddonSessions.get(id) !== state) return null;
    const runtime = await phase(getAddonRuntime(), 15_000, 'ADDON_RUNTIME_TIMEOUT'); await phase(runtime.ready, 15_000, 'ADDON_READY_TIMEOUT');
    if (nativeAddonSessions.get(id) !== state) return null;
    state.snapshot = runtime.registry.snapshot?.();
    const plan = nativeAddonPreparation({ runtime, copies, episode });
    await phase(configure(), 15_000, 'ENGINE_CONFIG_TIMEOUT');
    if (nativeAddonSessions.get(id) !== state) return null;
    const preparing = Promise.resolve(plugin.prepare({ copies: copies.filter(isNativeRuntimeCopy), identity, episode, quality, variant, preferredSourceId, preferredServer, probe, session: id, addonSources: plan.sourceIds, addonProviders: plan.providers, addonGeneration: state.generation }));
    void preparing.then(() => {
      // An RPC can open native resources after its caller already abandoned it.
      if (!nativeAddonSessions.has(id)) {
        try { void Promise.resolve(plugin.closeSession?.({ session: id })).catch(() => {}); } catch {}
      }
    }, () => {});
    const out = await phase(preparing, 15_000, 'ENGINE_PREPARE_TIMEOUT');
    if (nativeAddonSessions.get(id) !== state) return null;
    if (out?.session === id) startNativeAddons(id, plan, plugin, state);
    else cancelNativeAddons(id);
    if (out?.session === id) attachDiscovery();
    return out ? { ...out, copies } : null;
  }
  const out = await phase(call('prepare', { copies, identity, episode, quality, variant, preferredSourceId, preferredServer, probe, session: id }, { signal }), 30_000, 'ENGINE_PREPARE_TIMEOUT');
  if (out?.session === id && addonDiscoverySessions.get(id) === context) attachDiscovery();
  else if (addonDiscoverySessions.get(id) === context) addonDiscoverySessions.delete(id);
  return out ? { ...out, copies: out.copies ?? copies } : null;
  } catch (error) {
    if (addonDiscoverySessions.get(id) === context) addonDiscoverySessions.delete(id);
    if (native && nativeAddonSessions.get(id) === state) {
      cancelNativeAddons(id);
      // A timed-out bridge could have opened native resources before JS was notified.
      try { void Promise.resolve(plugin?.closeSession?.({ session: id })).catch(() => {}); } catch {}
    }
    throw error;
  }
}

/** إضافات الفيديو تستخدم الهوية المؤكدة فقط، وتلتحق بالمصادر الأصلية على المنصتين. */
export async function withAddonCopies(copies, identity) {
  const a=await withPhaseDeadline(getAddonRuntime(), 15_000, 'ADDON_RUNTIME_TIMEOUT');await withPhaseDeadline(a.ready, 15_000, 'ADDON_READY_TIMEOUT');
  if (isNative() && a.nativeCapabilities?.().addonStreams !== true) return copies;
  identity = await withPhaseDeadline(a.enrichAnimeIdentity?.(identity), 15_000, 'ADDON_IDENTITY_TIMEOUT') ?? identity;
  const extra=addonCopies(a.registry,identity,a.runtimeName ?? (isNative() ? 'apk' : 'pwa'));
  const refreshed = copies.map(c => extra.find(fresh => fresh.sourceId === c.sourceId && fresh.id === (c.id ?? c.url)) ?? c);
  return [...refreshed,...extra.filter(c=>!copies.some(old=>old.sourceId===c.sourceId))];
}
/** First confirmed copies can prepare while the other discovery path remains pending. */
export async function firstAvailableCopies(locator, addons) {
  const found = Promise.resolve(locator).then(x => x ?? { copies: [] });
  const extra = Promise.resolve(addons).then(copies => ({ copies }), () => ({ copies: [] }));
  return Promise.race([found.then(x => x.copies.length ? x : extra.then(y => y.copies.length ? y : x)), extra.then(x => x.copies.length ? x : found)]);
}
export async function hasAddonStreams(identity){try{return (await withAddonCopies([],identity)).length>0;}catch{return false;}}

/** اسم السيرفر ومعرّف المصدر ثابتان بين الأعمال؛ رمز البطاقة ورابط الحلقة ليسا كذلك. */
export function matchingWorkingRoute(routes, working) {
  if (!working?.sourceId || !working?.server) return null;
  return routes.filter((r) => r.state === 'READY' && r.sourceId === working.sourceId && r.server === working.server)
    .sort((a, b) => Math.abs((a.quality ?? 0) - (working.quality ?? a.quality ?? 0)) -
      Math.abs((b.quality ?? 0) - (working.quality ?? b.quality ?? 0)))[0] ?? null;
}

/** مهلة أصلية مطلقة: إعادة رسم العداد لا تطلق أي طلب شبكة. */
export function retrySeconds(retryAt, now = Date.now()) {
  return Number.isFinite(retryAt) ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0;
}

export async function routes(session, { signal } = {}) {
  signal?.throwIfAborted();
  return (await withPhaseDeadline(call('routes', { session }, { signal }), 15_000, 'ENGINE_ROUTES_TIMEOUT', { signal })) ?? null;
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
  const identity = addonDiscoverySessions.get(args.session)?.identity;
  if (identity && identity.canonicalId === args.subtitleIdentity?.canonicalId && identity.kind === args.subtitleIdentity?.kind) args = { ...args, subtitleIdentity: { ...args.subtitleIdentity, externalIds: { ...args.subtitleIdentity.externalIds, ...identity.externalIds } } };
  // إضافات الترجمة تعرف الحلقة بـIMDb + الموسم: نربط الأنمي بهما قبل فتح المشغّل
  if (args.subtitleIdentity) args = { ...args, subtitleIdentity: await withImdbEpisode(args.subtitleIdentity) };
  // شعار وخلفية Stremio نفسيهما من رقم IMDb إن لم تمرّرهما الصفحة
  const imdb = args.subtitleIdentity?.externalIds?.imdb;
  if (/^tt\d+$/.test(imdb ?? '')) args = { ...args, logo: args.logo ?? `https://images.metahub.space/logo/medium/${imdb}/img`, backdrop: args.backdrop ?? `https://images.metahub.space/background/medium/${imdb}/img` };
  if (globalThis.Capacitor?.isNativePlatform?.() && globalThis.Capacitor?.Plugins?.AddonEngine) {
    try {
      const a = await getAddonRuntime(); await a.ready;
      args = {...args, addonSubtitleProviders: a.nativeSubtitleProviders()};
    } catch { /* ترجمة الإضافة لا تمنع الفيديو */ }
  }
  await plugin.play(args);
  return true;
}

export const closeSession = (session) => { cancelNativeAddons(session); return call('closeSession', { session }); };

/** ما أرسله المشغّل (لحظات وترشيحات) ولم يصل المجلس بعد. يُفرَّغ بالقراءة. */
export async function outbox(userId) {
  if (!userId) return [];
  return (await call('outbox', { userId }))?.items ?? [];
}

// ───────────── نموذج ورقة السيرفرات (نفس قاعدة المشغّل الأصلي) ─────────────

const bucket = (q) => (q == null ? null : q >= 2000 ? 2160 : q >= 1400 ? 1440 : q >= 1000 ? 1080 : q >= 700 ? 720 : q >= 460 ? 480 : 360);
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

/** مدى اللحظة كاملًا من عنوانها («· 12:10–12:30») لـ«شاهد اللقطة»، أو null. */
export function momentRange(label) {
  const m = /·\s*(\d+(?::\d{2}){1,2})\s*[–-]\s*(\d+(?::\d{2}){1,2})/.exec(String(label ?? ''));
  if (!m) return null;
  const ms = (t) => t.split(':').reduce((acc, part) => acc * 60 + Number(part), 0) * 1000;
  const startMs = ms(m[1]);
  const endMs = ms(m[2]);
  return endMs > startMs ? { startMs, endMs } : null;
}

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

/**
 * مستودعات إضافات الأنمي والأفلام (Aniyomi) التي يضيفها المستخدم. داخل التطبيق وحده.
 * التثبيت يختار القسم: `content` = 'anime' أو 'cinema'. `null` حيث لا تتوفر.
 */
export function repositories() {
  const plugin = bridge();
  if (typeof plugin?.addRepo !== 'function') return null;
  return {
    kind: 'anime',
    list: () => plugin.repos(),
    add: (url) => plugin.addRepo({ url }),
    remove: (url) => plugin.removeRepo({ url }),
    extensions: async (url) => (await plugin.repoIndex({ url })).extensions ?? [],
    install: (repo, pkg, content = 'anime') => plugin.installExtension({ repo, pkg, content }),
    uninstall: (pkg) => plugin.uninstallExtension({ pkg }),
  };
}
