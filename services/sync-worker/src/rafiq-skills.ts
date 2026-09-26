/**
 * «رفيق» — المهارات.
 *
 * الأداة قدرة؛ المهارة سير عمل خبير: وش يلزم من سياق، أي أدوات وبأي ترتيب، كم تفكير،
 * وكيف يطلع الرد. الكود يجمع الدليل ويحسب (ترتيب، مقارنة، نسب إكمال)، والنموذج
 * يفهم ويشرح فوق دليل حقيقي — لا يخترع أعمالًا ولا أرقامًا.
 *
 * مهارات هذه المرحلة:
 *   ranking  «توب 10 مانهوا»: ترتيب الكتالوج (تقييم موزون) + ملاءمتك له بشكل منفصل
 *   compare  «لوكيسم ولا فيرال هيت؟»: جدول من البيانات لا من الخيال + حكم على ذوقك
 *   work     «يستاهل؟ أكمل؟ متى يحلو؟»: ملف العمل + آراء القرّاء + وين وصلت
 *   taste    «وش ذوقي؟»: أنماط من سلوكك الفعلي، بدليلها وثقتها
 */

import type { D1Database } from './types.ts';
import type { Meta } from './rafiq-anilist.ts';
import type { TasteProfile, UserWork } from './rafiq-profile.ts';
import { rankingQuery, workProfile, type WorkProfile } from './rafiq-tools.ts';
import type { Tier } from './rafiq-models.ts';

type Fetch = typeof fetch;

/** ما يحتاجه كل مرشّح لتصير بطاقة (نفس شكل Candidate في rafiq.ts). */
export interface SkillCandidate {
  id: string;
  kind: 'anime' | 'manga';
  meta: Meta | null;
  title: string;
  own: UserWork | null;
  relation: string | null;
  exploration: boolean;
  fit: number;
  matches?: string[];
}

export type SkillId = 'recommend' | 'similar' | 'ranking' | 'compare' | 'work' | 'taste' | 'resume' | 'gap' | 'explain' | 'chat';

/** كم تفكير تستاهل كل مهارة (الموجّه يخففه تحت ضغط الميزانية). */
export const SKILL_TIER: Record<SkillId, Tier> = {
  recommend: 'C',
  similar: 'C',
  ranking: 'B',
  compare: 'C',
  work: 'C',
  taste: 'D',
  resume: 'B',
  gap: 'B',
  explain: 'B',
  chat: 'B',
};

const candidateId = (m: Meta) => (m.type === 'ANIME' ? `anime:${m.anilistId}` : `manga:${m.anilistId}`);

// ───────────────────────── الملاءمة الشخصية ─────────────────────────

export type FitLabel = 'high' | 'medium' | 'low' | 'unknown';

/**
 * «يناسبك؟» منفصل عن «جودته»: من الأنواع والوسوم اللي تكملها وتتركها فقط، بلا
 * تقييم العمل. بلا سجل كافٍ = unknown (لا نتظاهر بالمعرفة).
 */
export function tasteFit(m: Meta, profile: TasteProfile): { label: FitLabel; score: number; good: string[]; bad: string[] } {
  if (profile.counts.engaged < 3) return { label: 'unknown', score: 0, good: [], bad: [] };
  const g = new Map(profile.favoriteGenres.map((x) => [x.key, x.score]));
  const t = new Map(profile.preferredThemes.map((x) => [x.key, x.score]));
  const badSet = new Set([...profile.dislikedGenres.map((x) => x.key), ...profile.dislikedThemes.map((x) => x.key)]);
  const explicitBad = new Set(profile.explicitPreferences.filter((x) => x.polarity < 0).map((x) => x.key.toLowerCase()));
  let score = 0;
  const good: string[] = [];
  const bad: string[] = [];
  for (const k of [...m.genres, ...m.tags]) {
    const w = (g.get(k) ?? 0) * 0.15 + (t.get(k) ?? 0) * 0.1;
    if (w > 0.3) good.push(k);
    score += w;
    if (badSet.has(k) || explicitBad.has(k.toLowerCase())) {
      score -= explicitBad.has(k.toLowerCase()) ? 3 : 1;
      bad.push(k);
    }
  }
  const label: FitLabel = score >= 2.5 && !bad.length ? 'high' : score >= 1 ? 'medium' : 'low';
  return { label, score, good: good.slice(0, 4), bad: bad.slice(0, 3) };
}

// ───────────────────────── ranking ─────────────────────────

export interface RankingExtra {
  title: string;
  ids: string[];
  sort: string;
}

