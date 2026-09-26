/**
 * «رفيق» — ملف الذوق.
 *
 * يُبنى من استعمال المستخدم الحقيقي لا من كلام عام: ما أكمله، ما تركه سريعًا، ما
 * عاد إليه، ما قيّمه وفضّله، وما قاله لرفيق صراحة. الناتج مختصر ومنظّم (لا سجل
 * خام يُرسل للنموذج)، وكل تفضيل معه مصدره وثقته:
 *   explicit   قاله المستخدم.
 *   behavioral من سلوكه، بدعم عملين أو أكثر (عمل واحد لا يصنع ذوقًا).
 *   inferred   مستنتج بثقة أقل.
 */

import type { D1Database } from './types.ts';
import { type Meta, metaFor, metaKeyForAnime, metaKeyForTitle } from './rafiq-anilist.ts';

type Fetch = typeof fetch;

/** إشارة أنمي من الجهاز (سجل المشاهدة محلي). */
export interface LocalAnime {
  id: number;
  title?: string;
  watched: number;
  total?: number | null;
  done?: boolean;
  at?: number;
  listed?: boolean;
}

export interface UserWork {
  ref: string;
  kind: 'manga' | 'anime';
  title: string;
  progress: number;
  lastAt: number;
  firstAt: number;
  completed: boolean;
  rating: number | null;
  favorite: boolean;
  inLibrary: boolean;
  readLater: boolean;
  feedback: string | null;
  meta: Meta | null;
  state: 'strong' | 'current' | 'started' | 'abandoned' | 'disliked' | 'listed';
}

