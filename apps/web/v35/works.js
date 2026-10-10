/**
 * أعمال مصادرنا بشكل v35.
 *
 * واجهة v35 كُتبت على `Media` من AniList. هنا المصدر محرّك الإضافات: الكتالوج
 * يُسأل من كل المصادر معًا ويُدمج العمل الواحد عبرها (`lib/catalog.js`)، ثم
 * يُبنى نفس الشكل الذي تقرؤه البطاقات والبانر وصفحة العمل.
 *
 * ولا يُخترع ما لم يقله المصدر: لا تقييم ولا شعبية، فتختفي من البطاقة كما
 * تختفي في v35 حين تغيب.
 */

import engine from '../lib/extension-engine.js';
import { MIRROR_FAMILIES, canonicalIndex, chapterNumberOf, countMainChapters, gather, mirrorFamily, mergeChapters, normalizeTitle, rankListing, titlesMatch } from '../lib/catalog.js';
import { aliasMap, learnAliases, loadAliases, noteRefAlias } from '../lib/manga-alias-store.js';
import { aliasesFromText } from '../lib/manga-aliases.js';
import { outcomeOf, reportSource } from '../lib/source-report.js';
import { readKv, readWork, writeKv, writeWork } from '../lib/chapter-store.js';
import { noteListed } from '../lib/update-engine.js';

/** حالات `SManga` في tachiyomi إلى حالات v35. */
export const STATUS_BY_SMANGA = {
  1: 'RELEASING',
  2: 'FINISHED',
  3: 'FINISHED',
  4: 'FINISHED',
  5: 'CANCELLED',
  6: 'HIATUS',
};

/** مرجع العمل في المزامنة: ثابت لنفس العنوان المطبَّع، وموسوم بمصدره. */
export function seriesRefOf(work) {
  return `ext:${work.key}`;
}

/**
 * فهرس الأعمال بالهوية الواحدة (ZERO DUPLICATE): نفس العمل بأسماء مختلفة بين
 * المصادر بطاقة واحدة، بالأسماء البديلة المعروفة (المشحونة + ما تعلّمه الجهاز).
 * البطاقة التي صارت جزءًا من عمل قانوني تُسجَّل مرجعًا قديمًا له، فتقدّمها
 * ومكتبتها تُقرأ معه (`refsOf`).
 */
function workIndex() {
  void loadAliases();
  const index = canonicalIndex({ aliases: aliasMap() });
  const add = index.add;
  index.add = (entry) => {
    const hit = add(entry);
    const own = normalizeTitle(entry?.manga?.title);
    if (hit && own && own !== hit.work.key) noteRefAlias(`ext:${own}`, `ext:${hit.work.key}`);
    return hit;
  };
  return index;
}

export function toV35Work(work) {
  const cover = work.thumbnailUrl ?? null;
  // القوائم تحمل أحيانًا التصنيف والحالة؛ ما لم تحمله يأتي مع التفاصيل
  const listed = work.editions?.map((e) => e.manga).find((m) => m?.genre || m?.status) ?? null;
  const fields = listed ? detailFields(listed) : null;
  return {
    id: seriesRefOf(work),
    title: { english: work.title, romaji: null, native: null },
    synonyms: work.aliases ?? [],
    status: fields?.status ?? null,
    format: null,
    countryOfOrigin: null,
    startDate: { year: null },
    chapters: null,
    volumes: null,
    genres: fields?.genres ?? [],
    averageScore: null,
    popularity: null,
    coverImage: { extraLarge: cover, large: cover, medium: cover, color: null },
    bannerImage: cover,
    description: undefined,
    staff: { edges: [] },
    _work: work,
  };
}

export function detailFields(manga) {
  const genres = String(manga?.genre ?? '')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean);
  const edges = [];
  if (manga?.author) edges.push({ role: 'Story', node: { name: { full: manga.author } } });
  if (manga?.artist) edges.push({ role: 'Art', node: { name: { full: manga.artist } } });
  return {
    description: manga?.description ?? '',
    genres,
    status: STATUS_BY_SMANGA[manga?.status] ?? null,
    staff: { edges },
  };
}

// ───────────────────────── المحرّك ─────────────────────────

let sourcesPromise = null;
function sources() {
  sourcesPromise ??= engine.sources().catch((error) => {
    sourcesPromise = null;
    throw error;
  });
  return sourcesPromise;
}

/** قائمة المصادر تُعاد من المحرّك (بعد تثبيت إضافة أو إزالتها، وفي الاختبارات). */
export function resetSources() {
  sourcesPromise = null;
}

export const available = () => engine.isAvailable();

let sharedLatest = null;
export function setSharedLatest(fetchShared) { sharedLatest = fetchShared; }
const sourceLatest = (sourceId, page) => page === 1 && sharedLatest
  ? sharedLatest(sourceId, () => engine.latest(sourceId, page))
  : engine.latest(sourceId, page);

const CHAPTER_UPDATES_KEY = 'chapterUpdates.v2';
const chapterId = (chapter) => {
  const number = chapterNumberOf(chapter);
  return number >= 0 ? `n:${number}` : `name:${normalizeTitle(chapter?.name) || chapter?.url || ''}`;
};
/** أقصى صفحات Latest للمصدر في المسح الواحد. مانجا ليك (قياس حي): 25 عملًا للصفحة، 100 تحديث في 12 ساعة، ودفعات بـ25 عملًا في الساعة. */
const LATEST_PAGES = 4;
/** رأس القائمة يُفحص دائمًا: عملٌ تحدّث وهو في القمة لا يتحرّك فيها. */
const LATEST_HEAD = 3;
const CURSOR_KEYS = 150;
const listKey = (manga) => String(manga?.url ?? '') || normalizeTitle(manga?.title);

/**
 * أي أعمال قائمة Latest صعدت منذ المسح السابق (`prev`: ترتيب مفاتيحه حينها).
 *
 * القائمة مرتّبة بآخر تحديث: ما تحدّث بعد المسح السابق يعلو كل ما لم يتحدّث،
 * وما لم يتحدّث يبقى بترتيبه القديم. فمن الأسفل: ما دامت الأعمال القديمة بنفس
 * ترتيبها فهي لم تتحرك، وأول عمل يكسر الترتيب هو وكل ما فوقه صعد. الحدّ لا يُعدّ
 * مؤكدًا إلا بعملين قديمين متتاليين في الترتيب. يرجع فهرس أول عمل ثابت، أو -1
 * إن لم يتأكد حدّ في الصفحات المقروءة بعد (فكل ما فيها صعد، والصفحة التالية تُقرأ).
 */
export function latestBoundary(keys, prev) {
  const at = new Map(prev.map((k, i) => [k, i]));
  let min = Infinity;
  let stable = -1;
  for (let i = keys.length - 1; i >= 0; i -= 1) {
    const p = at.get(keys[i]);
    if (p == null) continue;
    if (p > min) break;
    if (min !== Infinity) stable = i;
    min = p;
  }
  return stable;
}