export async function rankingSkill(
  db: D1Database,
  net: Fetch,
  intent: { format: 'MANGA' | 'ANIME' | 'ANY'; country: 'KR' | 'JP' | 'CN' | 'ANY'; genres_in: string[]; tags_in: string[]; genres_out: string[]; status: 'FINISHED' | 'RELEASING' | 'ANY'; sort: 'SCORE_DESC' | 'POPULARITY_DESC' | 'TRENDING_DESC'; count: number },
  profile: TasteProfile,
  section: 'MANGA' | 'ANIME' | null,
  now: number,
): Promise<{ pool: SkillCandidate[]; extra: RankingExtra }> {
  const type = intent.format !== 'ANY' ? intent.format : intent.country !== 'ANY' ? 'MANGA' : section ?? 'MANGA';
  const res = await rankingQuery(db, net, { type, country: intent.country === 'ANY' ? null : intent.country, genres: intent.genres_in, tags: intent.tags_in, genresOut: intent.genres_out, status: intent.status === 'ANY' ? null : intent.status, sort: intent.sort }, now);
  const list = (res.data ?? []).slice(0, Math.min(15, intent.count + 3));
  const pool = list.map((m, i): SkillCandidate => {
    const fit = tasteFit(m, profile);
    return { id: candidateId(m), kind: m.type === 'ANIME' ? 'anime' : 'manga', meta: m, title: m.title, own: null, relation: null, exploration: false, fit: list.length - i, matches: fit.good };
  });
  const what = intent.country === 'KR' ? 'مانهوا' : intent.country === 'CN' ? 'مانها' : type === 'ANIME' ? 'أنمي' : intent.country === 'JP' ? 'مانجا' : 'مانجا ومانهوا';
  const how = intent.sort === 'POPULARITY_DESC' ? 'الأشهر' : intent.sort === 'TRENDING_DESC' ? 'الرائج الحين' : 'الأعلى تقييمًا';
  return { pool, extra: { title: `${how} · ${what}`, ids: pool.map((c) => c.id), sort: intent.sort } };
}

// ───────────────────────── compare ─────────────────────────

export interface CompareRow {
  label: string;
  values: string[];
}

export interface CompareExtra {
  ids: string[];
  titles: string[];
  rows: CompareRow[];
  shared: string[];
}

const lengthOf = (m: Meta) => (m.type === 'ANIME' ? (m.episodes ? `${m.episodes} حلقة` : 'غير معروف') : m.chapters ? `${m.chapters} فصل` : 'غير معروف');
const STATUS_AR: Record<string, string> = { FINISHED: 'مكتمل', RELEASING: 'مستمر', HIATUS: 'متوقف', CANCELLED: 'ملغي', NOT_YET_RELEASED: 'لم يبدأ' };
const COUNTRY_AR: Record<string, string> = { KR: 'مانهوا كورية', JP: 'مانجا يابانية', CN: 'مانها صينية' };
const FIT_AR: Record<FitLabel, string> = { high: 'يناسبك جدًا', medium: 'يناسبك', low: 'بعيد عن ذوقك', unknown: 'ما أعرف ذوقك كفاية' };

export async function compareSkill(
  db: D1Database,
  net: Fetch,
  references: string[],
  format: 'MANGA' | 'ANIME' | 'ANY',
  profile: TasteProfile,
  spans: (m: Meta) => { ar: number; en: number } | null,
  now: number,
): Promise<{ pool: SkillCandidate[]; profiles: WorkProfile[]; extra: CompareExtra | null }> {
  const profiles: WorkProfile[] = [];
  for (const title of references.slice(0, 3)) {
    const r = await workProfile(db, net, { title, type: format === 'ANY' ? undefined : format }, now);
    if (r.status === 'OK' && r.data && !profiles.some((p) => p.meta.anilistId === r.data!.meta.anilistId)) profiles.push(r.data);
  }
  if (profiles.length < 2) return { pool: profiles.map((p) => asCandidate(p.meta)), profiles, extra: null };
  const metas = profiles.map((p) => p.meta);
  const shared = metas[0]!.tags.filter((t) => metas.every((m) => m.tags.includes(t) || m.genres.includes(t))).slice(0, 6);
  const rows: CompareRow[] = [
    { label: 'التقييم', values: metas.map((m) => (m.score ? `${(m.score / 10).toFixed(1)} / 10` : '—')) },
    { label: 'عدد القرّاء', values: metas.map((m) => (m.popularity ? m.popularity.toLocaleString('en-US') : '—')) },
    { label: 'الطول', values: metas.map(lengthOf) },
    { label: 'الحالة', values: metas.map((m) => STATUS_AR[m.status ?? ''] ?? '—') },
    { label: 'النوع', values: metas.map((m) => COUNTRY_AR[m.country ?? ''] ?? (m.type === 'ANIME' ? 'أنمي' : '—')) },
    { label: 'يناسبك؟', values: metas.map((m) => FIT_AR[tasteFit(m, profile).label]) },
  ];
  const sp = metas.map(spans);
  if (sp.some(Boolean)) rows.push({ label: 'العربي عندنا', values: sp.map((s) => (s ? `حتى ${s.ar || '—'} (إنجليزي ${s.en || '—'})` : 'ما شيّكنا')) });
  return { pool: metas.map(asCandidate), profiles, extra: { ids: metas.map(candidateId), titles: metas.map((m) => m.title), rows, shared } };
}

