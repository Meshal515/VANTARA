/**
 * «رفيق» — سجل الأدوات.
 *
 * الأداة قدرة (تجيب بيانات أو تنفّذ)، لا تفكير. كل أداة:
 *   - مخطط إدخال JSON صارم (للنموذج لما يستدعيها بنفسه)،
 *   - نتيجة بحالة صريحة (OK / NOT_FOUND / UNAVAILABLE / STALE …) لا نجاح مزيّف،
 *   - دليل بمصدره ووقته، وسياسة كاش.
 * الكود يحسب ما يقدر يحسبه (ترتيب، فلترة، أرقام)، والنموذج يفهم ويشرح.
 *
 * نصوص من برا (مراجعات، نبذ) بيانات لا تعليمات: تُمرّر في حقول بيانات فقط.
 */

import type { D1Database } from './types.ts';
import { FIELDS, type Meta, candidates, cleanSynopsis, gql, searchTitle, toMeta } from './rafiq-anilist.ts';

type Fetch = typeof fetch;

export type ToolStatus = 'OK' | 'NOT_FOUND' | 'UNAVAILABLE' | 'STALE' | 'TIMEOUT' | 'CONFLICTING_DATA';

export interface Evidence {
  sourceType: 'catalog' | 'anilist' | 'vantara' | 'device' | 'community';
  sourceId?: string;
  url?: string;
  retrievedAt: number;
  confidence: number;
}

export interface ToolResult<T> {
  status: ToolStatus;
  data?: T;
  evidence: Evidence[];
  cached?: boolean;
}

// ───────────────────────── الكاش ─────────────────────────

/** نتيجة أداة محفوظة ما دامت صالحة؛ الفشل لا يُحفظ (يُعاد السؤال). */
async function cached<T>(db: D1Database | null, key: string, tool: string, ttlMs: number, now: number, load: () => Promise<ToolResult<T>>): Promise<ToolResult<T>> {
  if (db) {
    const row = await db.prepare('SELECT data_json, fetched_at, expires_at FROM rafiq_tool_cache WHERE key = ?').bind(key).first<{ data_json: string; fetched_at: number; expires_at: number }>();
    if (row && row.expires_at > now) {
      try {
        return { ...(JSON.parse(row.data_json) as ToolResult<T>), cached: true };
      } catch {
        // تالف: يُعاد جلبه
      }
    }
  }
  const fresh = await load();
  if (db && fresh.status === 'OK') {
    await db
      .prepare('INSERT INTO rafiq_tool_cache (key, tool, data_json, source, fetched_at, expires_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET data_json = excluded.data_json, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at')
      .bind(key, tool, JSON.stringify(fresh), fresh.evidence[0]?.sourceType ?? null, now, now + ttlMs)
      .run();
  }
  return fresh;
}

const HOUR = 3600_000;
const DAY = 24 * HOUR;

// ───────────────────────── ملف العمل ─────────────────────────

export interface WorkProfile {
  meta: Meta;
  authors: string[];
  /** توزيع التقييمات (نسبة من 100 لكل درجة 10..100). */
  scoreDistribution: Array<{ score: number; share: number }>;
  /** ملخّصات مراجعات القرّاء (سطر لكل مراجعة، بلا نصها الكامل: أقل حرقًا). */
  reviews: Array<{ summary: string; score: number; helpful: number }>;
  /** اقتباسات وتكملات وأنمي/مانجا مرتبط (بلا تفاصيل أحداث). */
  relations: Array<{ type: string; title: string; format: string | null; id: number }>;
  favourites: number | null;
  rankings: Array<{ rank: number; context: string; allTime: boolean }>;
}

const PROFILE_FIELDS = `${FIELDS}
  favourites
  staff(perPage: 4, sort: RELEVANCE) { edges { role node { name { full } } } }
  stats { scoreDistribution { score amount } }
  reviews(perPage: 6, sort: RATING_DESC) { nodes { summary score rating ratingAmount } }
  rankings { rank context allTime type }
  relations { edges { relationType(version: 2) node { id title { english romaji } format } } }`;