/**
 * مسح «آخر التحديثات»: صفحات Latest لكل مصدر ثم فصول ما تحدّث فيها. الفصول
 * تمرّ على `Update Engine` (مجسّ محرك الإضافات) فيقرّر الخادم ما الجديد.
 *
 * كان يقرأ الصفحة الأولى وحدها ويجلب فصول كل أعمالها كل مرة، واحدًا واحدًا في
 * سكون الرئيسية، فلا يكتمل غالبًا: من 64 عملًا تحدّث في مانجا ليك يصل الخادمَ
 * بضعة فقط. الآن: مؤشر لكل مصدر (ترتيب قائمته في المسح السابق) فلا تُجلب إلا
 * فصول ما صعد منذها ورأس القائمة، والصفحات تُقرأ حتى يظهر الحدّ القديم (4 بحد
 * أقصى). وما صعد يُرسل بشهادة «تحدّث منذ المسح السابق» (`listed`) فلا يصير
 * خط أساس صامتًا إن كانت أول مشاهدة للعمل أو بلا تاريخ رفع.
 */
export async function collectLatestChapters(list, page, {
  latest = (id, p) => engine.latest(id, p),
  chapters = (id, manga) => engine.chapters(id, manga),
  listed = noteListed,
  now = Date.now(),
  onUpdate = () => {},
  known = { initialized: false, workChapters: {}, observed: {}, lastUpdate: {}, cursors: {} },
  concurrency = 8,
  shouldContinue = () => true,
  maxPages = LATEST_PAGES,
} = {}) {
  known ??= { initialized: false, workChapters: {}, observed: {}, lastUpdate: {}, cursors: {} };
  const entries = [];
  const next = {
    initialized: true,
    workChapters: { ...(known.workChapters ?? {}) },
    observed: { ...(known.observed ?? {}) },
    lastUpdate: { ...(known.lastUpdate ?? {}) },
    cursors: { ...(known.cursors ?? {}) },
  };
  let hasNextPage = false;

  /** صفحات المصدر حتى الحدّ القديم، وما يُجلب فصوله منها (الأقدم أولًا). */
  const plan = async (source) => {
    const prev = known.cursors?.[source.id] ?? null;
    const mangas = [];
    let more = false;
    let stable = -1;
    for (let p = page; p < page + (prev ? maxPages : 1) && shouldContinue(); p += 1) {
      const value = await withTimeout(latest(source.id, p), LISTING_TIMEOUT_MS);
      more = Boolean(value?.hasNextPage);
      if (p === page) hasNextPage ||= more;
      const seen = new Set(mangas.map(listKey));
      mangas.push(...(value?.mangas ?? []).filter((m) => listKey(m) && !seen.has(listKey(m))));
      if (!prev) break;
      stable = latestBoundary(mangas.map(listKey), prev.keys ?? []);
      if (stable >= 0 || !more) break;
    }
    if (!mangas.length) return null; // لم يُقرأ شيء: المؤشر القديم يبقى كما هو
    const keys = mangas.map(listKey);
    // بلا مسح سابق: الصفحة الأولى كلها، بلا شهادة (لا نعرف متى تحدّثت)
    const moved = !prev ? keys.length : stable >= 0 ? stable : keys.length;
    const retry = prev?.retry ?? {};
    const tasks = [];
    keys.forEach((key, position) => {
      const since = prev && position < moved ? prev.at : retry[key] ?? null;
      if (position < moved || position < LATEST_HEAD || retry[key]) tasks.push({ source, manga: mangas[position], position, key, since });
    });
    const tail = (prev?.keys ?? []).filter((k) => !keys.includes(k));
    return { tasks: tasks.reverse(), cursor: { at: now, keys: [...keys, ...tail].slice(0, CURSOR_KEYS) } };
  };

  const fetchChapters = async ({ source, manga, position, since }) => {
    if (since) listed(source.id, manga, since);
    const rows = await withTimeout(chapters(source.id, manga), LISTING_TIMEOUT_MS);
    if (!rows.length) return;
    const id = normalizeTitle(manga.title);
    if (!id) return;
    const before = new Set(known.workChapters?.[id] ?? []);
    const unseen = known.initialized ? rows.filter((r) => !before.has(chapterId(r))) : [];
    const latestKnown = rows.find((r) => chapterId(r) === known.lastUpdate?.[id]);
    const pick = latestKnown && !unseen.length ? latestKnown : (unseen.length ? unseen : rows).reduce((best, row) =>
      !best || chapterNumberOf(row) > chapterNumberOf(best) ? row : best, null);
    const observedAt = unseen.length ? now : known.observed?.[id] ?? 0;
    next.workChapters[id] = [...new Set([...(next.workChapters[id] ?? []), ...rows.map(chapterId)])];
    next.observed[id] = Math.max(next.observed[id] ?? 0, observedAt);
    if (unseen.length) next.lastUpdate[id] = chapterId(pick);
    entries.push({ source, manga, chapter: pick, chapters: rows, observedAt, position });
    onUpdate(entries, hasNextPage);
  };

  // مصدر لكل عامل: فصول المصدر الواحد واحدًا بعد واحد (لا نُغرق موقعًا)، والمصادر بالتوازي
  let sourceCursor = 0;
  const worker = async () => {
    while (sourceCursor < list.length && shouldContinue()) {
      const source = list[sourceCursor++];
      let planned;
      try {
        planned = await plan(source);
      } catch {
        planned = null;
      }
      if (!planned) continue; // مصدر لا يرد لا يحبس المصادر الأسرع، ومؤشره القديم يبقى
      const retry = {};
      for (const task of planned.tasks) {
        if (!shouldContinue()) { if (task.since) retry[task.key] = task.since; continue; }
        try {
          await fetchChapters(task);
        } catch {
          // عملٌ لم يُجلب يُعاد في المسح التالي ما دامت شهادته قائمة
          if (task.since) retry[task.key] = task.since;
        }
      }
      next.cursors[source.id] = { ...planned.cursor, ...(Object.keys(retry).length ? { retry } : {}) };
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, list.length)) }, worker));
  entries.sort((a, b) => b.observedAt - a.observedAt || a.position - b.position || sourceRank(a.source.id) - sourceRank(b.source.id));
  return { entries, hasNextPage, known: next };
}

function recentWorks(entries) {
  const index = workIndex();
  const observed = new Map();
  for (const { source, manga, chapter, chapters, observedAt } of entries) {
    const hit = index.add({ sourceId: source.id, label: source.label, manga, chapters });
    if (!hit) continue;
    if (!observed.has(hit.work.key) || observedAt > observed.get(hit.work.key).at) observed.set(hit.work.key, { chapter, at: observedAt });
  }
  const works = index.list().filter((w) => !isWestern(w));
  for (const w of works) {
    w.editions.sort((a, b) => sourceRank(a.sourceId) - sourceRank(b.sourceId));
    w.title = w.editions[0]?.manga?.title ?? w.title;
    w.thumbnailUrl = w.editions.find((e) => e.manga?.thumbnailUrl)?.manga.thumbnailUrl ?? w.thumbnailUrl;
  }
  works.sort((a, b) => observed.get(b.key).at - observed.get(a.key).at);
  return works.map((w) => {
    const count = mergeChapters(w.editions, { rank: sourceRank }).length;
    const light = { ...w, editions: w.editions.map(({ chapters, ...edition }) => edition) };
    return { ...toV35Work(light), chapters: count || null, _latestChapter: observed.get(w.key).chapter };
  });
}