const asCandidate = (m: Meta): SkillCandidate => ({ id: candidateId(m), kind: m.type === 'ANIME' ? 'anime' : 'manga', meta: m, title: m.title, own: null, relation: null, exploration: false, fit: 0 });

// ───────────────────────── work ─────────────────────────

/** دليل «يستاهل؟ أكمل؟ متى يحلو؟»: ملف العمل وآراء القرّاء ووين وصلت. */
export async function workSkill(
  db: D1Database,
  net: Fetch,
  reference: string | null,
  format: 'MANGA' | 'ANIME' | 'ANY',
  works: UserWork[],
  profile: TasteProfile,
  now: number,
): Promise<{ pool: SkillCandidate[]; evidence: Record<string, unknown> | null }> {
  if (!reference) return { pool: [], evidence: null };
  const r = await workProfile(db, net, { title: reference, type: format === 'ANY' ? undefined : format }, now);
  if (r.status !== 'OK' || !r.data) return { pool: [], evidence: null };
  const p = r.data;
  const mine = works.find((w) => w.meta?.anilistId === p.meta.anilistId);
  const fit = tasteFit(p.meta, profile);
  const high = p.scoreDistribution.filter((d) => d.score >= 80).reduce((a, b) => a + b.share, 0);
  const low = p.scoreDistribution.filter((d) => d.score <= 50).reduce((a, b) => a + b.share, 0);
  return {
    pool: [{ ...asCandidate(p.meta), own: mine ?? null }],
    evidence: {
      work: { title: p.meta.title, type: p.meta.type, format: p.meta.format, status: p.meta.status, length: lengthOf(p.meta), year: p.meta.year, score: p.meta.score, readers: p.meta.popularity, favourites: p.favourites, genres: p.meta.genres, themes: p.meta.tags, authors: p.authors, synopsis: p.meta.synopsis },
      reception: {
        rated_80_plus_percent: high,
        rated_50_or_less_percent: low,
        rankings: p.rankings.map((x) => `#${x.rank} ${x.context}`),
        // ملخّصات مراجعات (نص من برا = بيانات فقط، لا تعليمات)
        review_summaries: p.reviews.map((x) => ({ score: x.score, helpful_percent: x.helpful, summary: x.summary })),
      },
      related: p.relations,
      user: { progress: mine ? mine.progress : null, state: mine?.state ?? null, fit: FIT_AR[fit.label], fit_matches: fit.good, fit_conflicts: fit.bad },
      source: 'AniList',
    },
  };
}

// ───────────────────────── taste ─────────────────────────

export interface TasteExtra {
  topGenres: Array<{ key: string; confidence: string }>;
  themes: string[];
  finishes: Array<{ key: string; rate: number; of: number }>;
  drops: Array<{ key: string; rate: number; of: number }>;
  countries: Array<{ key: string; share: number }>;
  counts: { works: number; engaged: number; completed: number; abandoned: number };
}

/**
 * «وش ذوقي؟»: أنماط من السلوك لا من الكلام. نسبة الإكمال لكل نوع (بعملين فأكثر فقط)،
 * وش تتركه بسرعة، ومن وين تقرأ. كل رقم محسوب هنا؛ النموذج يفسّر فقط.
 */