/** ملف عمل كامل بآراء قرّائه. يُحفظ أسبوعًا (المراجعات والتقييم يتغيران ببطء). */
export async function workProfile(db: D1Database | null, fetchImpl: Fetch, q: { title?: string; anilistId?: number; type?: 'MANGA' | 'ANIME' | undefined }, now: number): Promise<ToolResult<WorkProfile>> {
  let id = q.anilistId;
  if (!id && q.title) {
    const found = await searchTitle(fetchImpl, q.title, q.type);
    if (!found) return { status: 'NOT_FOUND', evidence: [] };
    id = found.anilistId;
  }
  if (!id) return { status: 'NOT_FOUND', evidence: [] };
  return cached(db, `work_profile:${id}`, 'work_profile', 7 * DAY, now, async () => {
    const data = await gql(fetchImpl, `query($id: Int) { Media(id: $id) { ${PROFILE_FIELDS} } }`, { id });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = data?.Media as any;
    if (!m) return { status: data ? 'NOT_FOUND' : 'UNAVAILABLE', evidence: [] };
    const dist = (m.stats?.scoreDistribution ?? []) as Array<{ score: number; amount: number }>;
    const total = dist.reduce((a, b) => a + b.amount, 0) || 1;
    return {
      status: 'OK',
      evidence: [{ sourceType: 'anilist', sourceId: String(id), url: `https://anilist.co/${String(m.type).toLowerCase()}/${id}`, retrievedAt: now, confidence: 0.9 }],
      data: {
        meta: toMeta(m),
        authors: ((m.staff?.edges ?? []) as Array<{ role?: string; node?: { name?: { full?: string } } }>)
          .filter((e) => /story|art|original/i.test(e.role ?? ''))
          .map((e) => `${e.node?.name?.full ?? '?'} (${e.role})`)
          .slice(0, 3),
        scoreDistribution: dist.map((d) => ({ score: d.score, share: Math.round((d.amount / total) * 100) })),
        reviews: ((m.reviews?.nodes ?? []) as Array<{ summary?: string; score?: number; rating?: number; ratingAmount?: number }>)
          .filter((r) => r.summary)
          .map((r) => ({ summary: cleanSynopsis(r.summary)?.slice(0, 220) ?? '', score: r.score ?? 0, helpful: r.ratingAmount ? Math.round(((r.rating ?? 0) / r.ratingAmount) * 100) : 0 })),
        relations: ((m.relations?.edges ?? []) as Array<{ relationType?: string; node?: { id: number; title?: { english?: string; romaji?: string }; format?: string } }>)
          .filter((e) => ['ADAPTATION', 'SOURCE', 'SEQUEL', 'PREQUEL', 'SPIN_OFF', 'SIDE_STORY'].includes(e.relationType ?? ''))
          .map((e) => ({ type: e.relationType!, title: e.node?.title?.english || e.node?.title?.romaji || '?', format: e.node?.format ?? null, id: e.node!.id }))
          .slice(0, 8),
        favourites: m.favourites ?? null,
        rankings: ((m.rankings ?? []) as Array<{ rank: number; context: string; allTime: boolean }>).slice(0, 4),
      },
    };
  });
}

// ───────────────────────── الترتيب ─────────────────────────

export interface RankingQuery {
  type: 'MANGA' | 'ANIME';
  country?: 'KR' | 'JP' | 'CN' | null;
  genres?: string[];
  tags?: string[];
  genresOut?: string[];
  status?: 'FINISHED' | 'RELEASING' | null;
  /** SCORE_DESC = الأعلى تقييمًا، POPULARITY_DESC = الأشهر، TRENDING_DESC = الرائج الآن */
  sort?: 'SCORE_DESC' | 'POPULARITY_DESC' | 'TRENDING_DESC';
  year?: number | null;
}

