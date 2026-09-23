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
import { createWorkIndex, gather, mergeChapters, normalizeTitle, titlesMatch } from '../lib/catalog.js';
import { readWork, writeWork } from '../lib/chapter-store.js';

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
  // مصدرٌ معلّق لا يحبس الصفحة: 20 ثانية ثم يُتجاوز، والباقي يُعرض
  const { ok } = await gather(list, (source) =>
    withTimeout(genre
      ? engine.genre(source.id, genre, page)
      : query
      ? engine.search(source.id, query, page)
      : kind === 'popular'
        ? engine.popular(source.id, page)
        : kind === 'latest'
          ? engine.latest(source.id, page)
          : engine.catalogue(source.id, page), LISTING_TIMEOUT_MS),
  );
  const index = createWorkIndex();
  let hasNextPage = false;
  for (const { source, value } of ok) {
    hasNextPage ||= Boolean(value?.hasNextPage);
    for (const manga of value?.mangas ?? []) index.add({ sourceId: source.id, label: source.label, manga });
  }
  return { items: index.list().map(toV35Work), hasNextPage, page };
}

/**
 * مثل `browse` لكن لا ينتظر أبطأ مصدر: `onUpdate` يُنادى مع كل مصدر يردّ
 * بالقائمة المدموجة حتى الآن. مصدرٌ ثانٍ عنده نفس العمل يُضاف إليه نسخةً، فلا
 * يبقى العمل «عاشقيًّا» لأن العاشق ردّ أولًا.
 */
export async function browseLive({ kind = 'catalogue', page = 1, query = '', genre = null } = {}, onUpdate = () => {}) {
  const list = await sources();
  const index = createWorkIndex();
  let hasNextPage = false;
  let timer = null;
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    onUpdate({ items: index.list().map(toV35Work), hasNextPage, page });
  };
  await Promise.allSettled(
    list.map(async (source) => {
      const value = await withTimeout(
        genre
          ? engine.genre(source.id, genre, page)
          : query
            ? engine.search(source.id, query, page)
            : kind === 'popular'
              ? engine.popular(source.id, page)
              : kind === 'latest'
                ? engine.latest(source.id, page)
                : engine.catalogue(source.id, page),
        LISTING_TIMEOUT_MS,
      );
      hasNextPage ||= Boolean(value?.hasNextPage);
      for (const manga of value?.mangas ?? []) index.add({ sourceId: source.id, label: source.label, manga });
      // الردود المتلاحقة تُجمع في رسمة واحدة كل ربع ثانية
      timer ??= setTimeout(flush, 250);
    }),
  );
  flush();
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
  const chapters = mergeChapters(values, { rank: sourceRank });
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
    chapters: chapters.length || null,
    _chapters: chapters,
    _editions: values,
    _sources: values.map((v) => ({ sourceId: v.sourceId, label: v.label, count: v.chapters?.length ?? 0 })),
    // المصدر الذي لم يردّ يُقال إنه لم يردّ، لا يختفي كأنه غير موجود
    _failedSources: work.editions.filter((e) => !answered.has(e.sourceId)).map((e) => ({ sourceId: e.sourceId, label: e.label })),
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
export function sourceRank(sourceId) {
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
  const chapters = mergeChapters(editions, { rank: sourceRank });
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
    chapters: chapters.length || null,
    _chapters: chapters,
    _editions: editions,
    _sources: editions.map((v) => ({ sourceId: v.sourceId, label: v.label, count: v.chapters?.length ?? 0 })),
    _failedSources: failed,
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
  const due = discover && available() && Date.now() - (cached?.discoveredAt ?? 0) > REDISCOVER_MS;
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
  await writeWork(id, { editions, detail, discoveredAt: (await discovery) ? Date.now() : cached?.discoveredAt ?? 0 });
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
export async function prewarm(works, { onDone = () => {}, maxAgeMs = 6 * 3600e3 } = {}) {
  if (!available()) return;
  for (const w of works) {
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
  const raw = [v35work.title?.english, v35work.title?.romaji, v35work._work?.title, ...(v35work._work?.editions ?? []).map((e) => e.manga?.title)];
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
  const chapters = mergeChapters(editions, { rank: sourceRank });
  const work = { ...full._work, editions: [...(full._work?.editions ?? []), ...fresh.map(({ chapters: _c, ...e }) => e)] };
  return {
    ...full,
    _work: work,
    chapters: chapters.length || null,
    _chapters: chapters,
    _editions: editions,
    _sources: editions.map((v) => ({ sourceId: v.sourceId, label: v.label, count: v.chapters?.length ?? 0 })),
    _failedSources: [...(full._failedSources ?? []), ...failed.map((f) => ({ sourceId: f.source.sourceId, label: f.source.label }))],
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