/** عدد الفصول المتاحة من اتحاد المصادر، أو null إن لم يرد أي مصدر. */
export async function countWorkChapters(v35work) {
  if (Number.isInteger(v35work?.chapters) && v35work.chapters >= 0) return v35work.chapters;
  const cached = await readWork(String(v35work?.id));
  if (cached?.editions?.some((e) => e.chapters?.length) && Date.now() - (cached.at ?? 0) < 10 * 60_000)
    return mergeChapters(cached.editions, { rank: sourceRank }).length;
  const editions = v35work?._work?.editions ?? [];
  if (!editions.length) return null;
  const { ok } = await gather(editions, async (e) => ({
    ...e, chapters: await withTimeout(engine.chapters(e.sourceId, e.manga), LISTING_TIMEOUT_MS),
  }));
  if (!ok.length) return null;
  return mergeChapters(ok.map((r) => r.value), { rank: sourceRank }).length;
}

/** بطاقة العمل تقرأ العدد المحفوظ فقط؛ لا تسأل المصادر أثناء رسم الرئيسية أو البحث. */
export async function cachedWorkChapterCount(v35work) {
  if (Number.isInteger(v35work?.chapters) && v35work.chapters >= 0) return v35work.chapters;
  const cached = await readWork(String(v35work?.id)).catch(() => null);
  return cached?.editions?.some((e) => e.chapters?.length)
    ? countMainChapters(mergeChapters(cached.editions, { rank: sourceRank })) : null;
}

/**
 * مصدر «تكملة» (`<pkg>@<lang>`، الإنجليزية: MangaDex وWeeb Central وغيرهما):
 * العربي أولًا دائمًا. لا يبني قوائم؛ يملأ فقط فصول عملٍ له نسخة عربية، والفصل
 * العربي بنفس الرقم يغلبه متى نزل. ويظهر في المصادر بعد العربي، بوسم «إنجليزي».
 */
export const isFiller = (sourceId) => String(sourceId ?? '').includes('@');
/** أسماء المصادر المعروفة حين لا يحمل المصدر اسمًا (حزمة بلا name، أو نسخة من الخادم بلا label). */
const KNOWN_NAMES = {
  teamx: 'Team X', mangaswat: 'MangaSwat', manga3asq: '3asq', mangastarz: 'Manga Starz', mangaspark: 'MangaSpark',
  mangalek: 'Mangalek', hizomanga: 'HizoManga', mangalink: 'Manga Link', mangalionz: 'MangaLionz', azora: 'Azora',
  lavascans: 'Lava Scans', mangadex: 'MangaDex', mangadar: 'MangaDar', olympustaff: 'Olympus Staff',
};
/**
 * اسم بشري دائمًا: معرّف حزمة (`eu.kanade.tachiyomi.extension.ar.teamx`) لا يظهر
 * للقارئ أبدًا. الاسم المعطى يُحترم إن لم يكن هو المعرّف نفسه.
 */
export function displayName(label, sourceId) {
  const id = String(sourceId ?? '').split('@')[0];
  const raw = String(label ?? '').trim();
  if (raw && raw !== id && !/^[a-z]+(\.[a-z0-9_]+){2,}$/i.test(raw)) return raw;
  const slug = (raw || id).split('.').pop()?.toLowerCase() ?? '';
  if (KNOWN_NAMES[slug]) return KNOWN_NAMES[slug];
  return slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : 'مصدر';
}
/** اسم المصدر كما يُعرض: الإنجليزي موسوم، فلا يلتبس MangaDex العربي بالإنجليزي. */
export const sourceLabel = (s) => {
  const name = displayName(s?.label, s?.sourceId);
  return isFiller(s?.sourceId) ? `${name} · إنجليزي` : name;
};
/** شرائح المصادر: العربي أولًا ثم الإنجليزي، وداخل كلٍّ بالأوثق. */
const sourceList = (editions) =>
  [...editions]
    .sort((a, b) => sourceRank(a.sourceId) - sourceRank(b.sourceId) || String(a.sourceId).localeCompare(String(b.sourceId)))
    .map((v) => ({ sourceId: v.sourceId, label: sourceLabel(v), count: countMainChapters(v.chapters), lang: isFiller(v.sourceId) ? 'en' : 'ar' }));
/**
 * مرايا الموقع الواحد مصدر واحد في القوائم والبحث: طلب واحد لا خمسة، ونسخة واحدة
 * لا خمس. يُختار أولها في ترتيب العائلة (Mangalek يعمل حتى عبر جالب الويب حيث
 * تتحدّى Cloudflare بقية النطاقات)، والبقية بدائل في صفحة العمل.
 */
export function collapseMirrors(list) {
  const rank = (s) => MIRROR_FAMILIES.find((f) => f.includes(String(s.id).split('.').pop()))?.indexOf(String(s.id).split('.').pop()) ?? 0;
  const best = new Map();
  for (const s of list) {
    const f = mirrorFamily(s.id);
    if (f === String(s.id)) continue;
    if (!best.has(f) || rank(s) < rank(best.get(f))) best.set(f, s);
  }
  return list.filter((s) => {
    const f = mirrorFamily(s.id);
    return f === String(s.id) || best.get(f) === s;
  });
}
const listingSources = async ({ query = '', includeFillers = false } = {}) => collapseMirrors((await sources()).filter((s) => query || includeFillers || !s.filler));
/**
 * فصول التكملة تُعرض كأي فصل: «الفصل 23» لا «Chapter 23»، وبلا اسم مصدرها.
 * القارئ لا يرى لغتين؛ والترجمة تعرف الفصل الإنجليزي من `sourceId`.
 */
export function localizeFiller(rows, { keepLabel = false } = {}) {
  return rows.map((row) =>
    isFiller(row.sourceId) && row.number >= 0
      ? {
          ...row,
          label: keepLabel ? sourceLabel(row) : null,
          lang: 'en',
          chapter: { ...row.chapter, name: `الفصل ${row.number}`, originalName: row.chapter?.name ?? null },
        }
      : row,
  );
}

/** عملٌ كل نسخه تكملة ليس عملًا نعرضه: لا فصل عربي فيه. */
const hasArabic = (work) => work.editions.some((e) => !isFiller(e.sourceId));

// ───────────────── مانجا ومانهوا ومانها فقط ─────────────────
//
// لا كوميكس غربية ولا كرتون. أغلبها يأتي من مصادر عربية (Comic Verse يوسمها
// DC وMARVEL وIMAGE، وDilar «كوميك»، وMangaTime «comic»)، وبعض المصادر لا
// تعطي تصنيفًا في القوائم أصلًا (مانجا ستارز ومانجا سبارك) فيُعرف بعنوانه.
// وما كشفته صفحة تفاصيله يُحفظ على الجهاز فلا يعود للقوائم.

