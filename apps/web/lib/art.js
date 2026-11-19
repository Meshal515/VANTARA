/**
 * قرار فن العمل الواحد في VANTARA: غلافه وبنره، يُحسم مرة لكل عمل ويُقرأ من كل الشاشات (البطاقة، صفحة العمل،
 * المكتبة، الرائج، آخر التحديثات، البحث، الموحد). لا تحسم شاشة غلافها بنفسها.
 *
 * قاعدة الغلاف (قرار المالك، 16 نوفمبر 2026): **أول غلاف مقبول يصل يفوز ولا يتبدل**، رسميًا كان أو من مصدر،
 * إلا إن حُذف المصدر الذي جاء منه (forgetSources). «مقبول» = عرضه MIN_COVER_WIDTH فأكثر بنسبة غلاف معقولة. كان
 * الحسم ينتظر AniList حتى 6 ثوانٍ وKitsu وقياس كل المرشحين ثم يختار «الأفضل»، فتبقى بطاقة المانجا هيكلًا فارغًا
 * بينما الأنمي يعرض ملصقه فورًا. لا مقبول حتى المهلة: الأفضل مما وصل (chooseCover) كما كان.
 *   - البنر عريض حقيقي (≥1200px و≥1.6:1)، وإلا الغلاف بطريقة الغلاف (wide=false). يُكمَّل البنر بعد الحسم
 *     من الرسمي إن وصل في المهلة؛ الغلاف لا يتغير.
 *
 * وما يضيفه هذا الملف: ذاكرة واحدة بهوية العمل، ومعها أبعاد الصورة الحقيقية (فيحجز كل نمط مكانها بنسبتها:
 * لا فراغ ولا قص ولا قفزة)، وحسم واحد في آنٍ لكل عمل، وقياس واحد لكل رابط مهما طلبته الشاشات.
 * الترحيل: قرار محفوظ بالصيغة السابقة (vantara.manga.art.v2) يُقرأ ولا يُمسح.
 */
import { chooseBanner, chooseCover, probe as probeImage } from './manga-art.js';

const KEY = 'vantara.art.v1';
const LEGACY = 'vantara.manga.art.v2';
const MAX = 3000;
/** أقل عرض لغلاف يفوز بالوصول أولًا: مصغّرات المصادر (100×130) لا تُثبَّت مكان غلاف حقيقي. */
export const MIN_COVER_WIDTH = 200;
const acceptable = (m) => m && m.width >= MIN_COVER_WIDTH && m.height > 0 && m.width / m.height >= 0.4 && m.width / m.height <= 1.1;

/** رابط غلاف رسمي (AniList) بشكله: يُعامل رسميًا ولو جاء من الخادم أو بطاقة. */
export const isOfficialArt = (url) => /\/\/s\d+\.anilist\.co\/|\/\/img\.anili\.st\//.test(String(url ?? ''));

/**
 * @param {{ storage?: Storage|null, probe?: (url: string, ms?: number) => Promise<{url:string,width:number,height:number}|null> }} [o]
 */
