/**
 * «رفيق» — كتالوج البيانات من AniList.
 *
 * AniList هو المرجع الذي يعرض به VANTARA الأنمي أصلًا (صفحاته، أغلفته، أنواعه)،
 * ولكل مانجا/مانهوا فيه أنواع ووسوم وعدد فصول وحالة وتقييم. منه:
 *   - بيانات أعمال المستخدم (لملف الذوق): تُجلب مرة وتُحفظ في `rafiq_meta`.
 *   - المرشّحون لطلب معيّن: استعلام بالأنواع والوسوم والطول، لا تخمين من النموذج.
 *
 * النموذج لا يرى إلا ما يرجع من هنا؛ فلا عمل ولا رقم مخترع.
 */

import type { D1Database } from './types.ts';
import { ANILIST_TAGS } from './rafiq-tags.ts';

export const ANILIST = 'https://graphql.anilist.co';

/** أنواع AniList كما هي (القائمة المغلقة التي يقبلها `genre_in`). */
export const GENRES = [
  'Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Horror', 'Mahou Shoujo', 'Mecha', 'Music',
  'Mystery', 'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller',
] as const;

/** كل وسوم AniList (بلا البالغين) بأسمائها الدقيقة. */
export const TAGS = ANILIST_TAGS;

const FIELDS = `id type format status episodes chapters averageScore popularity genres isAdult seasonYear
  startDate { year } countryOfOrigin title { romaji english native } synonyms
  coverImage { large extraLarge color } bannerImage description(asHtml: false)
  tags { name rank isMediaSpoiler isGeneralSpoiler } relations { edges { relationType(version: 2) node { format } } }`;

export interface Meta {
  anilistId: number;
  type: 'ANIME' | 'MANGA';
  format: string | null;
  status: string | null;
  episodes: number | null;
  chapters: number | null;
  score: number | null;
  popularity: number | null;
  genres: string[];
  tags: string[];
  year: number | null;
  country: string | null;
  title: string;
  titles: string[];
  cover: string | null;
  banner: string | null;
  color: string | null;
  synopsis: string | null;
  /** تكملة لعمل قبلها بنفس الشكل (موسم ثاني، جزء ثاني): يُقترح الأول لا هي. */
  sequel?: boolean;
}

type Fetch = typeof fetch;

/** وصف بلا HTML وبلا حرق: أول فقرة فقط (AniList يضع التفاصيل المتقدمة بعدها). */
export function cleanSynopsis(text: string | null | undefined): string | null {
  if (!text) return null;
  const plain = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/~!.*?!~/gs, '') // وسم الحرق في AniList
    .replace(/\(Source:[^)]*\)/gi, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .trim();
  const first = plain.split(/\n\s*\n/)[0]?.trim() ?? '';
  return first.length > 420 ? `${first.slice(0, 417).replace(/\s+\S*$/, '')}…` : first || null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toMeta(m: any): Meta {
  const tags = (m.tags ?? [])
    .filter((t: { isMediaSpoiler?: boolean; isGeneralSpoiler?: boolean; rank?: number }) => !t.isMediaSpoiler && !t.isGeneralSpoiler && (t.rank ?? 0) >= 40)
    .map((t: { name: string }) => t.name)
    .slice(0, 14);
  const titles = [m.title?.english, m.title?.romaji, m.title?.native, ...(m.synonyms ?? [])].filter(Boolean) as string[];
  return {
    anilistId: m.id,
    type: m.type,
    format: m.format ?? null,
    status: m.status ?? null,
    episodes: m.episodes ?? null,
    chapters: m.chapters ?? null,
    score: m.averageScore ?? null,
    popularity: m.popularity ?? null,
    genres: m.genres ?? [],
    tags,
    year: m.seasonYear ?? m.startDate?.year ?? null,
    country: m.countryOfOrigin ?? null,
    title: m.title?.english || m.title?.romaji || m.title?.native || `#${m.id}`,
    titles: [...new Set(titles)].slice(0, 6),
    cover: m.coverImage?.large ?? m.coverImage?.extraLarge ?? null,
    banner: m.bannerImage ?? null,
    color: m.coverImage?.color ?? null,
    synopsis: cleanSynopsis(m.description),
    sequel: (m.relations?.edges ?? []).some((e: { relationType?: string; node?: { format?: string } }) => e.relationType === 'PREQUEL' && e.node?.format === m.format),
  };
}

async function gql(fetchImpl: Fetch, query: string, variables: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetchImpl(ANILIST, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: Record<string, unknown> };
    return body.data ?? null;
  } catch {
    return null;
  }
}