/**
 * «توب 10 مانهوا»: الترتيب من الكتالوج نفسه (تقييم مع حد أدنى للشعبية حتى لا يتصدر
 * عمل قيّمه 50 شخصًا)، لا من ذاكرة النموذج. يُحفظ 12 ساعة.
 */
export async function rankingQuery(db: D1Database | null, fetchImpl: Fetch, q: RankingQuery, now: number): Promise<ToolResult<Meta[]>> {
  const key = `ranking:${JSON.stringify([q.type, q.country ?? '', q.genres ?? [], q.tags ?? [], q.genresOut ?? [], q.status ?? '', q.sort ?? 'SCORE_DESC', q.year ?? ''])}`;
  return cached(db, key, 'ranking_query', 12 * HOUR, now, async () => {
    const list = await candidates(fetchImpl, {
      type: q.type,
      country: q.country ?? null,
      genresIn: q.genres ?? [],
      tagsIn: q.tags ?? [],
      genresOut: q.genresOut ?? [],
      status: q.status ?? null,
      sort: q.sort ?? 'SCORE_DESC',
      perPage: 40,
    });
    if (!list.length) return { status: 'UNAVAILABLE', evidence: [] };
    const out = list
      .filter((m) => !m.sequel && !['MOVIE', 'MUSIC', 'SPECIAL', 'ONE_SHOT'].includes(m.format ?? ''))
      .filter((m) => !q.year || m.year === q.year);
    // «الأفضل» = تقييم موزون بعدد من قيّم (بايزي): عمل قيّمه ألف شخص لا يتصدر عملًا قيّمه مئة ألف بفارق نقطة
    if ((q.sort ?? 'SCORE_DESC') === 'SCORE_DESC') {
      const m = 30000;
      const c = 72;
      const weighted = (x: Meta) => {
        const v = x.popularity ?? 0;
        return (v / (v + m)) * (x.score ?? c) + (m / (v + m)) * c;
      };
      out.sort((a, b) => weighted(b) - weighted(a));
    }
    return { status: out.length ? 'OK' : 'NOT_FOUND', data: out, evidence: [{ sourceType: 'anilist', retrievedAt: now, confidence: 0.85 }] };
  });
}

// ───────────────────────── تعريفات للنموذج ─────────────────────────

/**
 * المخططات كما يراها النموذج حين يستدعي الأدوات بنفسه (وكيل). المهارة تختار أصغر
 * مجموعة تلزمها؛ لا تُرسل كلها في كل طلب.
 */
export const TOOL_SCHEMAS = {
  work_profile: {
    description: 'ملف عمل كامل: النبذة، التصنيفات، الحالة، عدد الفصول/الحلقات، التقييم وتوزيعه، ملخّصات مراجعات القرّاء، المؤلفون، والأعمال المرتبطة (أنمي/مانجا/تكملة).',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'عنوان العمل بالإنجليزي أو الروماجي' },
        type: { type: 'string', enum: ['MANGA', 'ANIME'] },
      },
      required: ['title', 'type'],
      additionalProperties: false,
    },
  },
  ranking_query: {
    description: 'قائمة ترتيب من الكتالوج (أعلى تقييم/الأشهر/الرائج) بشروط: النوع، البلد (KR مانهوا، JP مانجا، CN مانها)، الأنواع، الوسوم، الحالة.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['MANGA', 'ANIME'] },
        country: { type: 'string', enum: ['KR', 'JP', 'CN', 'ANY'] },
        genres: { type: 'array', items: { type: 'string' } },
        status: { type: 'string', enum: ['FINISHED', 'RELEASING', 'ANY'] },
        sort: { type: 'string', enum: ['SCORE_DESC', 'POPULARITY_DESC', 'TRENDING_DESC'] },
      },
      required: ['type', 'country', 'genres', 'status', 'sort'],
      additionalProperties: false,
    },
  },
} as const;
