/**
 * قرار فن العمل الواحد في VANTARA: غلافه وبنره، يُحسم مرة لكل عمل ويُقرأ من كل الشاشات (البطاقة، صفحة العمل،
 * المكتبة، الرائج، آخر التحديثات، البحث، الموحد). لا تحسم شاشة غلافها بنفسها.
 *
 * القواعد (قرار المالك) من lib/manga-art.js كما هي، دوال نقية:
 *   - الرسمي (AniList) أولًا، والمصدر لا يتقدم إلا إن زادت بكسلاته SOURCE_MARGIN (30%).
 *   - GIF بعرض GIF_MIN_WIDTH فأكثر يتقدم على ثابت مقارب، ورديئه لا أولوية له.
 *   - البنر عريض حقيقي (≥1200px و≥1.6:1)، وإلا أعلى الأغلفة جودة يُعرض بطريقة الغلاف (wide=false).
 *
 * وما يضيفه هذا الملف: ذاكرة واحدة بهوية العمل، ومعها أبعاد الصورة الحقيقية (فيحجز كل نمط مكانها بنسبتها:
 * لا فراغ ولا قص ولا قفزة)، وحسم واحد في آنٍ لكل عمل، وقياس واحد لكل رابط مهما طلبته الشاشات.
 * الترحيل: قرار محفوظ بالصيغة السابقة (vantara.manga.art.v2) يُقرأ ولا يُمسح.
 */
import { chooseBanner, chooseCover, probe as probeImage } from './manga-art.js';

const KEY = 'vantara.art.v1';
const LEGACY = 'vantara.manga.art.v2';
const MAX = 3000;

/** رابط غلاف رسمي (AniList) بشكله: يُعامل رسميًا ولو جاء من الخادم أو بطاقة. */
export const isOfficialArt = (url) => /\/\/s\d+\.anilist\.co\/|\/\/img\.anili\.st\//.test(String(url ?? ''));

/**
 * @param {{ storage?: Storage|null, probe?: (url: string, ms?: number) => Promise<{url:string,width:number,height:number}|null> }} [o]
 */