/** وسوم تصنيف تعني عملًا غربيًا. مطابقة كاملة للوسم: «كوميدي» ليس «كوميك». */
const WESTERN_TAGS = new Set([
  'comic', 'comics', 'western', 'western comic', 'american', 'oel', 'cartoon', 'cartoons', 'superhero comic',
  'marvel', 'marvel comics', 'dc', 'dc comics', 'image', 'image comics', 'dark horse', 'idw', 'boom! studios',
  'كوميك', 'كوميكس', 'كومكس', 'كوميكس غربي', 'كوميك غربي', 'غربي', 'غربية', 'امريكي', 'أمريكي', 'كرتون', 'كارتون', 'مارفل', 'دي سي',
]);
/** أعمال غربية لا تخطئها العين، لمصادر بلا تصنيف في القوائم. */
const WESTERN_TITLE = new RegExp(
  '\\b(' +
    [
      'batman', 'superman', 'spider[- ]?man', 'spider[- ]?verse', 'avengers', 'x-?men', 'deadpool', 'wolverine', 'iron man', 'captain america',
      'justice league', 'wonder woman', 'catwoman', 'harley quinn', 'teen titans', 'suicide squad', 'green lantern', 'aquaman',
      'fantastic four', 'guardians of the galaxy', 'doctor strange', 'black panther', 'hellboy', 'star wars', 'transformers',
      'walking dead', 'adventure time', 'simpsons', 'scooby[- ]?doo', 'ninja turtles', 'tmnt', 'lore olympus', 'gotham',
    ].join('|') +
    ')\\b',
  'i',
);
const tagsOf = (manga) =>
  String(manga?.genre ?? '')
    .split(',')
    .map((g) => g.trim().toLowerCase())
    .filter(Boolean);
