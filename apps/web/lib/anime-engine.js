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

import { addonCopies } from '../addons/video.js';
import { getAddonRuntime } from '../addons/runtime.js';
import { nativeAddonPreparation } from '../addons/native-preparation.js';
import { isNative, webPlugin } from '../pwa/platform.js';

// الجسر الأصلي، أو جسر الـPWA في المتصفح (pwa/bridges/anime.js)، أو null.
// داخل الـAPK `webPlugin()` يرجع null دائمًا.
const bridge = () => globalThis.Capacitor?.Plugins?.AnimeEngine ?? webPlugin('AnimeEngine');

export const available = () => bridge() !== null;

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

const humanListeners = new Set();
/**
 * مصدر يطلب من Cloudflare تحقق إنسان (الطلبات المخفية لا تستطيع حلّه):
 * `fn(sourceId)` لتعرض الواجهة «تحقّق» لحظات. يرجع دالة إلغاء الاشتراك.
 */
export function onNeedsHuman(fn) {
  humanListeners.add(fn);
  return () => humanListeners.delete(fn);
}

/** «تحقّق»: يُظهر صفحة تحقق المصدر بملء الشاشة، ثم يبحث فيه مرة. `{ok, error}`. */
export async function verify(sourceId) {
  try {
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
export function searchStream(query, content = 'anime', onHit = () => {}, { timeoutMs = null } = {}) {
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
    for (const h of handles) void Promise.resolve(h).then((x) => x?.remove?.());
    handles = [];
    settle(value);
  };
  void (async () => {
    await configure();
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
    handles = [
      await plugin.addListener('searchHit', (e) => {
        if (e.searchId !== searchId) return;
        if (e.needsHuman) for (const fn of humanListeners) fn(e.sourceId);
        if (!over) onHit(e);
      }),
      await plugin.addListener('searchDone', (e) => e.searchId === searchId && end(true)),
    ];
    if (over) return end(false);
    await plugin.searchStream({ query, content, searchId, ...(timeoutMs ? { timeoutMs } : {}) });
  })().catch(() => end(null));
  return {
    done,
    cancel() {
      if (over) return;
      void plugin.cancelSearch?.({ searchId })?.catch?.(() => {});
      end(false);
    },
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
    const native = copies.filter(c => !c.sourceId?.startsWith('addon|'));
    const external = copies.filter(c => c.sourceId?.startsWith('addon|') && !state.sources.has(c.sourceId));
    let added = native.length ? (await plugin.extend({ session, copies: native }).catch(() => null))?.added ?? 0 : 0;
    if (nativeAddonSessions.get(session) !== state) return 0;
    if (external.length) {
      const runtime = await getAddonRuntime(); await runtime.ready;
      if (nativeAddonSessions.get(session) !== state) return 0;
      const plan = nativeAddonPreparation({ runtime, copies: external, episode: state.episode });
      const reserved = await plugin.extendAddonSources({ session, sourceIds: plan.sourceIds, addonGeneration: state.generation });
      if (nativeAddonSessions.get(session) !== state) return 0;
      if (reserved?.added) { startNativeAddons(session, plan, plugin, state); added += reserved.added; }
    }
    return added;
  }
  return (await plugin.extend({ session, copies }).catch(() => null))?.added ?? 0;
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

export function judgeAnimeCopy(c, titles, { year = null } = {}) {
  const wanted = titles.filter(Boolean).map(fold);
  const title = fold(String(c.title ?? '').replace(FORMAT_TAG, ' '));
  const y = Number(YEAR.exec(String(c.title ?? ''))?.[1] ?? NaN);
  if (year && Number.isFinite(y) && Math.abs(y - year) > 1 && !wanted.some((t) => t.includes(String(y)))) return { ok: false, score: 0, reason: 'year' };
  if (wanted.includes(title)) return { ok: true, score: 1, reason: null };
  const words = new Set(title.split(' '));
  let best = 0;
  let bestWanted = '';
  for (const t of wanted) {
    const tw = t.split(' ').filter(Boolean);
    const score = tw.length ? tw.filter((x) => words.has(x)).length / Math.max(tw.length, words.size) : 0;
    if (score > best) [best, bestWanted] = [score, t];
  }
  if (best < 0.75) return { ok: false, score: best, reason: 'title' };
  const extra = [...words].filter((w) => !bestWanted.split(' ').includes(w)).join(' ');
  if (SEQUEL.test(` ${extra} `) && !wanted.some((t) => SEQUEL.test(` ${t} `))) return { ok: false, score: best, reason: 'sequel' };
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
  // نسخة واحدة لكل مصدر: الأولى (أسرع رد) هي المرجّحة
  const one = [...new Map(copies.map((c) => [c.sourceId, c])).values()];
  return { key: fold(one[0].title), title: one[0].title, thumbnail: one.find((c) => c.thumbnail)?.thumbnail ?? null, copies: one };
}

/**
 * مثل [findWork] لكن متدفقًا: يرجع العمل لحظة يطابق أول مصدر، ولا ينتظر أبطأ
 * المصادر (مصدر معطّل قد يأخذ 20 ثانية ليفشل). ما يصل بعدها من نسخ يُبلَّغ
 * عبر `onWork(work)` بالعمل نفسه وقد كبر. عنوان بديل يُسأل فقط إن لم يطابق الأول.
 */
export function findWorkStream(titles, onWork = () => {}, criteria = {}) {
  return new Promise((resolve, reject) => {
    let first = null;
    let next = 0;
    let uncertain = false;
    const items = [];
    const tried = new Set();
    const queries = titles.filter(Boolean).map((t) => String(t).replace(/\s*\(.*?\)\s*/g, ' ').trim()).filter((q) => q && !tried.has(q.toLowerCase()) && tried.add(q.toLowerCase()));
    // English and romaji must not wait behind each other's slow sources.
    // Matching still uses the complete canonical titles and season/year guards.
    const worker = async () => {
      while (next < queries.length && !first) {
        const query = queries[next++];
        const { done } = searchStream(query, 'anime', (hit) => {
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
        });
        if (await done === null) uncertain = true;
      }
    };
    void Promise.all([worker(), worker()]).then(() => {
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
export async function prepare({ copies, episode, quality = 1080, variant = 'SUB', preferredSourceId = null, preferredServer = null, probe = false, session = undefined, identity = null }) {
  const plugin = bridge();
  const native = isNative() && plugin?.appendAddonStreams;
  const id = session ?? `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let state;
  if (native) {
    cancelNativeAddons(id);
    state = { episode, sources: new Set(), jobs: new Set(), generation: globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}` };
    nativeAddonSessions.set(id, state);
    observeNativeAddonLifecycle(plugin);
  }
  const context = { identity: identity ? { ...identity, episode: Number(episode) } : null };
  addonDiscoverySessions.set(id, context);
  const deferMapping = identity?.kind === 'anime' && !identity.externalIds?.kitsu && copies.some(c => !c.sourceId?.startsWith('addon|'));
  const discovery = deferMapping ? withAddonCopies([], context.identity).catch(() => []) : null;
  const attachDiscovery = () => {
    if (!discovery) return;
    void discovery.then(extra => addonDiscoverySessions.get(id) === context && extra.length ? extend(id, extra) : null).catch(() => {});
  };
  try {
  if (identity && !deferMapping) {
    copies = await withAddonCopies(copies, context.identity);
    const mapped = copies.find(c => c.identity?.externalIds?.kitsu);
    if (mapped) context.identity = mapped.identity;
  }
  if (native) {
    if (nativeAddonSessions.get(id) !== state) return null;
    const runtime = await getAddonRuntime(); await runtime.ready;
    if (nativeAddonSessions.get(id) !== state) return null;
    state.snapshot = runtime.registry.snapshot?.();
    const plan = nativeAddonPreparation({ runtime, copies, episode });
    await configure();
    if (nativeAddonSessions.get(id) !== state) return null;
    const out = await plugin.prepare({ copies: copies.filter(c => !c.sourceId?.startsWith('addon|')), identity, episode, quality, variant, preferredSourceId, preferredServer, probe, session: id, addonSources: plan.sourceIds, addonProviders: plan.providers, addonGeneration: state.generation });
    if (nativeAddonSessions.get(id) !== state) return null;
    if (out?.session === id) startNativeAddons(id, plan, plugin, state);
    else cancelNativeAddons(id);
    if (out?.session === id) attachDiscovery();
    return out ? { ...out, copies } : null;
  }
  const out = await call('prepare', { copies, identity, episode, quality, variant, preferredSourceId, preferredServer, probe, session: id });
  if (out?.session === id && addonDiscoverySessions.get(id) === context) attachDiscovery();
  else if (addonDiscoverySessions.get(id) === context) addonDiscoverySessions.delete(id);
  return out ? { ...out, copies: out.copies ?? copies } : null;
  } catch (error) {
    if (addonDiscoverySessions.get(id) === context) addonDiscoverySessions.delete(id);
    if (native && nativeAddonSessions.get(id) === state) cancelNativeAddons(id);
    throw error;
  }
}

/** إضافات الفيديو تستخدم الهوية المؤكدة فقط، وتلتحق بالمصادر الأصلية على المنصتين. */
export async function withAddonCopies(copies, identity) {
  const a=await getAddonRuntime();await a.ready;
  if (isNative() && a.nativeCapabilities?.().addonStreams !== true) return copies;
  identity = await a.enrichAnimeIdentity?.(identity) ?? identity;
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
  const identity = addonDiscoverySessions.get(args.session)?.identity;
  if (identity && identity.canonicalId === args.subtitleIdentity?.canonicalId && identity.kind === args.subtitleIdentity?.kind) args = { ...args, subtitleIdentity: { ...args.subtitleIdentity, externalIds: { ...args.subtitleIdentity.externalIds, ...identity.externalIds } } };
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
