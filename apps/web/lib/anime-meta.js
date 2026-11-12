/**
 * بيانات الأنمي الوصفية — من AniList (GraphQL عام، مجاني، يسمح بالطلب من المتصفح).
 *
 * هذه طبقة «ما هو العمل»: العنوان والبوستر والبانر ولونه، الموسم، الحلقات،
 * التقييم، ومتى تنزل الحلقة القادمة. أما «أين أشاهده» (السيرفرات وروابط
 * البث) فمن امتدادات المصادر العربية داخل محرّك التطبيق، وتُربط بالعمل هنا
 * بمعرّفه (`idMal` يطابقه أغلب المصادر، والعنوان احتياطًا).
 *
 * طلب واحد يجمع الرئيسية كلها (الرائج، حلقات الأسبوع، الأشهر، الأعلى
 * تقييمًا) لأن حدّ AniList بالدقيقة، والرئيسية تُفتح كثيرًا.
 */

const ENDPOINT = 'https://graphql.anilist.co';

const CARD = `id idMal title { romaji english native } coverImage { extraLarge large color } bannerImage
  genres averageScore popularity episodes duration format status season seasonYear isAdult
  nextAiringEpisode { episode airingAt } studios(isMain: true) { nodes { name } }`;

const HOME_QUERY = `query ($season: MediaSeason, $year: Int, $from: Int, $to: Int, $until: Int) {
  trending: Page(perPage: 14) { media(type: ANIME, sort: TRENDING_DESC, isAdult: false) { ${CARD} description(asHtml: false) } }
  season: Page(perPage: 10) { media(type: ANIME, season: $season, seasonYear: $year, sort: POPULARITY_DESC, isAdult: false) { ${CARD} } }
  popular: Page(perPage: 18) { media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) { ${CARD} } }
  top: Page(perPage: 18) { media(type: ANIME, sort: SCORE_DESC, isAdult: false, popularity_greater: 40000) { ${CARD} } }
  schedule: Page(perPage: 40) { airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME_DESC) { episode airingAt media { ${CARD} } } }
  upcoming: Page(perPage: 50) { airingSchedules(airingAt_greater: $to, airingAt_lesser: $until, sort: TIME) { episode airingAt media { ${CARD} } } }
}`;

const DETAIL_QUERY = `query ($id: Int) {
  Media(id: $id, type: ANIME) {
    ${CARD} description(asHtml: false) source startDate { year month day } synonyms favourites rankings { rank type allTime context }
    streamingEpisodes { title thumbnail }
    relations { edges { relationType node { ${CARD} type } } }
    recommendations(perPage: 12, sort: RATING_DESC) { nodes { mediaRecommendation { ${CARD} } } }
    characters(perPage: 16, sort: [ROLE, RELEVANCE, ID]) { edges { role node { id name { full } image { large } } voiceActors(language: JAPANESE, sort: RELEVANCE) { name { full } } } }
  }
}`;

const SEARCH_QUERY = `query ($search: String, $genre: String, $page: Int) {
  Page(page: $page, perPage: 24) {
    pageInfo { hasNextPage }
    media(type: ANIME, search: $search, genre: $genre, sort: [POPULARITY_DESC], isAdult: false) { ${CARD} }
  }
}`;

/** مواسم AniList: شتاء (يناير–مارس)، ربيع، صيف، خريف. */
export function seasonOf(date = new Date()) {
  const m = date.getMonth();
  const season = ['WINTER', 'SPRING', 'SUMMER', 'FALL'][Math.floor(m / 3)];
  return { season, year: date.getFullYear() };
}