export interface Weighted {
  key: string;
  score: number;
  support: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface Preference {
  id: string;
  kind: string;
  key: string;
  polarity: 1 | -1;
  source: 'explicit' | 'behavioral' | 'inferred';
  note: string | null;
}

export interface TasteProfile {
  favoriteGenres: Weighted[];
  dislikedGenres: Weighted[];
  preferredThemes: Weighted[];
  dislikedThemes: Weighted[];
  preferredLength: { manga: string | null; anime: string | null };
  mangaVsAnime: { manga: number; anime: number; leaning: 'manga' | 'anime' | 'both' };
  recentInterests: string[];
  strongPositiveWorks: string[];
  completedWorks: string[];
  abandonedWorks: string[];
  currentWorks: Array<{ title: string; progress: string }>;
  explicitPreferences: Array<{ kind: string; key: string; polarity: 1 | -1 }>;
  counts: { works: number; engaged: number };
}

const DAY = 86_400_000;

export function classify(w: Omit<UserWork, 'state' | 'meta'>, now: number): UserWork['state'] {
  const age = now - (w.lastAt || 0);
  if ((w.rating !== null && w.rating <= 4) || w.feedback === 'not_for_me' || w.feedback === 'less_like') return 'disliked';
  const deep = w.kind === 'anime' ? w.progress >= 8 : w.progress >= 25;
  if (w.completed || (w.rating !== null && w.rating >= 8) || w.favorite || deep) return 'strong';
  if (w.progress > 0 && age <= 14 * DAY) return 'current';
  const shallow = w.kind === 'anime' ? w.progress <= 2 : w.progress <= 3;
  if (w.progress > 0 && shallow && age > 21 * DAY) return 'abandoned';
  if (w.progress > 0) return 'started';
  return 'listed';
}

const WEIGHT: Record<UserWork['state'], number> = { strong: 3, current: 1.5, started: 0.8, listed: 0.4, abandoned: -1.5, disliked: -2.5 };

function confidence(support: number): Weighted['confidence'] {
  return support >= 4 ? 'high' : support >= 2 ? 'medium' : 'low';
}

/** الأنواع أو الوسوم بأوزانها: كل عمل يسهم بحسب حالته. */
export function weigh(works: UserWork[], pick: (m: Meta) => string[]): { pos: Weighted[]; neg: Weighted[] } {
  const acc = new Map<string, { score: number; pos: number; neg: number }>();
  for (const w of works) {
    if (!w.meta) continue;
    const weight = WEIGHT[w.state];
    for (const key of pick(w.meta)) {
      const a = acc.get(key) ?? { score: 0, pos: 0, neg: 0 };
      a.score += weight;
      if (weight > 0) a.pos += 1;
      else a.neg += 1;
      acc.set(key, a);
    }
  }
  const all = [...acc.entries()];
  const pos = all
    .filter(([, a]) => a.score > 0 && a.pos >= 1)
    .map(([key, a]) => ({ key, score: Math.round(a.score * 10) / 10, support: a.pos, confidence: confidence(a.pos) }))
    .sort((a, b) => b.score - a.score);
  // النفور يحتاج دليلين على الأقل: عمل واحد تركته لا يعني أنك تكره نوعه
  const neg = all
    .filter(([, a]) => a.score < 0 && a.neg >= 2)
    .map(([key, a]) => ({ key, score: Math.round(a.score * 10) / 10, support: a.neg, confidence: confidence(a.neg) }))
    .sort((a, b) => a.score - b.score);
  return { pos, neg };
}

function lengthOf(values: number[], kind: 'manga' | 'anime'): string | null {
  const v = values.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (v.length < 2) return null;
  const mid = v[Math.floor(v.length / 2)]!;
  if (kind === 'anime') return mid <= 13 ? 'short' : mid <= 26 ? 'medium' : 'long';
  return mid <= 60 ? 'short' : mid <= 160 ? 'medium' : 'long';
}

export function progressLabel(w: UserWork): string {
  if (w.kind === 'anime') return w.completed ? 'شاهدته كاملًا' : `وصلت الحلقة ${w.progress}`;
  return w.completed ? 'أكملته' : `وصلت الفصل ${w.progress}`;
}

/** أعمال المستخدم بإشاراتها من D1 والجهاز، مع بياناتها من AniList. */
export async function userWorks(db: D1Database, fetchImpl: Fetch, userId: string, local: LocalAnime[], now: number): Promise<UserWork[]> {
  const q = async <T>(sql: string) => (await db.prepare(sql).bind(userId).all<T>()).results;
  const [lib, reads, done, ratings, cols, views, feedback] = await Promise.all([
    q<{ series_ref: string; series_title: string | null; added_at: number }>('SELECT series_ref, series_title, added_at FROM library WHERE user_id = ? AND removed = 0'),
    q<{ series_ref: string; n: number; top: number | null; first_at: number; last_at: number }>(
      'SELECT series_ref, COUNT(*) AS n, MAX(chapter_number) AS top, MIN(first_read_at) AS first_at, MAX(last_read_at) AS last_at FROM chapter_reads WHERE user_id = ? GROUP BY series_ref',
    ),
    q<{ series_ref: string }>('SELECT series_ref FROM completions WHERE user_id = ? AND member = 1'),
    q<{ series_ref: string; score: number }>('SELECT series_ref, score FROM ratings WHERE user_id = ?'),
    q<{ series_ref: string; kind: string }>('SELECT series_ref, kind FROM collections WHERE user_id = ? AND member = 1'),
    q<{ series_ref: string; series_title: string | null; viewed_at: number }>('SELECT series_ref, series_title, viewed_at FROM work_views WHERE user_id = ? AND removed = 0'),
    q<{ work_id: string; opened_ref: string | null; feedback: string }>('SELECT work_id, opened_ref, feedback FROM rafiq_recs WHERE user_id = ? AND feedback IS NOT NULL'),
  ]);
  const refs = new Set<string>([...lib, ...reads, ...done, ...ratings, ...cols, ...views].map((r) => r.series_ref));
  const titles = new Map<string, string>();
  for (const r of [...lib, ...views]) if (r.series_title) titles.set(r.series_ref, r.series_title);
  const known = [...refs].filter((r) => !titles.has(r));
  for (let i = 0; i < known.length; i += 50) {
    const chunk = known.slice(i, i + 50);
    const { results } = await db.prepare(`SELECT series_ref, title FROM works WHERE series_ref IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all<{ series_ref: string; title: string | null }>();
    for (const r of results) if (r.title) titles.set(r.series_ref, r.title);
  }
  const fb = new Map<string, string>();
  for (const f of feedback) {
    fb.set(f.work_id, f.feedback);
    if (f.opened_ref) fb.set(f.opened_ref, f.feedback);
  }
  const readBy = new Map(reads.map((r) => [r.series_ref, r]));
  const doneSet = new Set(done.map((d) => d.series_ref));
  const ratingBy = new Map(ratings.map((r) => [r.series_ref, r.score]));
  const favorite = new Set(cols.filter((c) => c.kind === 'favorite').map((c) => c.series_ref));
  const later = new Set(cols.filter((c) => c.kind === 'read_later').map((c) => c.series_ref));
  const inLib = new Map(lib.map((l) => [l.series_ref, l.added_at]));
  const viewedAt = new Map(views.map((v) => [v.series_ref, v.viewed_at]));

  const base: Array<Omit<UserWork, 'state' | 'meta'>> = [];
  for (const ref of refs) {
    const title = titles.get(ref) ?? ref.replace(/^ext:/, '');
    // الأنمي من الجهاز، لا من جداول المانجا (مرجع anime: قد يصل من ترشيح)
    if (ref.startsWith('anime:')) continue;
    const r = readBy.get(ref);
    base.push({
      ref,
      kind: 'manga',
      title,
      progress: r ? Math.max(r.n, Math.floor(r.top ?? 0)) : 0,
      lastAt: Math.max(r?.last_at ?? 0, viewedAt.get(ref) ?? 0, inLib.get(ref) ?? 0),
      firstAt: r?.first_at ?? inLib.get(ref) ?? viewedAt.get(ref) ?? 0,
      completed: doneSet.has(ref),
      rating: ratingBy.get(ref) ?? null,
      favorite: favorite.has(ref),
      inLibrary: inLib.has(ref),
      readLater: later.has(ref),
      feedback: fb.get(ref) ?? null,
    });
  }
  for (const a of local.slice(0, 200)) {
    if (!Number.isInteger(a.id) || a.id <= 0) continue;
    const ref = `anime:${a.id}`;
    base.push({
      ref,
      kind: 'anime',
      title: String(a.title ?? ref).slice(0, 200),
      progress: Math.max(0, Math.floor(a.watched || 0)),
      lastAt: a.at ?? 0,
      firstAt: a.at ?? 0,
      completed: Boolean(a.done),
      rating: null,
      favorite: false,
      inLibrary: Boolean(a.listed),
      readLater: false,
      feedback: fb.get(ref) ?? null,
    });
  }
  // الأحدث أولًا، وسقف معقول: الذوق يُقرأ من ~120 عملًا لا من كل شيء
  base.sort((x, y) => y.lastAt - x.lastAt);
  const top = base.slice(0, 120);
  const meta = await metaFor(
    db,
    fetchImpl,
    top.map((w) => (w.kind === 'anime' ? { key: metaKeyForAnime(Number(w.ref.slice(6))), anilistId: Number(w.ref.slice(6)) } : { key: metaKeyForTitle(w.title), title: w.title, type: 'MANGA' as const })),
    now,
  );
  return top.map((w) => {
    const m = w.kind === 'anime' ? meta.get(metaKeyForAnime(Number(w.ref.slice(6)))) : meta.get(metaKeyForTitle(w.title));
    return { ...w, meta: m ?? null, state: classify(w, now) };
  });
}

export async function preferences(db: D1Database, userId: string): Promise<Preference[]> {
  const { results } = await db
    .prepare('SELECT id, kind, key, polarity, source, note FROM rafiq_prefs WHERE user_id = ? ORDER BY updated_at DESC LIMIT 80')
    .bind(userId)
    .all<Preference>();
  return results;
}

/** ملف الذوق المختصر الذي يراه النموذج. */
export function buildProfile(works: UserWork[], prefs: Preference[], now: number): TasteProfile {
  const genres = weigh(works, (m) => m.genres);
  const themes = weigh(works, (m) => m.tags);
  const strong = works.filter((w) => w.state === 'strong');
  const recent = works.filter((w) => w.lastAt >= now - 14 * DAY && w.meta && (w.state === 'current' || w.state === 'strong'));
  const recentKeys = new Map<string, number>();
  for (const w of recent) for (const k of [...(w.meta?.genres ?? []), ...(w.meta?.tags ?? []).slice(0, 4)]) recentKeys.set(k, (recentKeys.get(k) ?? 0) + 1);
  const engaged = works.filter((w) => w.progress > 0 || w.completed);
  const manga = engaged.filter((w) => w.kind === 'manga').length;
  const anime = engaged.filter((w) => w.kind === 'anime').length;
  return {
    favoriteGenres: genres.pos.slice(0, 8),
    dislikedGenres: genres.neg.slice(0, 5),
    preferredThemes: themes.pos.slice(0, 12),
    dislikedThemes: themes.neg.slice(0, 6),
    preferredLength: {
      manga: lengthOf(strong.filter((w) => w.kind === 'manga').map((w) => w.meta?.chapters ?? 0), 'manga'),
      anime: lengthOf(strong.filter((w) => w.kind === 'anime').map((w) => w.meta?.episodes ?? 0), 'anime'),
    },
    mangaVsAnime: { manga, anime, leaning: manga > anime * 2 ? 'manga' : anime > manga * 2 ? 'anime' : 'both' },
    recentInterests: [...recentKeys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k),
    strongPositiveWorks: strong.slice(0, 10).map((w) => w.title),
    completedWorks: works.filter((w) => w.completed).slice(0, 10).map((w) => w.title),
    abandonedWorks: works.filter((w) => w.state === 'abandoned').slice(0, 8).map((w) => w.title),
    currentWorks: works.filter((w) => w.state === 'current').slice(0, 8).map((w) => ({ title: w.title, progress: progressLabel(w) })),
    explicitPreferences: prefs.filter((p) => p.source === 'explicit').slice(0, 20).map((p) => ({ kind: p.kind, key: p.key, polarity: p.polarity })),
    counts: { works: works.length, engaged: engaged.length },
  };
}