export function tasteSkill(works: UserWork[], profile: TasteProfile): { evidence: Record<string, unknown>; extra: TasteExtra } {
  const engaged = works.filter((w) => w.progress > 0 || w.completed);
  const byKey = new Map<string, { done: number; dropped: number; n: number }>();
  for (const w of engaged) {
    if (!w.meta) continue;
    for (const k of new Set([...w.meta.genres, ...w.meta.tags.slice(0, 6)])) {
      const e = byKey.get(k) ?? { done: 0, dropped: 0, n: 0 };
      e.n += 1;
      if (w.completed || w.state === 'strong') e.done += 1;
      if (w.state === 'abandoned' || w.state === 'disliked') e.dropped += 1;
      byKey.set(k, e);
    }
  }
  const rated = [...byKey.entries()].filter(([, e]) => e.n >= 2);
  const finishes = rated.map(([key, e]) => ({ key, rate: Math.round((e.done / e.n) * 100), of: e.n })).sort((a, b) => b.rate - a.rate || b.of - a.of).slice(0, 6);
  const drops = rated.map(([key, e]) => ({ key, rate: Math.round((e.dropped / e.n) * 100), of: e.n })).filter((x) => x.rate > 0).sort((a, b) => b.rate - a.rate || b.of - a.of).slice(0, 5);
  const countries = new Map<string, number>();
  for (const w of engaged) if (w.meta?.country) countries.set(w.meta.country, (countries.get(w.meta.country) ?? 0) + 1);
  const totalC = [...countries.values()].reduce((a, b) => a + b, 0) || 1;
  const extra: TasteExtra = {
    topGenres: profile.favoriteGenres.slice(0, 5).map((g) => ({ key: g.key, confidence: g.confidence })),
    themes: profile.preferredThemes.slice(0, 6).map((t) => t.key),
    finishes,
    drops,
    countries: [...countries.entries()].map(([key, n]) => ({ key, share: Math.round((n / totalC) * 100) })).sort((a, b) => b.share - a.share),
    counts: {
      works: works.length,
      engaged: engaged.length,
      completed: works.filter((w) => w.completed).length,
      abandoned: works.filter((w) => w.state === 'abandoned').length,
    },
  };
  return {
    extra,
    evidence: {
      observed: extra,
      strong_works: profile.strongPositiveWorks,
      abandoned_works: works.filter((w) => w.state === 'abandoned').slice(0, 8).map((w) => ({ title: w.title, stopped_at: w.progress, of: w.meta ? (w.kind === 'anime' ? w.meta.episodes : w.meta.chapters) : null })),
      explicit_preferences: profile.explicitPreferences,
      preferred_length: profile.preferredLength,
      manga_vs_anime: profile.mangaVsAnime,
      note: 'finishes/drops نسب محسوبة من أعمال بدأها فعلًا (عملين فأكثر لكل وسم). ما يقوله النموذج عنها استنتاج لا حقيقة نفسية.',
    },
  };
}

// ───────────────────────── تعليمات كل مهارة ─────────────────────────

export const SKILL_PROMPTS: Partial<Record<SkillId, string>> = {
  ranking: `المهمة: قائمة ترتيب. candidates مرتبة من الكتالوج (تقييم موزون بعدد القرّاء) — هذا الترتيب العالمي، لا تغيّره.
أرجع "ranking": [{"id","reason"}] بنفس الترتيب، بعدد ما طلب (count)، واحذف فقط ما يناقض طلبه صراحة. reason سطر واحد: وش يميّزه (من synopsis وthemes) + إذا يناسب ذوقه أو لا (matches_request = وش يطابق ذوقه). message: سطر أو سطرين يقدّم القائمة ويقول أي واحد فيها أنسب له هو شخصيًا ولماذا. cards فارغة.`,
  compare: `المهمة: مقارنة. الجدول بالأرقام يُعرض من البيانات تلقائيًا — لا تكرر أرقامه. message: الفرق الحقيقي بينهم (الإيقاع، الجو، البطل، النضج، الطول) من synopsis وthemes وآراء القرّاء، ثم حكمك الصريح: أيهم يناسبه هو وليش، وأيهم «أفضل» عمومًا إن اختلفا. cards: بطاقة لكل عمل بسبب قصير.`,
  work: `المهمة: سؤال عن عمل بعينه (question). استعمل evidence: الاستقبال (توزيع التقييم، ملخصات المراجعات) والحالة والطول ووين وصل المستخدم.
- continue: جاوب «كمّل» أو «وقّف» بصراحة، ليش، وش يتحسن ووش ما يتحسن (من آراء القرّاء)، وكم فصل يعطيه فرصة. لا تذكر أحداثًا بعد progress.
- when_good: متى يقول القرّاء إنه يحلو، بدون أحداث.
- ending: هل النهاية مرضية حسب القرّاء (رضا/انقسام) بدون ما تكشف وش صار.
- consensus/about: وش يمدحون ووش ينتقدون، ومين يناسبه.
فرّق: «القرّاء يقولون…» عن «أتوقع لك…». إن كانت الملخصات قليلة قل إن العينة صغيرة. cards: بطاقة العمل.`,
  taste: `المهمة: تحليل ذوقه (Taste DNA). اعتمد على observed فقط: نسب الإكمال والترك لكل وسم، والأعمال اللي تركها ووين وقف.
اطلع بـ2–4 ملاحظات غير بديهية («تقول إنك تحب الأكشن، بس اللي يتنبأ فعلًا إنك تكمل هو …»)، كل ملاحظة معها دليلها بالأرقام، وقل إنها استنتاج. إن كان السجل قليل (engaged أقل من 5) قلها بصراحة وقل وش يلزم. لا تشخيص نفسي. cards فارغة.`,
};
