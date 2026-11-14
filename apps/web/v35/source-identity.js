/**
 * هوية العمل الرسمية لبطاقة من داخل مصدر (طلب المالك 13 نوفمبر 2026):
 * عمل الأنمي الموجود في AniList، والفيلم/المسلسل الموجود في IMDb (Cinemeta)، يظهر في صفحة المصدر بغلافه
 * الرسمي ويُفتح ببطاقة العمل الأصلية نفسها، لكن السيرفرات تبقى من هذا المصدر وحده (`_sourceCopy`).
 *
 * الحكم صارم ومن مطابقات المحرك نفسه (`judgeAnimeCopy` و`judgeCopy`): عنوان ضعيف أو موسم آخر أو سنة أخرى
 * = لا هوية، ويبقى غلاف المصدر وبيانات المصدر كما هي. لا تخمين.
 *
 * طلبات قليلة: عناوين الأنمي تُجمع كل 10 في طلب AniList واحد، وCinemeta بستة طلبات متوازية على الأكثر،
 * والنتيجة (بما فيها «لا هوية») تُحفظ في الجلسة وفي التخزين المحلي.
 */
import { searchAnimeBatch } from "../lib/anime-meta.js";
import { judgeAnimeCopy, sourceTitle } from "../lib/anime-engine.js";
import { search as cinemaSearch } from "../lib/cinema-meta.js";
import { judgeCopy, readTitle } from "../lib/cinema-match.js";

const STORE_KEY = "vantara:source-identity:v1";
const STORE_MAX = 600;
const memory = new Map();
let disk = null;
const readDisk = () => {
  if (disk) return disk;
  try { disk = JSON.parse(globalThis.localStorage?.getItem(STORE_KEY) ?? "{}") ?? {}; } catch { disk = {}; }
  return disk;
};
let saveTimer = null;
const writeDisk = (key, value) => {
  const d = readDisk();
  d[key] = value ? { ...value, at: Date.now() } : { none: true, at: Date.now() };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const entries = Object.entries(d).sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0)).slice(0, STORE_MAX);
      disk = Object.fromEntries(entries);
      globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify(disk));
    } catch { /* تخزين ممتلئ أو محجوب: الذاكرة تكفي للجلسة */ }
  }, 400);
};
// «لا هوية» تُعاد محاولتها بعد يوم (قد يضيف AniList العمل أو يتغير عنوان المصدر)
const NONE_TTL = 24 * 3600_000;

/** نوع البطاقة: أنمي أو سينما، أو null (مانجا ونوع غير مؤكد لا يدخلان هنا). */
export function identityKind(item, addon) {
  const t = String(item?.type ?? "").toLowerCase();
  if (t === "manga") return null;
  if (t === "anime") return "anime";
  if (t === "movie" || t === "series" || t === "tv") return "cinema";
  const types = addon?.contentTypes ?? [];
  if (types.includes("manga") && types.length === 1) return null;
  if (types.includes("anime") && !types.some((x) => x === "movie" || x === "series")) return "anime";
  if (types.some((x) => x === "movie" || x === "series")) return "cinema";
  return null;
}

const titleOf = (item) => String(item?.title ?? item?.name ?? "").trim();
const keyOf = (kind, item) => `${kind}|${titleOf(item).toLowerCase()}`;

// ───────── AniList: دفعات من 10 عناوين ─────────
let animeQueue = [];
let animeTimer = null;
function flushAnime() {
  animeTimer = null;
  const batch = animeQueue.splice(0, 10);
  if (animeQueue.length) animeTimer = setTimeout(flushAnime, 120);
  if (!batch.length) return;
  searchAnimeBatch(batch.map((b) => b.query), { timeoutMs: 9000 })
    .then((lists) => batch.forEach((b, i) => b.resolve(lists[i] ?? [])))
    .catch(() => batch.forEach((b) => b.resolve(null)));
}
const queueAnime = (query) => new Promise((resolve) => {
  animeQueue.push({ query, resolve });
  if (!animeTimer) animeTimer = setTimeout(flushAnime, 40);
});

async function resolveAnime(item) {
  const raw = titleOf(item);
  const query = sourceTitle(raw).replace(/\s*\(.*?\)\s*/g, " ").trim();
  // AniList لا يبحث بالعربية: عنوان بلا حروف لاتينية لا يُسأل عنه
  if (!/[a-z]{2}/i.test(query)) return null;
  const candidates = await queueAnime(query);
  if (candidates == null) throw new Error("anilist_unavailable");
  for (const m of candidates) {
    const names = [m.title, m.romaji, m.native, ...(m.synonyms ?? [])];
    if (judgeAnimeCopy({ title: raw }, names, { year: m.year ?? null }).ok)
      return { kind: "anime", id: m.id, title: m.title, poster: m.poster ?? m.posterSmall ?? null, banner: m.banner ?? null, card: m };
  }
  return null;
}