export function createArtStore({ storage = globalThis.localStorage ?? null, probe = probeImage, refsOf = (id) => [id] } = {}) {
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
      // فشل الحفظ (تخزين ممتلئ) يُعلن (SY2): القرار يبقى للجلسة، لكن ضياعه يعني غلافًا آخر بعد إعادة الفتح
      try { storage?.setItem(KEY, JSON.stringify(all)); } catch { try { globalThis.dispatchEvent?.(new CustomEvent('vantara:storage-full', { detail: { key: KEY } })); } catch { /* */ } }
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
    if (old) { all[id] = old; persist(); return old; }
    // المرحلة 1 من خطة المانجا (CV4): العمل نفسه بمرجع آخر (قبل الدمج أو بعده) حُسم غلافه: يُنسخ القرار
    // كما هو إلى المرجع الحالي فلا يُحسم غلاف ثانٍ بعد العرض، والأصل يبقى. انتقالي حتى الهوية الداخلية الثابتة.
    for (const ref of refsOf(id)) {
      if (ref === id) continue;
      const other = all[ref] ?? legacyOf(ref);
      if (other) { all[id] = other; persist(); return other; }
    }
    return null;
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
    const job = new Promise((resolveJob) => {
      const start = Date.now();
      const left = () => Math.max(500, deadlineMs - (Date.now() - start));
      // مرشح المصدر: رابط، أو { url, sid } ليُعرف مصدره فيُعاد الحسم إن حُذف
      const seen = new Set();
      // url قد يكون وعدًا (غلاف المحرّك المحفوظ ثم الرابط): يدخل السباق لحظة وصوله، لا ينتظر غيره
      const cands = sources.map((c) => (typeof c === 'string' || typeof c?.then === 'function' ? { url: c, sid: null } : { url: c?.url, sid: c?.sid ?? null }))
        .filter((c) => c.url && (typeof c.url !== 'string' || (!seen.has(c.url) && seen.add(c.url)))).slice(0, 4);
      const measured = [];
      let winner = null;
      const save = (decision) => {
        read();
        delete all[id];
        all[id] = decision;
        persist();
        for (const fn of listeners) fn(id, decision);
        return decision;
      };
      const settle = (m) => {
        if (winner) return;
        winner = m;
        // البنر لا ينتظر: الغلاف بطريقة الغلاف الآن، والبنر العريض يُكمَّل إن وصل (الغلاف ثابت)
        resolveJob(save({ cover: m.url, w: m.width, h: m.height, banner: m.url, wide: false, bw: m.width, bh: m.height, sid: m.sid ?? null }));
      };
      const consider = (m) => {
        if (!m) return;
        measured.push(m);
        if (acceptable(m)) settle(m);
      };
      const srcDone = cands.map((c) => Promise.resolve(c.url).catch(() => null).then((url) => url && measure(url, left()).then((m) => consider(m && { ...m, official: isOfficialArt(url), sid: isOfficialArt(url) ? null : c.sid }))));
      const offDone = (async () => {
        const off = official ? await Promise.race([Promise.resolve(official).catch(() => null), new Promise((r) => setTimeout(() => r(null), left()))]) : null;
        const covers = [...new Set([off?.cover, ...(off?.more ?? []).map((x) => x?.cover)].filter(Boolean))];
        const bannerUrls = [...new Set([off?.banner, ...(off?.more ?? []).map((x) => x?.banner), wideHint].filter(Boolean))];
        const [, banners] = await Promise.all([
          Promise.all(covers.map((u) => measure(u, left()).then((m) => consider(m && { ...m, official: true, sid: null })))),
          Promise.all(bannerUrls.map((u) => measure(u, left()))),
        ]);
        return banners.filter(Boolean).filter((b) => chooseBanner(b, [])?.wide).sort((x, y) => x.width * x.height - y.width * y.height).at(-1) ?? null;
      })().catch(() => null);
      void (async () => {
        await Promise.all(srcDone);
        const wideBanner = await offDone;
        if (!winner) {
          // لا غلاف مقبول في المهلة: الأفضل مما وصل (قاعدة الجودة القديمة) أو القرار السابق
          const cover = chooseCover(measured);
          if (!cover) return resolveJob(known ?? null);
          settle(cover);
        }
        const d = get(id);
        if (wideBanner && d && d.cover === winner.url && !d.wide) save({ ...d, banner: wideBanner.url, wide: true, bw: wideBanner.width, bh: wideBanner.height });
      })().catch(() => { if (!winner) resolveJob(known ?? null); });
    }).finally(() => inflight.delete(id));
    inflight.set(id, job);
    return job;
  }

  /** حُذف مصدر: قرارات أغلفته تُنسى فتُحسم من جديد (الرسمية بلا مصدر تبقى). `installed` معرّفات المصادر المثبتة. */
  function forgetSources(installed) {
    read();
    let changed = false;
    for (const [id, d] of Object.entries(all)) {
      if (d?.sid && !installed.has(d.sid)) { delete all[id]; changed = true; }
    }
    if (changed) persist();
    return changed;
  }

  return {
    get,
    decide,
    forgetSources,
    /** يُنادى حين يُحسم فن عمل: الشاشات الظاهرة التي تنتظره ترسمه (مرة، بلا تبديل لما ظهر). */
    onDecided(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** غلاف فشل تحميله (رابط مات): يُنسى قراره فيُحسم من جديد في الفتحة التالية. */
    forget(id) {
      read();
      const dead = all[id]?.cover ?? null;
      let changed = false;
      if (id in all) { delete all[id]; changed = true; }
      // والقرار نفسه في مراجع العمل الأخرى (المرحلة 1): لا يُنسخ رابط ميت من جديد إلى البطاقة
      if (dead) for (const ref of refsOf(id)) if (ref !== id && all[ref]?.cover === dead) { delete all[ref]; changed = true; }
      if (changed) persist();
    },
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