export const SEASON_AR = { WINTER: 'شتاء', SPRING: 'ربيع', SUMMER: 'صيف', FALL: 'خريف' };
export const FORMAT_AR = { TV: 'مسلسل', TV_SHORT: 'حلقات قصيرة', MOVIE: 'فيلم', SPECIAL: 'حلقة خاصة', OVA: 'OVA', ONA: 'ONA', MUSIC: 'موسيقي' };
export const STATUS_AR = { RELEASING: 'يُعرض الآن', FINISHED: 'مكتمل', NOT_YET_RELEASED: 'قريبًا', CANCELLED: 'ملغي', HIATUS: 'متوقف' };
/** علاقات «من نفس العالم» بكلمة قصيرة (المانجا وما يرتبط بلا تصنيف أدق من AniList). */
export const WORLD_AR = { PREQUEL: 'الجزء السابق', SEQUEL: 'الجزء التالي', PARENT: 'الأصل', SIDE_STORY: 'قصة جانبية', SPIN_OFF: 'عمل منبثق', ALTERNATIVE: 'نسخة أخرى', SUMMARY: 'ملخص', ADAPTATION: 'الأصل', SOURCE: 'الأصل', OTHER: 'عمل مرتبط' };
export const RELATION_AR = { SEQUEL: 'الجزء التالي', PREQUEL: 'الجزء السابق', SIDE_STORY: 'قصة جانبية', SPIN_OFF: 'عمل منبثق', ALTERNATIVE: 'نسخة أخرى', PARENT: 'الأصل', SUMMARY: 'ملخص' };

/** أقصر اسم مقروء: الإنجليزي إن وُجد، ثم الروماجي. */
export function animeTitle(m) {
  return m?.title?.english || m?.title?.romaji || m?.title?.native || '—';
}

/** عدد الحلقات المعروضة فعلًا: للمستمر ما قبل القادمة، وللمكتمل كلها. */
export function airedEpisodes(m) {
  if (m?.nextAiringEpisode?.episode) return Math.max(0, m.nextAiringEpisode.episode - 1);
  if (m?.status === 'NOT_YET_RELEASED') return 0;
  return m?.episodes ?? 0;
}

/** عمل AniList بالشكل الذي تعرفه الواجهة. */
export function normalize(m) {
  if (!m || m.isAdult) return null;
  return {
    id: m.id,
    idMal: m.idMal ?? null,
    title: animeTitle(m),
    romaji: m.title?.romaji ?? null,
    native: m.title?.native ?? null,
    poster: m.coverImage?.extraLarge || m.coverImage?.large || null,
    posterSmall: m.coverImage?.large || m.coverImage?.extraLarge || null,
    banner: m.bannerImage || null,
    color: m.coverImage?.color || null,
    genres: m.genres ?? [],
    score: m.averageScore ? m.averageScore / 10 : null,
    popularity: m.popularity ?? 0,
    episodes: m.episodes ?? null,
    aired: airedEpisodes(m),
    duration: m.duration ?? null,
    format: m.format ?? null,
    status: m.status ?? null,
    season: m.season ?? null,
    year: m.seasonYear ?? null,
    next: m.nextAiringEpisode ? { episode: m.nextAiringEpisode.episode, at: m.nextAiringEpisode.airingAt * 1000 } : null,
    studio: m.studios?.nodes?.[0]?.name ?? null,
    description: cleanDescription(m.description),
  };
}

/** وصف AniList يأتي بوسوم <br> و<i> حتى مع asHtml:false أحيانًا. */
export function cleanDescription(text) {
  if (!text) return '';
  return String(text)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\(Source:[^)]*\)/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** حلقات الأسبوع: أحدث حلقة لكل عمل، الأحدث أولًا، بلا تكرار. */
export function latestEpisodes(schedules) {
  const seen = new Set();
  const out = [];
  for (const s of schedules ?? []) {
    const m = normalize(s.media);
    if (!m || seen.has(m.id)) continue;
    // حلقات لا يعرفها أحد (بلا شعبية) تملأ الشريط بلا فائدة
    if (m.popularity < 3000) continue;
    seen.add(m.id);
    out.push({ ...m, episode: s.episode, airedAt: s.airingAt * 1000 });
  }
  return out;
}