/** معرّف الأنمي من مرجعه (`anime:123`)، أو مفتاح بحث للمانجا (`title:…`). */
export const metaKeyForAnime = (id: number) => `anime:${id}`;
export const metaKeyForTitle = (title: string) => `title:${title.trim().toLowerCase()}`;
export const metaKeyForManga = (id: number) => `manga:${id}`;

const META_TTL_MS = 30 * 24 * 3600_000;

/**
 * بيانات أعمال بمفاتيحها، من المحفوظ أولًا ثم AniList دفعة واحدة (أسماء مستعارة في
 * استعلام واحد، عشرة لكل طلب). ما لم يُعرف يُحفظ `null` فلا يُسأل عنه كل مرة.
 */
export async function metaFor(
  db: D1Database,
  fetchImpl: Fetch,
  wanted: Array<{ key: string; anilistId?: number; title?: string; type?: 'ANIME' | 'MANGA' }>,
  now: number,
): Promise<Map<string, Meta | null>> {
  const out = new Map<string, Meta | null>();
  if (!wanted.length) return out;
  const unique = [...new Map(wanted.map((w) => [w.key, w])).values()];
  const keys = unique.map((w) => w.key);
  const cached = new Map<string, { data_json: string | null; fetched_at: number }>();
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50);
    const { results } = await db
      .prepare(`SELECT key, data_json, fetched_at FROM rafiq_meta WHERE key IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk)
      .all<{ key: string; data_json: string | null; fetched_at: number }>();
    for (const r of results) cached.set(r.key, r);
  }
  const missing: typeof unique = [];
  for (const w of unique) {
    const c = cached.get(w.key);
    if (c && now - c.fetched_at < META_TTL_MS) out.set(w.key, c.data_json ? (JSON.parse(c.data_json) as Meta) : null);
    else missing.push(w);
  }
  for (let i = 0; i < missing.length && i < 40; i += 10) {
    const batch = missing.slice(i, i + 10);
    const parts: string[] = [];
    const vars: Record<string, unknown> = {};
    const decl: string[] = [];
    batch.forEach((w, n) => {
      if (w.anilistId) {
        decl.push(`$id${n}: Int`);
        vars[`id${n}`] = w.anilistId;
        parts.push(`m${n}: Media(id: $id${n}) { ${FIELDS} }`);
      } else if (w.title) {
        decl.push(`$s${n}: String`);
        vars[`s${n}`] = w.title;
        parts.push(`m${n}: Media(search: $s${n}, type: ${w.type ?? 'MANGA'}, isAdult: false) { ${FIELDS} }`);
      }
    });
    if (!parts.length) continue;
    const data = await gql(fetchImpl, `query(${decl.join(', ')}) { ${parts.join('\n')} }`, vars);
    const stmts = [];
    for (let n = 0; n < batch.length; n++) {
      const m = data?.[`m${n}`];
      const meta = m ? toMeta(m) : null;
      // بحث بالعنوان: نقبل النتيجة فقط إن طابق أحد عناوينها (لا «أقرب عمل» خاطئ)
      const ok = meta && (batch[n]!.anilistId || titleMatches(batch[n]!.title ?? '', meta.titles));
      const value = ok ? meta : null;
      out.set(batch[n]!.key, value);
      // خطأ الشبكة لا يُحفظ فراغًا: يُعاد السؤال في المرة القادمة
      if (data) {
        stmts.push(
          db
            .prepare('INSERT INTO rafiq_meta (key, anilist_id, data_json, fetched_at) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET anilist_id = excluded.anilist_id, data_json = excluded.data_json, fetched_at = excluded.fetched_at')
            .bind(batch[n]!.key, value?.anilistId ?? null, value ? JSON.stringify(value) : null, now),
        );
      }
    }
    if (stmts.length) await db.batch(stmts);
  }
  return out;
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export function titleMatches(wanted: string, titles: string[]): boolean {
  const w = fold(wanted);
  if (!w) return false;
  return titles.some((t) => {
    const f = fold(t);
    if (!f) return false;
    if (f === w) return true;
    // «Solo Leveling» مقابل «Solo Leveling: Ragnarok»: أحدهما بداية الآخر وبطول معقول
    const [a, b] = f.length < w.length ? [f, w] : [w, f];
    return a.length >= 6 && b.startsWith(a) && a.length / b.length >= 0.55;
  });
}

export interface CandidateQuery {
  type: 'ANIME' | 'MANGA';
  genresIn?: string[];
  genresOut?: string[];
  tagsIn?: string[];
  tagsOut?: string[];
  length?: 'short' | 'medium' | 'long' | 'any';
  status?: 'FINISHED' | 'RELEASING' | null;
  sort?: 'POPULARITY_DESC' | 'SCORE_DESC' | 'TRENDING_DESC';
  exclude?: number[];
  page?: number;
  /** بلد المنشأ: KR مانهوا، JP مانجا، CN مانها. */
  country?: 'KR' | 'JP' | 'CN' | null;
  perPage?: number;
}

/** مرشّحون حقيقيون من الكتالوج بشروط الطلب (30 لكل صفحة). */
export async function candidates(fetchImpl: Fetch, q: CandidateQuery): Promise<Meta[]> {
  const vars: Record<string, unknown> = {
    type: q.type,
    page: q.page ?? 1,
    sort: [q.sort ?? 'POPULARITY_DESC'],
    minScore: 60,
  };
  const args = ['type: $type', 'sort: $sort', 'averageScore_greater: $minScore', 'isAdult: false'];
  const decl = ['$type: MediaType', '$page: Int', '$sort: [MediaSort]', '$minScore: Int'];
  const add = (name: string, type: string, arg: string, value: unknown) => {
    if (value === undefined || value === null || (Array.isArray(value) && !value.length)) return;
    decl.push(`$${name}: ${type}`);
    args.push(`${arg}: $${name}`);
    vars[name] = value;
  };
  add('genreIn', '[String]', 'genre_in', q.genresIn?.filter((g) => (GENRES as readonly string[]).includes(g)));
  add('genreOut', '[String]', 'genre_not_in', q.genresOut?.filter((g) => (GENRES as readonly string[]).includes(g)));
  add('tagIn', '[String]', 'tag_in', q.tagsIn);
  // وسم هامشي في عمل ضخم لا يجعله «عن» هذا الموضوع
  if (q.tagsIn?.length) add('tagRank', 'Int', 'minimumTagRank', 60);
  add('tagOut', '[String]', 'tag_not_in', q.tagsOut);
  add('status', 'MediaStatus', 'status', q.status ?? undefined);
  add('notIn', '[Int]', 'id_not_in', q.exclude?.slice(0, 200));
  add('country', 'CountryCode', 'countryOfOrigin', q.country ?? undefined);
  const unit = q.type === 'ANIME' ? 'episodes' : 'chapters';
  const bounds = q.type === 'ANIME' ? { short: 14, medium: 27 } : { short: 60, medium: 160 };
  if (q.length === 'short') {
    add('lenLess', 'Int', `${unit}_lesser`, bounds.short);
    // «قصير» ليس ون شوت ولا فيلمًا: عمل تتابعه فعلًا
    add('lenGreater', 'Int', `${unit}_greater`, q.type === 'ANIME' ? 3 : 4);
  }
  if (q.length === 'medium') {
    add('lenGreater', 'Int', `${unit}_greater`, bounds.short - 1);
    add('lenLess', 'Int', `${unit}_lesser`, bounds.medium);
  }
  if (q.length === 'long') add('lenGreater', 'Int', `${unit}_greater`, bounds.medium - 1);
  const query = `query(${decl.join(', ')}) { Page(page: $page, perPage: ${q.perPage ?? 30}) { media(${args.join(', ')}) { ${FIELDS} } } }`;
  const data = await gql(fetchImpl, query, vars);
  const media = ((data?.Page as { media?: unknown[] } | undefined)?.media ?? []) as unknown[];
  return media.map(toMeta);
}

/** «قريب من العمل الفلاني»: توصيات AniList المجتمعية لذلك العمل. */
export async function similarTo(fetchImpl: Fetch, anilistId: number): Promise<Meta[]> {
  const query = `query($id: Int) { Media(id: $id) { recommendations(sort: RATING_DESC, perPage: 20) { nodes { rating mediaRecommendation { ${FIELDS} } } } } }`;
  const data = await gql(fetchImpl, query, { id: anilistId });
  const nodes = ((data?.Media as { recommendations?: { nodes?: Array<{ mediaRecommendation?: unknown }> } } | undefined)?.recommendations?.nodes ?? []);
  return nodes
    .map((n) => n.mediaRecommendation)
    .filter(Boolean)
    .map(toMeta)
    .filter((m) => m && !(m as Meta & { isAdult?: boolean }).isAdult);
}

/** بحث عن عمل بعنوانه (للطلب الصريح عن عمل بعينه). */
export async function searchTitle(fetchImpl: Fetch, title: string, type?: 'ANIME' | 'MANGA'): Promise<Meta | null> {
  const query = `query($s: String) { Media(search: $s${type ? `, type: ${type}` : ''}, isAdult: false) { ${FIELDS} } }`;
  const data = await gql(fetchImpl, query, { s: title });
  return data?.Media ? toMeta(data.Media) : null;
}