// ───────── Cinemeta: ثلاثة طلبات متوازية على الأكثر ─────────
let cinemaActive = 0;
const cinemaWaiting = [];
const cinemaSlot = (fn) => new Promise((resolve, reject) => {
  const run = () => {
    cinemaActive++;
    fn().then(resolve, reject).finally(() => { cinemaActive--; cinemaWaiting.shift()?.(); });
  };
  if (cinemaActive < 6) run(); else cinemaWaiting.push(run);
});
const latinQuery = (raw) => String(raw)
  .replace(/(?:الموسم|الحلقة)\s*\S*(?:\s+عشر)?/g, " ")
  .replace(/[^\p{Script=Latin}\d\s:'&-]+/gu, " ")
  .replace(/\b(?:19|20)\d{2}\b/g, " ")
  .replace(/\s+/g, " ").trim();
const poster = (url) => (url ? url.replace(/(metahub\.space\/poster)\/small\//, "$1/medium/") : null);

async function resolveCinema(item) {
  const raw = titleOf(item);
  const query = latinQuery(raw);
  if (!/[a-z]{2}/i.test(query)) return null;
  const info = readTitle(raw);
  const wantType = item?.type === "movie" || item?.type === "series" ? item.type : info.kind === "movie" || info.kind === "series" ? info.kind : null;
  const results = await cinemaSlot(() => cinemaSearch(query));
  let best = null;
  for (const m of results.slice(0, 8)) {
    if (wantType && m.type !== wantType) continue;
    const judged = judgeCopy({ title: raw }, { title: m.title, year: m.year, endYear: m.endYear, type: m.type, primary: true });
    if (judged.ok && (!best || judged.score > best.score)) best = { score: judged.score, m };
  }
  if (!best) return null;
  const m = best.m;
  return { kind: "cinema", id: m.id, type: m.type, title: m.title, poster: poster(m.poster), background: m.background ?? null, card: m };
}

/**
 * الهوية الرسمية لعمل من مصدر، أو null. لا ترمي: أي فشل شبكة = null (ولا يُحفظ، فيُعاد في المرة القادمة).
 */
export function resolveSourceIdentity(item, addon) {
  const kind = identityKind(item, addon);
  if (!kind || !titleOf(item)) return Promise.resolve(null);
  const key = keyOf(kind, item);
  if (memory.has(key)) return memory.get(key);
  const saved = readDisk()[key];
  if (saved && (!saved.none || Date.now() - (saved.at ?? 0) < NONE_TTL)) {
    const value = saved.none ? null : saved;
    const done = Promise.resolve(value);
    memory.set(key, done);
    return done;
  }
  const work = (kind === "anime" ? resolveAnime(item) : resolveCinema(item))
    .then((value) => {
      // البطاقة الكاملة لا تُحفظ في التخزين (كبيرة)، الجلسة تكفيها
      writeDisk(key, value ? { ...value, card: undefined } : null);
      return value;
    })
    .catch(() => { memory.delete(key); return null; });
  memory.set(key, work);
  return work;
}

/** المعروف الآن بلا انتظار (للرسم الأول دون تبديل غلاف أمام العين). */
export function knownSourceIdentity(item, addon) {
  const kind = identityKind(item, addon);
  if (!kind) return undefined;
  const saved = readDisk()[keyOf(kind, item)];
  if (!saved) return undefined;
  if (saved.none) return Date.now() - (saved.at ?? 0) < NONE_TTL ? null : undefined;
  return saved;
}

/**
 * يضيف الهوية الرسمية إلى نموذج عمل المصدر (`sourceWorkModel`) دون أن يغيّر النسخة المثبتة: بطاقة العمل
 * الأصلية، والسيرفرات من `_sourceCopy` وحدها. المسلسل يبقى بمواسم المصدر (صفحة المصدر لموسم بعينه)، ويأخذ
 * الملصق والخلفية والوصف والتقييم الرسمية فقط.
 */
export function withOfficialIdentity(work, identity) {
  if (!identity || !work?._sourceCopy) return work;
  if (identity.kind === "anime") {
    const card = identity.card ?? {};
    return {
      ...work,
      ...card,
      id: identity.id,
      title: card.title ?? identity.title ?? work.title,
      poster: card.poster ?? identity.poster ?? work.poster,
      cover: card.poster ?? identity.poster ?? work.cover,
      banner: card.banner ?? identity.banner ?? work.banner,
      _sourceCopy: work._sourceCopy,
      _officialIdentity: true,
    };
  }
  const card = identity.card ?? {};
  if (identity.type === "movie" && work.type === "movie") {
    return {
      ...work,
      ...card,
      id: identity.id,
      type: "movie",
      poster: identity.poster ?? card.poster ?? work.poster,
      externalIds: { ...(work.externalIds ?? {}), imdb: identity.id },
      _sourceCopy: work._sourceCopy,
      _officialIdentity: true,
    };
  }
  return {
    ...work,
    poster: identity.poster ?? work.poster,
    background: identity.background ?? card.background ?? work.background,
    description: work.description ?? card.description ?? null,
    genres: work.genres?.length ? work.genres : card.genres ?? [],
    rating: work.rating ?? card.rating ?? null,
    year: work.year ?? card.year ?? null,
    logo: card.logo ?? null,
    externalIds: { ...(work.externalIds ?? {}), imdb: identity.id },
  };
}