/** نسخة عملٍ غربية: بوسمها أو بعنوانها. */
export function isWesternManga(manga) {
  if (!manga) return false;
  if (tagsOf(manga).some((t) => WESTERN_TAGS.has(t))) return true;
  return WESTERN_TITLE.test(String(manga.title ?? ''));
}
const WESTERN_KEY = 'vantara.western.v1';
const learnedWestern = (() => {
  try {
    return new Set(JSON.parse(localStorage.getItem(WESTERN_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
})();
function learnWestern(key) {
  if (!key || learnedWestern.has(key)) return;
  learnedWestern.add(key);
  try {
    localStorage.setItem(WESTERN_KEY, JSON.stringify([...learnedWestern].slice(-3000)));
  } catch {
    // تفضيل جهاز لا حقيقة
  }
}
/** عملٌ لا نعرضه في القوائم: أي نسخة منه غربية، أو كشفته تفاصيله قبل. */
export const isWestern = (work) => learnedWestern.has(work?.key) || (work?.editions ?? []).some((e) => isWesternManga(e.manga));

/**
 * صفحة من كل المصادر معًا، مدموجة أعمالًا.
 *
 * `kind`: `catalogue` (الكتالوج كاملًا)، `popular`، `latest`، أو بحث بنص.
 * المصدر الساقط لا يُسقط الصفحة (`gather` بـallSettled).
 */
export async function browse({ kind = 'catalogue', page = 1, query = '', genre = null, keepWestern = false } = {}) {
  const list = await listingSources({ query, includeFillers: kind === 'latest' || kind === 'latestListing' });
  // مصدرٌ معلّق لا يحبس الصفحة: 20 ثانية ثم يُتجاوز، والباقي يُعرض
  const { ok } = await gather(list, (source) =>
    withTimeout(genre
      ? engine.genre(source.id, genre, page)
      : query
      ? engine.search(source.id, query, page)
      : kind === 'popular'
        ? engine.popular(source.id, page)
        : kind === 'latest' || kind === 'latestListing'
        ? sourceLatest(source.id, page)
          : engine.catalogue(source.id, page), LISTING_TIMEOUT_MS),
  );
  const index = workIndex();
  const positions = new Map();
  let hasNextPage = false;
  // بترتيب ثابت للمصادر لا بترتيب ردّها: العنوان والغلاف الأولان من أوثقها
  for (const { source, value } of [...ok].sort((a, b) => sourceRank(a.source.id) - sourceRank(b.source.id) || String(a.source.id).localeCompare(String(b.source.id)))) {
    hasNextPage ||= Boolean(value?.hasNextPage);
    addPage(index, positions, source, value);
  }
  return { items: ranked(index, positions, query || genre ? 'search' : kind, { keepWestern }).map(toV35Work), hasNextPage, page };
}

function addPage(index, positions, source, value) {
  const mangas = value?.mangas ?? [];
  mangas.forEach((manga, pos) => {
    const hit = index.add({ sourceId: source.id, label: source.label, manga });
    if (!hit) return;
    const list = positions.get(hit.work.key) ?? [];
    list.push({ pos, len: mangas.length });
    positions.set(hit.work.key, list);
  });
}
function ranked(index, positions, kind, { keepWestern = false } = {}) {
  // `keepWestern`: البحث عن عملٍ في مكتبتك بعنوانه يجده ولو كان كوميكس
  const works = index.list().filter((w) => hasArabic(w) && (keepWestern || !isWestern(w)));
  for (const w of works) {
    w.editions.sort((a, b) => sourceRank(a.sourceId) - sourceRank(b.sourceId) || String(a.sourceId).localeCompare(String(b.sourceId)));
    // العنوان والغلاف من أوثق نسخة، لا من أول مصدر ردّ
    w.title = w.editions[0]?.manga?.title ?? w.title;
    w.thumbnailUrl = w.editions.find((e) => e.manga?.thumbnailUrl)?.manga.thumbnailUrl ?? w.thumbnailUrl;
  }
  return rankListing(works, positions, kind === 'latest' || kind === 'latestListing' ? 'latest' : 'popular');
}

/**
 * مثل `browse` لكن لا ينتظر أبطأ مصدر: `onUpdate` يُنادى مع كل مصدر يردّ
 * بالقائمة المدموجة حتى الآن. مصدرٌ ثانٍ عنده نفس العمل يُضاف إليه نسخةً، فلا
 * يبقى العمل «عاشقيًّا» لأن العاشق ردّ أولًا.
 */
export async function browseLive({ kind = 'catalogue', page = 1, query = '', genre = null } = {}, onUpdate = () => {}, {
  concurrency = Infinity, shouldContinue = () => true,
} = {}) {
  const list = await listingSources({ query, includeFillers: kind === 'latest' || kind === 'latestListing' });
  const index = workIndex();
  const positions = new Map();
  const mode = query || genre ? 'search' : kind === 'latestListing' ? 'latest' : kind;
  let hasNextPage = false;
  let timer = null;
  let showedFirst = false;
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    onUpdate({ items: ranked(index, positions, mode).map(toV35Work), hasNextPage, page });
  };
  let cursor = 0;
  const worker = async () => {
    while (cursor < list.length && shouldContinue()) {
      const source = list[cursor++];
      const t0 = Date.now();
      const stage = query ? 'search' : 'list';
      try {
        const value = await withTimeout(
          genre
            ? engine.genre(source.id, genre, page)
            : query
              ? engine.search(source.id, query, page)
              : kind === 'popular'
                ? engine.popular(source.id, page)
                : kind === 'latest' || kind === 'latestListing'
                  ? sourceLatest(source.id, page)
                  : engine.catalogue(source.id, page),
          LISTING_TIMEOUT_MS,
        );
        hasNextPage ||= Boolean(value?.hasNextPage);
        reportSource({ section: 'manga', sourceId: source.id, stage, outcome: value?.mangas?.length ? 'ok' : 'empty', ms: Date.now() - t0 });
        addPage(index, positions, source, value);
        // أول مصدر يظهر مباشرة؛ الردود التالية المتلاحقة تُجمع في رسمة واحدة.
        if (!showedFirst && positions.size) {
          showedFirst = true;
          flush();
        } else timer ??= setTimeout(flush, 250);
      } catch (error) {
        // مصدر غير متاح لا يؤخر نتائج بقية المصادر (ويُقاس سببه)
        reportSource({ section: 'manga', sourceId: source.id, stage, outcome: outcomeOf(error), reason: error?.message, ms: Date.now() - t0 });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  flush();
  return { items: ranked(index, positions, mode).map(toV35Work), hasNextPage, page };
}

/** التحقق من الفصول منفصل عن عرض قوائم latest، وبتوازي محدود. */
export async function scanLatestChapterUpdates({ onUpdate = () => {}, shouldContinue = () => true } = {}) {
  // العربية وحدها: قوائم مصادر التكملة الإنجليزية (MangaDex…) مئات الأعمال العالمية
  // كل ساعة، كانت تستهلك المسح كله وتملأ «آخر التحديثات» بأعمال لا نسخة عربية لها
  const list = await listingSources();
  const prior = (await readKv(CHAPTER_UPDATES_KEY))?.value;
  const { entries, known } = await collectLatestChapters(list, 1, {
    known: prior,
    latest: sourceLatest,
    concurrency: 3,
    shouldContinue,
    onUpdate: (found) => onUpdate(recentWorks(found)),
  });
  await writeKv(CHAPTER_UPDATES_KEY, known);
  return recentWorks(entries);
}

export { mirrorFamily } from '../lib/catalog.js';

/** خطأ المحرك → حالة التشخيص وسبب قصير يُعرض بدل «ما ردّ». */
export function failureOf(error) {
  const message = String(error?.message ?? error ?? '').trim();
  const timeout = /timeout|timed out|لم يرد|مهلة/i.test(message);
  const status = /\b(4\d\d|5\d\d)\b/.exec(message)?.[1] ?? null;
  return {
    state: timeout ? 'SOURCE_TIMEOUT' : 'SOURCE_ERROR',
    reason: timeout ? 'لم يرد في الوقت' : status === '404' ? 'العمل غير موجود فيه (404)' : status ? `ردّ بخطأ ${status}` : /cloudflare|challenge/i.test(message) ? 'حماية Cloudflare' : message ? message.slice(0, 80) : 'ردّ بخطأ',
  };
}

/** تفاصيل العمل من نسخته الأولى، وفصوله اتحادُ فصول كل نسخه. */
export async function detail(v35work) {
  const work = v35work._work;
  // نسخة واحدة لكل موقع (المرايا عائلة واحدة)، وبقية العائلة بدائل بالترتيب
  const families = new Map();
  for (const e of work.editions) {
    const f = mirrorFamily(e.sourceId);
    if (!families.has(f)) families.set(f, []);
    families.get(f).push(e);
  }
  // بقية مرايا العائلة بدائل للنسخة نفسها (نفس قاعدة البيانات ونفس الروابط)،
  // ولو لم تظهر في القائمة: القوائم تسأل مرآة واحدة فقط
  const installed = await Promise.resolve().then(sources).catch(() => []);
  for (const [f, list] of families) {
    if (f === String(list[0].sourceId) && mirrorFamily(list[0].sourceId) === String(list[0].sourceId)) continue;
    for (const s of installed) {
      if (mirrorFamily(s.id) !== f || list.some((e) => e.sourceId === s.id)) continue;
      list.push({ ...list[0], sourceId: s.id, label: s.label });
    }
  }
  const heads = [...families.values()].map((list) => list[0]);
  const [primary] = heads;
  const failures = new Map();
  const ask = async (edition, withDetail) => {
    const t0 = Date.now();
    const stage = withDetail ? 'details' : 'chapters';
    try {
      let out;
      if (withDetail) {
        const got = await engine.series(edition.sourceId, edition.manga);
        out = { ...edition, manga: { ...edition.manga, ...got.manga }, chapters: got.chapters, detail: got.manga };
      } else out = { ...edition, chapters: await engine.chapters(edition.sourceId, edition.manga) };
      reportSource({ section: 'manga', sourceId: edition.sourceId, stage, outcome: out.chapters?.length ? 'ok' : 'empty', ms: Date.now() - t0 });
      return out;
    } catch (error) {
      reportSource({ section: 'manga', sourceId: edition.sourceId, stage, outcome: outcomeOf(error), reason: error?.message, ms: Date.now() - t0 });
      throw error;
    }
  };
  const { ok } = await gather(heads, async (head) => {
    const list = families.get(mirrorFamily(head.sourceId));
    let last;
    for (const edition of list) {
      try {
        return await ask(edition, head === primary);
      } catch (error) {
        last = error;
        failures.set(edition.sourceId, failureOf(error));
      }
    }
    throw last;
  });
  const values = ok.map((r) => r.value);
  const main = values.find((v) => v.detail) ?? null;
  // أسماء العمل الأخرى من صفحته (حقلها في الـPWA، أو آخر الوصف في إضافات الـAPK):
  // القوائم القادمة تجمع نسخه بأسمائها المختلفة في بطاقة واحدة
  const altNames = main?.detail?.altNames?.length ? main.detail.altNames : aliasesFromText(main?.detail?.description);
  if (altNames.length) learnAliases(work.key, altNames);
  const chapters = localizeFiller(mergeChapters(values, { rank: sourceRank }));
  const answered = new Set(values.map((v) => v.sourceId));
  // غلافٌ غاب عن القائمة وجاء مع التفاصيل يصير غلاف العمل ويُحفظ معه
  const cover = v35work.coverImage?.large || main?.detail?.thumbnailUrl || values.find((v) => v.manga?.thumbnailUrl)?.manga.thumbnailUrl || null;
  const covered = cover && !v35work.coverImage?.large
    ? { coverImage: { extraLarge: cover, large: cover, medium: cover, color: null }, bannerImage: cover, _work: { ...work, thumbnailUrl: cover } }
    : {};
  return {
    ...v35work,
    ...covered,
    ...(main ? detailFields(main.detail) : {}),
    chapters: countMainChapters(chapters) || null,
    _chapters: chapters,
    _editions: values,
    _sources: sourceList(values),
    // المصدر الذي لم يردّ يُقال إنه لم يردّ، لا يختفي كأنه غير موجود
    // ومعه سببه: «لم يرد في الوقت» غير «ردّ بخطأ 403» غير «العمل غير موجود فيه»
    _failedSources: heads
      .filter((e) => !answered.has(e.sourceId) && !values.some((v) => mirrorFamily(v.sourceId) === mirrorFamily(e.sourceId)) && !isFiller(e.sourceId))
      .map((e) => ({ sourceId: e.sourceId, label: e.label, ...(failures.get(e.sourceId) ?? { state: 'SOURCE_ERROR', reason: 'ردّ بخطأ' }) })),
  };
}

// ───────────────── VANTARA: مصدرٌ واحد من ستة عشر ─────────────────
//
// المستخدم يرى عملًا واحدًا وفصولًا واحدة. خلف ذلك:
//   - أولوية المصادر الموثوقة: الفصل يُقرأ من مانجا ليك ثم مانجا ستارز… متى
//     ملكاه، والبقية تكمل ما ينقص.
//   - الفصول المحفوظة تُعرض فورًا، والمصادر تُسأل في الخلفية وتضيف ما جدّ.
//   - المصدر الذي لا يردّ لا يُنقص شيئًا: فصوله من آخر مرة تبقى.
//   - البحث عن العمل في المصادر التي لم نعرفه فيها صامت، ويُعاد كل 12 ساعة
//     على الأكثر، ونتيجته تُحفظ للجميع (`work.describe`).

/** أولوية الثقة. من ليس هنا يأتي بعدها بعدد فصوله. */
const TRUSTED = ['mangalek', 'mangastarz', 'teamx', 'mangaswat', 'azora', 'mangaspark'];
/**
 * والإنجليزي بعد كل العربي، وبينه بالجودة: Weeb Central (نسخ رسمية وفرق
 * معروفة)، ثم Asura للمانهوا، ثم MangaDex، ثم الأرشيفات الكبيرة. وMangaFire
 * أخيرًا: خادم صوره خلف Cloudflare على الجوال، فلا يُقرأ منه إلا ما لا يملكه غيره.
 */
const TRUSTED_EN = ['weebcentral', 'asurascans', 'mangadex', 'mangakakalot', 'mangahere', 'mangafire'];
export function sourceRank(sourceId) {
  if (isFiller(sourceId)) {
    const pkg = String(sourceId).split('@')[0].toLowerCase();
    const i = TRUSTED_EN.findIndex((t) => pkg.endsWith(`.${t}`));
    return 1000 + (i < 0 ? TRUSTED_EN.length : i);
  }
  const id = String(sourceId ?? '').toLowerCase();
  const i = TRUSTED.findIndex((t) => id.endsWith(`.${t}`) || id === t);
  return i < 0 ? TRUSTED.length : i;
}

const REDISCOVER_MS = 12 * 3600e3;
const CHAPTERS_TIMEOUT_MS = 30_000;
/** أول فتحٍ لعمل بنسخة واحدة: كم ننتظر بقية المصادر قبل أن نعرض ما عندنا. */
const FIRST_OPEN_HOLD_MS = 3500;

/** العمل كاملًا من نسخٍ بفصولها: ما تعرضه صفحة العمل ويقرؤه القارئ. */
function assemble(v35work, editions, detail, failed = []) {
  const chapters = localizeFiller(mergeChapters(editions, { rank: sourceRank }));
  const cover = v35work.coverImage?.large || detail?.thumbnailUrl || editions.find((e) => e.manga?.thumbnailUrl)?.manga.thumbnailUrl || null;
  const base = v35work._work ?? { key: String(v35work.id).replace(/^ext:/, ''), title: v35work.title?.english, editions: [] };
  const work = {
    ...base,
    thumbnailUrl: base.thumbnailUrl ?? cover,
    editions: editions.map(({ chapters: _c, ...e }) => e),
  };
  return {
    ...v35work,
    ...(cover && !v35work.coverImage?.large ? { coverImage: { extraLarge: cover, large: cover, medium: cover, color: null }, bannerImage: cover } : {}),
    ...(detail ? detailFields(detail) : {}),
    _work: work,
    chapters: countMainChapters(chapters) || null,
    _chapters: chapters,
    _editions: editions,
    _sources: sourceList(editions),
    _failedSources: failed.filter((f) => !isFiller(f.sourceId)),
  };
}

/** نسخٌ بلا تكرار، والأحدث من كل مصدر يفوز. */
function unionEditions(...lists) {
  const map = new Map();
  for (const list of lists) for (const e of list ?? []) if (e?.sourceId) map.set(e.sourceId, { ...(map.get(e.sourceId) ?? {}), ...e });
  return [...map.values()];
}

const loading = new Map();

/**
 * يفتح عملًا كـVANTARA: فورًا مما حُفظ، ثم يكبر مع كل مصدر يردّ.
 *
 * `onUpdate(full, { settled })` يُنادى بكل صورة أكمل من التي قبلها — ولا
 * تصغر أبدًا: فصلٌ عرفناه لا يختفي لأن مصدره تأخّر اليوم.
 * @returns {Promise<object>} العمل بعد أن ردّ كل ما يمكن أن يردّ
 */
export async function loadWork(v35work, { onUpdate = () => {}, discover = true } = {}) {
  const id = String(v35work.id);
  const cached = await readWork(id);
  let editions = unionEditions(
    (v35work._work?.editions ?? []).map((e) => ({ ...e, chapters: cached?.editions?.find((c) => c.sourceId === e.sourceId)?.chapters ?? null })),
    cached?.editions,
  );
  let detail = cached?.detail ?? null;
  const failed = new Map();
  let last = null;
  let held = false;
  const emit = (settled = false) => {
    if (held && !settled) return last;
    const withChapters = editions.filter((e) => e.chapters?.length);
    const full = assemble(v35work, withChapters.length ? withChapters : editions, detail, [...failed.values()]);
    if (!settled && last && (full._chapters?.length ?? 0) === (last._chapters?.length ?? 0) && full.description === last.description) return last;
    last = full;
    onUpdate(full, { settled });
    return full;
  };
  if (cached?.editions?.some((e) => e.chapters?.length)) emit();

  const refresh = async (list) => {
    // التفاصيل (النبذة والتصنيف) من أوثق نسخة
    const primary = [...list].sort((a, b) => sourceRank(a.sourceId) - sourceRank(b.sourceId))[0];
    await Promise.allSettled(
      list.map(async (edition) => {
        try {
          if (edition === primary && !detail) {
            const out = await withTimeout(engine.series(edition.sourceId, edition.manga), CHAPTERS_TIMEOUT_MS);
            detail = out.manga ?? detail;
            // التفاصيل كشفت كوميكس غربية: لا تعود للقوائم على هذا الجهاز
            if (isWesternManga(detail)) learnWestern(v35work._work?.key);
            edition = { ...edition, manga: { ...edition.manga, ...out.manga }, chapters: out.chapters };
          } else {
            edition = { ...edition, chapters: await withTimeout(engine.chapters(edition.sourceId, edition.manga), CHAPTERS_TIMEOUT_MS) };
          }
          failed.delete(edition.sourceId);
          // مصدرٌ ردّ بلا فصول اليوم لا يمحو ما عرفناه منه أمس
          if (edition.chapters?.length || !editions.find((e) => e.sourceId === edition.sourceId)?.chapters?.length) {
            editions = unionEditions(editions, [edition]);
          }
          emit();
        } catch {
          failed.set(edition.sourceId, { sourceId: edition.sourceId, label: edition.label });
        }
      }),
    );
  };

  // عملٌ لا نعرف له إلا نسخة واحدة ولا شيء محفوظ: فصولها وحدها ليست الحقيقة
  // (36 من العاشق وعند غيره 600). نسأل الباقين معها، ولا نعرض شيئًا حتى يردّوا
  // أو تمضي لحظة — الهيكل يبقى بلا رسالة «نبحث».
  const lonely = !cached && editions.length <= 1;
  if (lonely) {
    held = true;
    setTimeout(() => {
      held = false;
      emit();
    }, FIRST_OPEN_HOLD_MS);
  }
  // مصدرٌ جديد (التكملة الإنجليزية بعد تحديث) يُسأل عن العمل فورًا لا بعد 12 ساعة
  const sourceIds = available() ? (await sources().catch(() => [])).map((s) => s.id) : [];
  // (نسخةٌ محفوظة قبل هذا الحقل تُعامل كأنها لم تُسأل عن أي مصدر: تُكتشف مرة)
  const askedBefore = cached ? cached.discoveredSources ?? [] : sourceIds;
  const newSource = sourceIds.some((sid) => !askedBefore.includes(sid));
  const due = discover && available() && (newSource || Date.now() - (cached?.discoveredAt ?? 0) > REDISCOVER_MS);
  const discovery = due
    ? (async () => {
        try {
          const found = (await discoverEditions(assemble(v35work, editions, detail))).filter((e) => !editions.some((x) => x.sourceId === e.sourceId));
          if (found.length) {
            editions = unionEditions(editions, found.map((e) => ({ ...e, chapters: null })));
            await refresh(found);
          }
          return true;
        } catch {
          // الاكتشاف تكميلي: ما عندنا يبقى
          return false;
        }
      })()
    : Promise.resolve(false);

  await Promise.all([refresh(editions), discovery]);
  held = false;
  const full = emit(true);
  const discoveredNow = await discovery;
  await writeWork(id, {
    editions,
    detail,
    discoveredAt: discoveredNow ? Date.now() : cached?.discoveredAt ?? 0,
    discoveredSources: discoveredNow ? sourceIds : cached?.discoveredSources ?? (cached ? [] : sourceIds),
  });
  return full;
}

/** فتحٌ واحد لكل عمل في نفس الوقت: البطاقة والتسخين المسبق لا يسألان مرتين. */
export function loadWorkOnce(v35work, opts) {
  const id = String(v35work.id);
  if (!opts?.onUpdate && loading.has(id)) return loading.get(id);
  const p = loadWork(v35work, opts).finally(() => loading.delete(id));
  if (!opts?.onUpdate) loading.set(id, p);
  return p;
}

/**
 * تسخين مسبق: أعمال مكتبتك وآخر ما فتحت تُجمع فصولها في الخلفية، واحدًا
 * واحدًا وبلا استعجال، فتُفتح جاهزة. عملٌ جُمع خلال ست ساعات يُترك.
 */
export async function prewarm(works, { onDone = () => {}, maxAgeMs = 6 * 3600e3, shouldContinue = () => true } = {}) {
  if (!available()) return;
  for (const w of works) {
    if (!shouldContinue()) return;
    if (!w?._work?.editions?.length) continue;
    const cached = await readWork(String(w.id));
    if (cached && Date.now() - (cached.at ?? 0) < maxAgeMs) continue;
    try {
      const full = await loadWorkOnce(w, {});
      onDone(full);
    } catch {
      // التالي
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

// ───────────────── نسخ العمل في كل المصادر ─────────────────
//
// الدمج بالعنوان لا يجمع إلا ما صادف أنه في نفس صفحة الكتالوج: عملٌ في
// الصفحة الأولى عند «العاشق» والعاشرة عند «مانجا ليك» كان يُفتح بنسخة واحدة
// وفصولها وحدها (37 إلى 68 مثلًا). فعند فتح العمل يُسأل كل مصدر عنه بعنوانه،
// وتُضم كل نسخة يطابق عنوانها، وتُجمع فصولها مع ما عندنا.

const SEARCH_TIMEOUT_MS = 15_000;
const LISTING_TIMEOUT_MS = 20_000;
const discovered = new Map();

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

/** عناوين العمل كما تسمّيه نسخه المعروفة: كل واحد منها سؤال ومفتاح مطابقة. */
function titleVariants(v35work) {
  // أسماؤه البديلة أيضًا: مصدر يسمّيه «Demonic Emperor» يُسأل بهذا الاسم لا بـ«Magic emperor»
  const raw = [v35work.title?.english, v35work.title?.romaji, v35work._work?.title, ...(v35work._work?.editions ?? []).map((e) => e.manga?.title), ...(v35work.synonyms ?? []), ...(aliasMap().get(v35work._work?.key) ?? [])];
  const seen = new Set();
  return raw.filter((t) => {
    if (typeof t !== 'string' || !t.trim() || t.startsWith('ext:')) return false;
    const key = normalizeTitle(t);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * نسخ العمل في المصادر التي لم نعرف أنه فيها. تُحفظ للجلسة؛ والمصدر الذي لا
 * يردّ خلال 15 ثانية يُتجاوز بلا أن يؤخّر غيره.
 * @returns {Promise<Array<{sourceId, label, manga}>>}
 */
export function discoverEditions(v35work) {
  const key = v35work.id;
  if (discovered.has(key)) return discovered.get(key);
  const promise = (async () => {
    const variants = titleVariants(v35work);
    if (!variants.length) return [];
    const known = new Set((v35work._work?.editions ?? []).map((e) => e.sourceId));
    const others = (await sources()).filter((s) => !known.has(s.id));
    // العنوان كما يُكتب أولًا (بعض المواقع تطابق النص حرفيًّا)، ثم بلا رموز،
    // ثم عنوان النسخة الثانية إن اختلف — ثلاثة أسئلة على الأكثر لكل مصدر
    const queries = [...new Set([variants[0].trim(), normalizeTitle(variants[0]), variants[1]?.trim()].filter(Boolean))].slice(0, 3);
    const { ok } = await gather(others, async (source) => {
      for (const query of queries) {
        const page = await withTimeout(engine.search(source.id, query, 1), SEARCH_TIMEOUT_MS).catch(() => null);
        const hit = (page?.mangas ?? []).find((m) => variants.some((v) => titlesMatch(m.title, v)));
        if (hit) return { sourceId: source.id, label: source.label, manga: hit };
      }
      return null;
    });
    return ok.map((r) => r.value).filter(Boolean);
  })();
  promise.catch(() => discovered.delete(key));
  discovered.set(key, promise);
  return promise;
}

/**
 * يضيف نسخًا مكتشفة إلى عملٍ فُتح: فصولها تُجلب ثم يُعاد جمع الفصول كلها.
 * يرجع العمل كما هو إن لم تضف النسخ الجديدة شيئًا.
 */
export async function withEditions(full, found) {
  // ما صار نسخةً معروفة (من فتحة سابقة حُفظت) لا يُجلب مرتين
  const have = new Set((full._editions ?? []).map((e) => e.sourceId));
  found = found.filter((e) => !have.has(e.sourceId));
  if (!found.length) return full;
  const { ok, failed } = await gather(found, async (edition) => ({
    ...edition,
    chapters: await withTimeout(engine.chapters(edition.sourceId, edition.manga), 30_000),
  }));
  const fresh = ok.map((r) => r.value).filter((v) => v.chapters?.length);
  if (!fresh.length) return full;
  const editions = [...(full._editions ?? []), ...fresh];
  const chapters = localizeFiller(mergeChapters(editions, { rank: sourceRank }));
  const work = { ...full._work, editions: [...(full._work?.editions ?? []), ...fresh.map(({ chapters: _c, ...e }) => e)] };
  return {
    ...full,
    _work: work,
    chapters: countMainChapters(chapters) || null,
    _chapters: chapters,
    _editions: editions,
    _sources: sourceList(editions),
    _failedSources: [...(full._failedSources ?? []), ...failed.filter((f) => !isFiller(f.source.sourceId)).map((f) => ({ sourceId: f.source.sourceId, label: f.source.label }))],
  };
}

/**
 * فصول نسخةٍ واحدة كما هي عند مصدرها، بنفس شكل صفوف `mergeChapters`.
 *
 * اختيار مصدر في صفحة العمل يعرض هذه: رقم الفصل نفسه يبقى نفس مفتاح العين،
 * فما علّمته من مصدر يظهر مقروءًا في غيره.
 */
export function editionRows(v35work, sourceId) {
  const edition = v35work._editions?.find((e) => e.sourceId === sourceId);
  if (!edition) return [];
  // فصول مصدر إنجليزي بعينه: «الفصل 23» واسم مصدرها، والقارئ يعرف أنها تُترجم
  return localizeFiller(mergeChapters([edition]), { keepLabel: true });
}

/**
 * وين وصل العربي ووين وصل الإنجليزي لعمل من نسخه بفصولها: المصادر الإنجليزية
 * (`@`) تكمّل، وكل ما عداها عربي. لرفيق: «العربي واقف عند 22 والإنجليزي 72».
 */
export function chapterSpan(editions) {
  let ar = 0;
  let en = 0;
  for (const e of editions ?? []) {
    if (!e?.chapters?.length) continue;
    let max = 0;
    for (const row of mergeChapters([e])) if (Number.isFinite(row.number) && row.number > max) max = row.number;
    if (isFiller(e.sourceId)) en = Math.max(en, max);
    else ar = Math.max(ar, max);
  }
  return { ar, en };
}

/** نفسه من المحفوظ على الجهاز، بلا شبكة. `null` = ما جُمعت فصوله بعد. */
export async function cachedSpan(id) {
  const cached = await readWork(String(id)).catch(() => null);
  return cached?.editions?.some((e) => e.chapters?.length) ? chapterSpan(cached.editions) : null;
}

const described = new Map();

/**
 * نبذة العمل وتصنيفه لورقة المعاينة، من نسخةٍ واحدة لا من كل المصادر.
 *
 * ورقة المعاينة في المجلس تحتاج سطرين لا فصول العمل كلها. فإن لم تكن نُسخه
 * معروفة هنا يُبحث عنه بعنوانه أولًا. والنتيجة تُحفظ للجلسة، والفشل لا يُحفظ.
 */
export function describe(v35work) {
  const key = v35work.id;
  if (described.has(key)) return described.get(key);
  const promise = (async () => {
    let work = v35work;
    if (!work._work?.editions?.length) {
      const title = work.title?.english ?? '';
      if (!title || title.startsWith('ext:')) return work;
      const { items } = await browse({ query: title, keepWestern: true });
      work = items.find((x) => x.id === work.id) ?? items.find((x) => titlesMatch(x.title?.english, title)) ?? work;
    }
    const primary = work._work?.editions?.[0];
    if (!primary) return work;
    const out = await engine.series(primary.sourceId, primary.manga);
    // الغلاف من التفاصيل: كثيرًا ما يكون هو الصحيح والقائمة بلا غلاف
    const thumb = out.manga?.thumbnailUrl || work._work?.thumbnailUrl || null;
    return {
      ...work,
      ...detailFields(out.manga),
      _work: { ...work._work, thumbnailUrl: thumb },
      ...(thumb && !work.coverImage?.large ? { coverImage: { extraLarge: thumb, large: thumb, medium: thumb, color: null }, bannerImage: thumb } : {}),
      _chapterCount: out.chapters ? countMainChapters(out.chapters) : null,
    };
  })();
  promise.catch(() => described.delete(key));
  described.set(key, promise);
  return promise;
}

// ───────────────── فحص المصادر ─────────────────

export const CHECK_STEPS = [
  ['list', 'القائمة'],
  ['search', 'البحث'],
  ['chapters', 'الفصول'],
  ['pages', 'الصفحات'],
  ['image', 'صورة صفحة'],
  ['cover', 'الغلاف'],
];

/**
 * يمرّ على مصدر كما يمرّ القارئ: قائمة ← بحث ← فصول ← صفحات ← صورة ← غلاف.
 * كل خطوة بوقتها وسببها إن سقطت، فالعطل يُعرف بمكانه لا بـ«المصدر خربان».
 */
export async function checkSource(source, onStep = () => {}) {
  const out = {};
  const step = async (key, fn) => {
    const t0 = performance.now();
    try {
      const detail = await withTimeout(fn(), 25_000);
      out[key] = { ok: true, ms: Math.round(performance.now() - t0), detail };
    } catch (error) {
      out[key] = { ok: false, ms: Math.round(performance.now() - t0), error: String(error?.message ?? error).slice(0, 160) };
    }
    onStep(key, out[key]);
    reportSource({ section: 'manga', sourceId: source.id, stage: `check_${key}`, outcome: out[key].ok ? 'ok' : outcomeOf(out[key].error), reason: out[key].error, ms: out[key].ms });
    return out[key].ok;
  };
  let manga = null;
  let candidates = [];
  let chapter = null;
  let page = null;
  if (
    !(await step('list', async () => {
      // «استكشاف» يتصفح الكتالوج لا الرائج: رائج MangaDex العربي فارغ وكتالوجه ~990 عملًا
      let res = await engine.popular(source.id, 1).catch(() => null);
      if (!res?.mangas?.length) res = await engine.catalogue(source.id, 1);
      candidates = res?.mangas ?? [];
      manga = candidates[0] ?? null;
      if (!manga) throw new Error('القائمة فاضية');
      return `${res.mangas.length} عمل`;
    }))
  )
    return out;
  await step('search', async () => {
    const word = String(manga.title ?? '').split(/\s+/).find((w) => w.length > 2) ?? manga.title;
    const res = await engine.search(source.id, word, 1);
    if (!res?.mangas?.length) throw new Error(`ما رجع شي لـ«${word}»`);
    return `${res.mangas.length} نتيجة`;
  });
  if (
    await step('chapters', async () => {
      // عملٌ واحد بلا فصول (ون شوت محجوب، أو أُضيف للتو) لا يعني أن المصدر معطّل: حتى ثلاثة أعمال
      for (const candidate of candidates.slice(0, 3)) {
        const list = await engine.chapters(source.id, candidate);
        if (!list?.length) continue;
        manga = candidate;
        chapter = list[list.length - 1];
        return `${list.length} فصل`;
      }
      throw new Error('بلا فصول');
    })
  ) {
    if (
      await step('pages', async () => {
        const list = await engine.pages(source.id, chapter);
        if (!list?.length) throw new Error('بلا صفحات');
        page = list[0];
        return `${list.length} صفحة`;
      })
    ) {
      await step('image', async () => {
        const res = await engine.pageImage(source.id, page);
        return res?.bytes ? `${Math.round(res.bytes / 1024)} ك.ب` : 'وصلت';
      });
    }
  }
  if (manga.thumbnailUrl) await step('cover', async () => (await engine.cover(source.id, manga.thumbnailUrl), 'وصل'));
  else out.cover = { ok: false, ms: 0, error: 'المصدر ما يعطي غلاف' };
  return out;
}

export async function checkAllSources(onSource = () => {}, onStep = () => {}) {
  const list = await sources();
  const queue = [...list];
  const results = new Map();
  const worker = async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      onSource(s);
      results.set(s.id, await checkSource(s, (key, r) => onStep(s, key, r)));
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { list, results };
}