export function createArtStore({ storage = globalThis.localStorage ?? null, probe = probeImage } = {}) {
  let all = null;
  let legacy = undefined;
  const read = () => {
    if (all) return all;
    try { all = JSON.parse(storage?.getItem(KEY) ?? '{}') ?? {}; } catch { all = {}; }
    return all;
  };
  let timer = null;
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const keys = Object.keys(all);
      for (const k of keys.slice(0, Math.max(0, keys.length - MAX))) delete all[k];
      try { storage?.setItem(KEY, JSON.stringify(all)); } catch { /* تسريع لا حقيقة: يُحسم من جديد */ }
    }, 300);
  };
  const legacyOf = (id) => {
    if (legacy === undefined) { try { legacy = JSON.parse(storage?.getItem(LEGACY) ?? 'null'); } catch { legacy = null; } }
    const old = legacy?.[id];
    return old?.cover ? { cover: old.cover, banner: old.banner ?? null, wide: Boolean(old.wide), w: null, h: null } : null;
  };
  const listeners = new Set();
  const inflight = new Map();
  const probes = new Map();
  /** قياس واحد لكل رابط في الجلسة: البطاقة وصفحة العمل تشتركان فيه. الفشل لا يُحفظ (قد ينجح لاحقًا). */
  const measure = (url, ms) => {
    if (!url) return Promise.resolve(null);
    if (!probes.has(url)) probes.set(url, probe(url, ms).then((m) => { if (!m) probes.delete(url); return m; }));
    return probes.get(url);
  };

  /** القرار المحفوظ للعمل أو null. متزامن: يُقرأ قبل أي رسم فيُحجز المكان بنسبته من أول إطار. */
  function get(id) {
    if (!id) return null;
    const hit = read()[id];
    if (hit) return hit;
    const old = legacyOf(id);
    if (old) { all[id] = old; persist(); }
    return old;
  }

  /**
   * يحسم فن العمل مرة (ومن يطلبه في الأثناء ينتظر الحسم نفسه). القرار المحفوظ يُعاد فورًا بلا شبكة إلا أن
   * يُطلب `refresh`.
   * @param {string} id هوية العمل الثابتة (ref)
   * @param {{ official?: Promise<{cover?:string|null, banner?:string|null}|null>|null, sources?: string[], wideHint?: string|null, deadlineMs?: number, refresh?: boolean }} o
   */
  function decide(id, { official = null, sources = [], wideHint = null, deadlineMs = 6000, refresh = false } = {}) {
    const known = get(id);
    if (known && !refresh && known.w) return Promise.resolve(known);
    if (inflight.has(id)) return inflight.get(id);
    const job = (async () => {
      const start = Date.now();
      const left = () => Math.max(500, deadlineMs - (Date.now() - start));
      // كل المرشحين معًا (لا ينتظر أحدهم الآخر): الرسمي من المصدر الرئيسي، وأغلفة المصادر، والبنر
      const uniq = [...new Set(sources.filter(Boolean))].slice(0, 4);
      const srcProbes = uniq.map((u) => measure(u, left()).then((m) => m && { ...m, official: isOfficialArt(u) }));
      const off = official ? await Promise.race([Promise.resolve(official).catch(() => null), new Promise((r) => setTimeout(() => r(null), left()))]) : null;
      const offCover = off?.cover ? measure(off.cover, left()).then((m) => m && { ...m, official: true }) : Promise.resolve(null);
      const bannerUrl = off?.banner || wideHint || null;
      const [oc, b, ...src] = await Promise.all([offCover, bannerUrl ? measure(bannerUrl, left()) : null, ...srcProbes]);
      const covers = [oc, ...src].filter(Boolean);
      const cover = chooseCover(covers);
      if (!cover) return known ?? null;
      const banner = chooseBanner(b, covers);
      const bannerDims = banner?.wide ? b : cover;
      const decision = { cover: cover.url, w: cover.width, h: cover.height, banner: banner?.url ?? cover.url, wide: Boolean(banner?.wide), bw: bannerDims?.width ?? null, bh: bannerDims?.height ?? null };
      read();
      delete all[id];
      all[id] = decision;
      persist();
      for (const fn of listeners) fn(id, decision);
      return decision;
    })().finally(() => inflight.delete(id));
    inflight.set(id, job);
    return job;
  }

  return {
    get,
    decide,
    /** يُنادى حين يُحسم فن عمل: الشاشات الظاهرة التي تنتظره ترسمه (مرة، بلا تبديل لما ظهر). */
    onDecided(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** غلاف فشل تحميله (رابط مات): يُنسى قراره فيُحسم من جديد في الفتحة التالية. */
    forget(id) { read(); if (id in all) { delete all[id]; persist(); } },
  };
}

/** حدود نسبة الغلاف المحجوزة: غلاف شاذ (شريط طويل جدًا أو صورة عريضة) لا يكسر تخطيط النمط؛ يُقص قليلًا. */
export const COVER_RATIO = Object.freeze({ min: 0.55, max: 0.85 });
/** نسبة الفن للحجز في CSS (aspect-ratio) أو null بلا أبعاد معروفة. الغلاف محصور في COVER_RATIO. */
export const artRatio = (d, which = 'cover') => {
  const w = which === 'banner' ? d?.bw : d?.w, h = which === 'banner' ? d?.bh : d?.h;
  if (!(w > 0 && h > 0)) return null;
  if (which === 'cover' && (w / h < COVER_RATIO.min || w / h > COVER_RATIO.max)) return String(Math.min(COVER_RATIO.max, Math.max(COVER_RATIO.min, w / h)));
  return `${w} / ${h}`;
};
