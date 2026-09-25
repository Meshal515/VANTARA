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

const HOME_QUERY = `query ($season: MediaSeason, $year: Int, $from: Int, $to: Int) {
  trending: Page(perPage: 14) { media(type: ANIME, sort: TRENDING_DESC, isAdult: false) { ${CARD} description(asHtml: false) } }
  season: Page(perPage: 10) { media(type: ANIME, season: $season, seasonYear: $year, sort: POPULARITY_DESC, isAdult: false) { ${CARD} } }
  popular: Page(perPage: 18) { media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) { ${CARD} } }
  top: Page(perPage: 18) { media(type: ANIME, sort: SCORE_DESC, isAdult: false, popularity_greater: 40000) { ${CARD} } }
  schedule: Page(perPage: 40) { airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME_DESC) { episode airingAt media { ${CARD} } } }
}`;

const DETAIL_QUERY = `query ($id: Int) {
  Media(id: $id, type: ANIME) {
    ${CARD} description(asHtml: false) source startDate { year month day } synonyms favourites rankings { rank type allTime context }
    streamingEpisodes { title thumbnail }
    relations { edges { relationType node { ${CARD} type } } }
    recommendations(perPage: 12, sort: RATING_DESC) { nodes { mediaRecommendation { ${CARD} } } }
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
    recommendations,
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
  const data = await request(HOME_QUERY, { season, year, from: to - 7 * 86_400, to }, opts);
  return { ...parseHome(data), seasonName: `${SEASON_AR[season]} ${year}`, fetchedAt: now };
}

export async function fetchAnimeDetail(id, opts = {}) {
  return parseDetail(await request(DETAIL_QUERY, { id: Number(id) }, opts));
}

export async function searchAnime({ search, genre, page = 1 } = {}, opts = {}) {
  const data = await request(SEARCH_QUERY, { search: search || undefined, genre: genre || undefined, page }, opts);
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
