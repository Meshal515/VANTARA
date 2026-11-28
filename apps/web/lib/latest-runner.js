/**
 * تشغيل محرك «آخر التحديثات» المحلي (خطة 27 نوفمبر): **والتطبيق مفتوح فقط** (قرار المالك 1). دورة كاملة، ثم راحة
 * 30 دقيقة تبدأ بعد نهاية الدورة، ولا دورة والتطبيق في الخلفية. يبدأ فقط بعد اكتمال الهجرة (لا تصفير).
 *
 * الهوية: المانجا `ext:` + العنوان الموحّد، كما في الخادم حرفيًا، فتندمج بالمهاجَر. الأنمي والسينما هويتهما رسمية في
 * الخادم (AniList وIMDb)؛ حتى يُربط حلّال الهوية لا تُنشئ مصادرهما أحداثًا (التكرار أسوأ من التأخير)، وتبقى صفحاتها
 * محفوظة كخط أساس.
 * السياسة: ما يبني المكتبة العامة فقط (`buildsLibrary`)، ولا كبار ولا إيتشي ولا عمل محجوب، قبل أي طلب فصول.
 */
import { normalizeTitle } from './catalog.js';
import { adultManga, ecchiManga, isBlockedKey } from './adult-filter.js';
import { buildsLibrary } from './source-policy.js';
import * as manga from './extension-engine.js';
import { animeProviders, mangaProviders } from '../addons/latest-providers.js';
import { createLatestEngine } from './latest-engine.js';
import { friendFresh, pullSignals, pushThreads, recordLocalEvents, restoreBackup } from './latest-threads.js';

export const REST_MS = 30 * 60_000;
export const SIGNALS_MS = 5 * 60_000;
const PUSH_DEBOUNCE_MS = 2_000;

export function latestIdentity(p, item) {
  if (p.section !== 'manga') return null;
  const key = normalizeTitle(item?.title);
  return key ? `ext:${key}` : null;
}
export function latestAllowed(p, item) {
  if (p.section !== 'manga') return true;
  const key = normalizeTitle(item?.title);
  return buildsLibrary(p.key) && !adultManga(item?.ref ?? item) && !ecchiManga(item?.ref ?? item) && !isBlockedKey(`ext:${key}`);
}

export async function installedProviders({ plugins = globalThis.Capacitor?.Plugins } = {}) {
  const out = [];
  try { out.push(...mangaProviders({ engine: manga, sources: await manga.sources() })); } catch { /* لا محرك مانجا هنا (الويب) */ }
  try { out.push(...await animeProviders({ plugin: plugins?.AnimeEngine })); } catch { /* لا محرك أنمي هنا */ }
  return out;
}

/** يبدأ الحلقة ويرجع دالة إيقاف. `ready()` = اكتملت الهجرة. */
export function startLatestRunner({ store, ready, send = null, doc = globalThis.document, restMs = REST_MS, firstDelayMs = 60_000, providers = installedProviders, setTimer = setTimeout, clearTimer = clearTimeout, signalsMs = SIGNALS_MS }) {
  let current = [];
  let stopped = false;
  const engine = createLatestEngine({
    store, providers: async () => current, identify: async (p, i) => latestIdentity(p, i), allow: latestAllowed,
    // الخيط الثاني: إشارة صديق حديثة تُغني عن طلب الفصول؛ وما يكشفه هذا الجهاز يُحفظ للنسخة ويُنشر إشارةً
    // ما يُكشف يُرفع بعد ثانيتين (أحداث متقاربة طلب واحد)، لا بعد الدورة كلها
    skipWork: (p, work) => friendFresh(store, p.key, work), onEvents: async (events) => { await recordLocalEvents(store, events); kick(); },
  });
  // الخيطان بالأحداث لا بالدورة: الرفع بعد كل كشف (مجمّعًا)، وإشارات الأصحاب عند فتح التطبيق وكل 5 دقائق وهو ظاهر
  // (كانت مرة كل 30 دقيقة). طلب واحد صغير، لا تكرار والطابور محفوظ محليًا
  let pushTimer = null, pushing = null, signalsTimer = null;
  const kick = (ms = PUSH_DEBOUNCE_MS) => {
    if (!send || stopped) return;
    clearTimer(pushTimer);
    pushTimer = setTimer(() => { pushTimer = null; pushing = (pushing ?? Promise.resolve()).then(() => pushThreads(store, send)).catch(() => {}).finally(() => { pushing = null; }); }, ms);
  };
  const pullNow = async () => {
    if (!send || stopped || !ready() || !visible()) return;
    try { await pullSignals(store, send, { allow: (section, key, title) => latestAllowed({ section, key }, { title, ref: { title } }) }); } catch { /* المرة التالية */ }
  };
  const signalsLoop = () => { clearTimer(signalsTimer); if (send && !stopped) signalsTimer = setTimer(async () => { await pullNow(); signalsLoop(); }, signalsMs); };
  const onVisible = () => { if (visible()) { void pullNow(); kick(0); } };
  doc?.addEventListener?.('visibilitychange', onVisible);
  /** الخيطان حول الدورة: الاستعادة مرة، والإشارات قبلها، والرفع بعدها. فشلهما لا يوقف الكشف. */
  async function threadsBefore() {
    if (!send) return;
    try { await restoreBackup(store, send); } catch { /* المحاولة في الدورة التالية */ }
    try {
      // ولو لم يُثبَّت المصدر هنا (قرار المالك): الإشارة خبر، والسياسة نفسها تحكمها
      await pullSignals(store, send, { allow: (section, key, title) => latestAllowed({ section, key }, { title, ref: { title } }) });
    } catch { /* المحاولة في الدورة التالية */ }
  }
  let timer = null;
  const visible = () => !doc || doc.visibilityState !== 'hidden';
  const schedule = (ms) => { clearTimer(timer); if (!stopped) timer = setTimer(tick, ms); };
  async function tick() {
    if (stopped) return;
    if (!ready() || !visible()) { schedule(60_000); return; }
    try {
      current = await providers();
      await threadsBefore();
      await engine.runCycle();
      if (send) kick(0);
    } catch { /* دورة فاشلة لا توقف التي بعدها */ }
    schedule(restMs);
  }
  signalsLoop();
  // ما بقي في الطابور من جلسة سابقة يُرفع مع الإقلاع لا بعد أول دورة
  kick(5_000);
  schedule(firstDelayMs);
  return { stop() { stopped = true; clearTimer(timer); clearTimer(pushTimer); clearTimer(signalsTimer); doc?.removeEventListener?.('visibilitychange', onVisible); }, runNow: () => engine.runCycle(), flush: () => kick(0) };
}