/**
 * جدول البث: كل حلقة عُرضت أو ستُعرض في الأسبوع، بوقتها، مرتّبة زمنيًا.
 * بلا تكرار لنفس الحلقة، وبلا أعمال لا يعرفها أحد (كما في «حلقات جديدة»).
 */
export function airingWeek(past, upcoming, { minPopularity = 3000 } = {}) {
  const seen = new Set();
  const out = [];
  for (const s of [...(past ?? []), ...(upcoming ?? [])]) {
    const m = normalize(s.media);
    if (!m || m.popularity < minPopularity) continue;
    const key = `${m.id}:${s.episode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...m, episode: s.episode, airingAt: s.airingAt * 1000 });
  }
  return out.sort((a, b) => a.airingAt - b.airingAt);
}

/** مفتاح اليوم بتوقيت مكة (YYYY-MM-DD): اليوم يبدأ وينتهي في السعودية لا في جهاز الخادم. */
export const meccaDay = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });

const list = (page) => (page?.media ?? []).map(normalize).filter(Boolean);

/** يفكّ ردّ الرئيسية إلى قوائم جاهزة للعرض. */
export function parseHome(data) {
  const trending = list(data?.trending);
  return {
    // البانر يحتاج صورة عريضة: ما بلا بانر لا يصلح للواجهة الأولى
    hero: trending.filter((m) => m.banner).slice(0, 7),
    trending,
    season: list(data?.season),
    popular: list(data?.popular),
    top: list(data?.top),
    latest: latestEpisodes(data?.schedule?.airingSchedules),
    week: airingWeek(data?.schedule?.airingSchedules, data?.upcoming?.airingSchedules),
  };
}

export function parseDetail(data) {
  const media = data?.Media;
  const base = normalize(media);
  if (!base) return null;
  const relations = (media.relations?.edges ?? [])
    .filter((e) => e.node?.type === 'ANIME' && RELATION_AR[e.relationType])
    .map((e) => ({ ...normalize(e.node), relation: RELATION_AR[e.relationType] }))
    .filter((m) => m.id);
  const recommendations = (media.recommendations?.nodes ?? []).map((n) => normalize(n.mediaRecommendation)).filter(Boolean);
  // «من نفس العالم» في أنماط الصفحة: الأعمال المرتبطة كلها أنمي ومانجا (لا الأغاني ولا ظهور الشخصيات)،
  // بنوع العلاقة والصيغة؛ relations أعلاه تبقى كما هي للصفحة الأساسية
  const world = (media.relations?.edges ?? [])
    .filter((e) => WORLD_AR[e.relationType] && e.node?.format !== 'MUSIC' && (e.node?.type === 'ANIME' || e.node?.type === 'MANGA'))
    .map((e) => ({ ...normalize(e.node), kind: e.node.type === 'MANGA' ? 'manga' : 'anime', relationType: e.relationType, relation: WORLD_AR[e.relationType] }))
    .filter((m) => m.id);
  // الشخصيات: الرئيسية أولًا، بلا صورة AniList الافتراضية الفارغة
  const characters = (media.characters?.edges ?? [])
    .filter((e) => e?.node?.image?.large && !/\/default\.(jpg|png)$/.test(e.node.image.large))
    .map((e) => ({ id: e.node.id, name: e.node.name?.full ?? '', image: e.node.image.large, main: e.role === 'MAIN', voice: e.voiceActors?.[0]?.name?.full ?? null }));
  const rated = (media.rankings ?? []).find((r) => r.type === 'RATED' && r.allTime);
  // حلقات المنصّات بصورها: «Episode 3 - العنوان»، والرقم منها لا من ترتيب القائمة
  const thumbs = {};
  for (const e of media.streamingEpisodes ?? []) {
    const n = Number(/Episode\s+(\d+)/i.exec(e.title ?? '')?.[1]);
    if (n && e.thumbnail && !thumbs[n]) thumbs[n] = { thumbnail: e.thumbnail, title: String(e.title).replace(/^Episode\s+\d+\s*[-–:]\s*/i, '').trim() || null };
  }
  return {
    ...base,
    relations,
    world,
    recommendations,
    characters,
    synonyms: media.synonyms ?? [],
    favourites: media.favourites ?? 0,
    rank: rated?.rank ?? null,
    source: media.source ?? null,
    start: media.startDate?.year ? media.startDate : null,
    thumbs,
  };
}

async function request(query, variables, { signal, fetchImpl = globalThis.fetch, timeoutMs = 12_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
  try {
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.data) throw new Error(body?.errors?.[0]?.message || `anilist_${res.status}`);
    return body.data;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchAnimeHome(opts = {}) {
  const now = opts.now ?? Date.now();
  const { season, year } = seasonOf(new Date(now));
  const to = Math.floor(now / 1000);
  const data = await request(HOME_QUERY, { season, year, from: to - 7 * 86_400, to, until: to + 7 * 86_400 }, opts);
  return { ...parseHome(data), seasonName: `${SEASON_AR[season]} ${year}`, fetchedAt: now };
}

export async function fetchAnimeDetail(id, opts = {}) {
  return parseDetail(await request(DETAIL_QUERY, { id: Number(id) }, opts));
}

export async function searchAnime({ search, genre, page = 1 } = {}, opts = {}) {
  const data = await request(SEARCH_QUERY, { search: search || undefined, genre: genre || undefined, page }, opts);
  return { items: list(data?.Page), hasNext: Boolean(data?.Page?.pageInfo?.hasNextPage) };
}

/**
 * البحث والتصفّح بفلاتر (ورقة الفلاتر في «اكتشف» وصفحات «الكل»): الأنواع المطلوبة
 * والمستبعدة، الشكل، الحالة، السنة والموسم، أقل تقييم، والترتيب. طلب AniList واحد.
 */
const DISCOVER_QUERY = `query ($page: Int, $perPage: Int, $search: String, $genreIn: [String], $genreNotIn: [String], $formatIn: [MediaFormat], $status: MediaStatus, $year: Int, $season: MediaSeason, $minScore: Int, $minPop: Int, $sort: [MediaSort]) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    media(type: ANIME, isAdult: false, search: $search, genre_in: $genreIn, genre_not_in: $genreNotIn, format_in: $formatIn, status: $status, seasonYear: $year, season: $season, averageScore_greater: $minScore, popularity_greater: $minPop, sort: $sort) { ${CARD} }
  }
}`;

export const DISCOVER_SORTS = { relevance: 'SEARCH_MATCH', popularity: 'POPULARITY_DESC', score: 'SCORE_DESC', newest: 'START_DATE_DESC', trending: 'TRENDING_DESC' };
export const SORT_AR = { relevance: 'الأقرب للبحث', popularity: 'الأشهر', score: 'الأعلى تقييمًا', newest: 'الأحدث', trending: 'الرائج' };

/** فلاتر فارغة: لا شيء مختار، والترتيب بحسب وجود كلمة بحث. */
export const emptyFilters = () => ({ include: [], exclude: [], formats: [], status: '', year: null, season: '', minScore: 0, sort: '' });

/** عدد الفلاتر المفعّلة (نقطة على زر القمع). الترتيب ليس فلترًا. */
export const activeFilterCount = (f = {}) =>
  (f.include?.length ?? 0) + (f.exclude?.length ?? 0) + (f.formats?.length ?? 0) + (f.status ? 1 : 0) + (f.year ? 1 : 0) + (f.season ? 1 : 0) + (f.minScore > 0 ? 1 : 0);

/** متغيّرات الطلب من الفلاتر: ما لم يُختر لا يُرسل (AniList يتجاهل null). */
export function discoverVariables({ search = '', page = 1, perPage = 30, minPop = null, ...f } = {}) {
  const q = String(search ?? '').trim();
  const sortKey = f.sort && DISCOVER_SORTS[f.sort] ? f.sort : q ? 'relevance' : 'popularity';
  const sort = [DISCOVER_SORTS[sortKey], ...(sortKey === 'relevance' ? ['POPULARITY_DESC'] : [])];
  // «الأحدث» و«الأعلى تقييمًا» بلا حدّ شهرة تمتلئ بأعمال لا يعرفها أحد
  const floor = minPop ?? (q ? null : sortKey === 'score' ? 20_000 : sortKey === 'newest' ? 2_000 : null);
  return {
    page,
    perPage,
    search: q || null,
    genreIn: f.include?.length ? [...f.include] : null,
    genreNotIn: f.exclude?.length ? [...f.exclude] : null,
    formatIn: f.formats?.length ? [...f.formats] : null,
    status: f.status || null,
    year: Number(f.year) > 1900 ? Number(f.year) : null,
    season: f.season || null,
    minScore: f.minScore > 0 ? Math.round(f.minScore * 10) - 1 : null,
    minPop: floor,
    sort,
  };
}

export async function discoverAnime(filters = {}, opts = {}) {
  // ما لم يُختر يُحذف من المتغيّرات تمامًا: null الصريح يربك AniList في بعض الحقول
  const vars = Object.fromEntries(Object.entries(discoverVariables(filters)).filter(([, v]) => v != null));
  const data = await request(DISCOVER_QUERY, vars, opts);
  return { items: list(data?.Page), hasNext: Boolean(data?.Page?.pageInfo?.hasNextPage) };
}

/** «منذ 3 ساعات» / «بعد يومين» بعربية سليمة. */
export function relativeAr(ts, now = Date.now()) {
  const diff = ts - now;
  const past = diff < 0;
  const mins = Math.round(Math.abs(diff) / 60_000);
  const unit = (n, [one, two, few, many]) => (n === 1 ? one : n === 2 ? two : n <= 10 ? `${n} ${few}` : `${n} ${many}`);
  let text;
  if (mins < 1) return past ? 'الآن' : 'خلال لحظات';
  if (mins < 60) text = unit(mins, ['دقيقة', 'دقيقتين', 'دقائق', 'دقيقة']);
  else if (mins < 1440) text = unit(Math.round(mins / 60), ['ساعة', 'ساعتين', 'ساعات', 'ساعة']);
  else text = unit(Math.round(mins / 1440), ['يوم', 'يومين', 'أيام', 'يومًا']);
  return past ? `منذ ${text}` : `بعد ${text}`;
}

const JIKAN = 'https://api.jikan.moe/v4';

async function jikan(path, { fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${JIKAN}${path}`, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`jikan_${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** تقييم MAL وعدد المقيّمين وترتيبه — من Jikan (واجهة MAL العامة). */
export async function fetchMalScore(idMal, opts) {
  if (!idMal) return null;
  const d = (await jikan(`/anime/${idMal}`, opts))?.data;
  return d ? { score: d.score ?? null, scoredBy: d.scored_by ?? 0, rank: d.rank ?? null } : null;
}

/** عناوين الحلقات من MAL: {رقم: عنوان}، صفحة بمئة حلقة. */
export async function fetchMalEpisodes(idMal, page = 1, opts) {
  if (!idMal) return { titles: {}, hasNext: false };
  const body = await jikan(`/anime/${idMal}/episodes?page=${page}`, opts);
  const titles = {};
  for (const e of body?.data ?? []) if (e.mal_id && (e.title || e.title_romanji)) titles[e.mal_id] = e.title || e.title_romanji;
  return { titles, hasNext: Boolean(body?.pagination?.has_next_page) };
}

/** 72400 ⇒ «72K»، و1200000 ⇒ «1.2M». */
export function compactCount(n) {
  if (!n) return '0';
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '')}K`;
  return String(n);
}
