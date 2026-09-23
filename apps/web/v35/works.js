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
import { createWorkIndex, gather, mergeChapters } from '../lib/catalog.js';

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

export function toV35Work(work) {
  const cover = work.thumbnailUrl ?? null;
  // القوائم تحمل أحيانًا التصنيف والحالة؛ ما لم تحمله يأتي مع التفاصيل
  const listed = work.editions?.map((e) => e.manga).find((m) => m?.genre || m?.status) ?? null;
  const fields = listed ? detailFields(listed) : null;
  return {
    id: seriesRefOf(work),
    title: { english: work.title, romaji: null, native: null },
    synonyms: [],
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

export const available = () => engine.isAvailable();

/**
 * صفحة من كل المصادر معًا، مدموجة أعمالًا.
 *
 * `kind`: `catalogue` (الكتالوج كاملًا)، `popular`، `latest`، أو بحث بنص.
 * المصدر الساقط لا يُسقط الصفحة (`gather` بـallSettled).
 */
export async function browse({ kind = 'catalogue', page = 1, query = '', genre = null } = {}) {
  const list = await sources();
  const { ok } = await gather(list, (source) =>
    genre
      ? engine.genre(source.id, genre, page)
      : query
      ? engine.search(source.id, query, page)
      : kind === 'popular'
        ? engine.popular(source.id, page)
        : kind === 'latest'
          ? engine.latest(source.id, page)
          : engine.catalogue(source.id, page),
  );
  const index = createWorkIndex();
  let hasNextPage = false;
  for (const { source, value } of ok) {
    hasNextPage ||= Boolean(value?.hasNextPage);
    for (const manga of value?.mangas ?? []) index.add({ sourceId: source.id, label: source.label, manga });
  }
  return { items: index.list().map(toV35Work), hasNextPage, page };
}

/** تفاصيل العمل من نسخته الأولى، وفصوله اتحادُ فصول كل نسخه. */
export async function detail(v35work) {
  const work = v35work._work;
  const [primary] = work.editions;
  const { ok } = await gather(work.editions, async (edition) => {
    if (edition === primary) {
      const out = await engine.series(edition.sourceId, edition.manga);
      return { ...edition, manga: { ...edition.manga, ...out.manga }, chapters: out.chapters, detail: out.manga };
    }
    return { ...edition, chapters: await engine.chapters(edition.sourceId, edition.manga) };
  });
  const values = ok.map((r) => r.value);
  const main = values.find((v) => v.detail) ?? null;
  const chapters = mergeChapters(values);
  const answered = new Set(values.map((v) => v.sourceId));
  return {
    ...v35work,
    ...(main ? detailFields(main.detail) : {}),
    chapters: chapters.length || null,
    _chapters: chapters,
    _editions: values,
    _sources: values.map((v) => ({ sourceId: v.sourceId, label: v.label, count: v.chapters?.length ?? 0 })),
    // المصدر الذي لم يردّ يُقال إنه لم يردّ، لا يختفي كأنه غير موجود
    _failedSources: work.editions.filter((e) => !answered.has(e.sourceId)).map((e) => ({ sourceId: e.sourceId, label: e.label })),
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
  return mergeChapters([edition]);
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
      const { items } = await browse({ query: title });
      work = items.find((x) => x.id === work.id) ?? items[0] ?? work;
    }
    const primary = work._work?.editions?.[0];
    if (!primary) return work;
    const out = await engine.series(primary.sourceId, primary.manga);
    return { ...work, ...detailFields(out.manga), _chapterCount: out.chapters?.length ?? null };
  })();
  promise.catch(() => described.delete(key));
  described.set(key, promise);
  return promise;
}
