/**
 * «رفيق» — مساعد توصيات شخصي داخل VANTARA.
 *
 * ليس شاتًا عامًّا. المسار لكل رسالة:
 *
 *   الطلب + ملف الذوق ──► فهم الطلب (DeepSeek، JSON صغير: أنواع، وسوم، طول، مرجع…)
 *                     ──► مرشّحون حقيقيون من الكتالوج (AniList بشروط الطلب، أو أعمالك أنت)
 *                     ──► DeepSeek يرتّب ويشرح (بث حيّ، JSON: رسالة + بطاقات بمعرّفات)
 *                     ──► الخادم يتحقق: كل معرّف من المرشّحين وإلا يُحذف، والبطاقة
 *                         تُبنى من بياناتنا لا من كلام النموذج (العنوان، الغلاف، العدد…)
 *
 * النموذج لا يخترع عملًا ولا رقمًا: لا يرى إلا المرشّحين، ولا يُعرض إلا ما نعرفه.
 * ما يحسبه VANTARA وحده (كم فصلًا قرأت) لا يمر بالنموذج أصلًا.
 *
 * مقفل إلا لمن فُتح له (`RAFIQ_USERS`، وإلا مالك الحساب): غيره لا يصل DeepSeek أبدًا.
 */

import type { D1Database, Env } from './types.ts';
import { ANILIST, GENRES, type Meta, TAGS, candidates, metaFor, metaKeyForAnime, metaKeyForManga, metaKeyForTitle, searchTitle, similarTo, titleMatches } from './rafiq-anilist.ts';
import { quotaState, translationAllowed, type TranslationEnv } from './translate.ts';
import { type ChatMessage, LlmError, type LlmEnv, chatJson, chatStream } from './rafiq-llm.ts';
import { type LocalAnime, type Preference, type TasteProfile, type UserWork, buildProfile, preferences, progressLabel, userWorks } from './rafiq-profile.ts';

type Fetch = typeof fetch;
export type RafiqEnv = Env & LlmEnv & { RAFIQ_USERS?: string };

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const RECENT_MESSAGES = 8;
const MAX_TEXT = 800;

// ───────────────────────── الإتاحة ─────────────────────────

/**
 * `RAFIQ_USERS` (وإلا `TRANSLATE_USERS`): أسماء أو معرّفات بفواصل. غير مضبوطين: صاحب
 * الحساب الذي فُتحت له الترجمة (أكثر من ترجم)؛ ولا أحد إن لم يترجم أحد بعد — رفيق
 * يصرف من المفتاح، فلا يُفتح لأحد بالصدفة.
 */
export async function rafiqAllowed(env: RafiqEnv, userId: string): Promise<boolean> {
  const list = (env.RAFIQ_USERS || env.TRANSLATE_USERS || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
  if (list.length) {
    if (list.includes(userId.toLowerCase())) return true;
    const row = await env.DB.prepare('SELECT username FROM accounts WHERE user_id = ?').bind(userId).first<{ username: string }>();
    return Boolean(row && list.includes(row.username.toLowerCase()));
  }
  const top = await env.DB.prepare('SELECT created_by FROM translation_pages GROUP BY created_by ORDER BY COUNT(*) DESC, MIN(created_at) LIMIT 1').first<{ created_by: string }>();
  return Boolean(top && top.created_by === userId);
}

// ───────────────────────── ملف الذوق ─────────────────────────

interface ProfileBundle {
  profile: TasteProfile;
  works: UserWork[];
  prefs: Preference[];
}

function cleanLocal(raw: unknown): LocalAnime[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 200)
    .map((a) => a as Record<string, unknown>)
    .filter((a) => Number.isInteger(a.id))
    .map((a) => {
      const out: LocalAnime = { id: Number(a.id), watched: Math.max(0, Math.min(5000, Number(a.watched) || 0)), done: Boolean(a.done), listed: Boolean(a.listed) };
      if (typeof a.title === 'string') out.title = a.title.slice(0, 200);
      if (Number.isFinite(Number(a.total)) && a.total !== null) out.total = Number(a.total);
      if (Number.isFinite(Number(a.at))) out.at = Number(a.at);
      return out;
    });
}

/** أين وصل العربي وأين وصل الإنجليزي لأعمال يعرف الجهاز فصولها (مكتبتك وآخر ما فتحت). */
export interface Gap {
  ref: string;
  title: string;
  ar: number;
  en: number;
}

function cleanGaps(raw: unknown): Gap[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 150)
    .map((g) => g as Record<string, unknown>)
    .filter((g) => typeof g.ref === 'string' && g.ref.startsWith('ext:') && typeof g.title === 'string')
    .map((g) => ({ ref: String(g.ref).slice(0, 300), title: String(g.title).slice(0, 200), ar: Math.max(0, Number(g.ar) || 0), en: Math.max(0, Number(g.en) || 0) }))
    .filter((g) => g.en > 0 || g.ar > 0);
}

async function profileFor(env: RafiqEnv, fetchImpl: Fetch, userId: string, local: LocalAnime[] | null, now: number): Promise<ProfileBundle> {
  const row = await env.DB.prepare('SELECT local_json FROM rafiq_profile WHERE user_id = ?').bind(userId).first<{ local_json: string | null }>();
  const localAnime = local ?? (row?.local_json ? (JSON.parse(row.local_json) as LocalAnime[]) : []);
  const [works, prefs] = await Promise.all([userWorks(env.DB, fetchImpl, userId, localAnime, now), preferences(env.DB, userId)]);
  const profile = buildProfile(works, prefs, now);
  await env.DB.prepare(
    'INSERT INTO rafiq_profile (user_id, data_json, local_json, computed_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET data_json = excluded.data_json, local_json = excluded.local_json, computed_at = excluded.computed_at',
  )
    .bind(userId, JSON.stringify(profile), JSON.stringify(localAnime), now)
    .run();
  await measure(env.DB, userId, works, now);
  return { profile, works, prefs };
}

/**
 * نجاح التوصية: فُتحت ← بدأ (قرأ/شاهد بعد ظهورها) ← استمر (3 فصول/حلقات فأكثر).
 * يُحدَّث من السلوك الفعلي، لا من ضغطة زر.
 */
async function measure(db: D1Database, userId: string, works: UserWork[], now: number): Promise<void> {
  const { results } = await db
    .prepare('SELECT id, work_id, opened_ref, shown_at, started_at, continued_at FROM rafiq_recs WHERE user_id = ? AND continued_at IS NULL AND shown_at > ?')
    .bind(userId, now - 60 * 86_400_000)
    .all<{ id: string; work_id: string; opened_ref: string | null; shown_at: number; started_at: number | null; continued_at: number | null }>();
  if (!results.length) return;
  const byRef = new Map(works.map((w) => [w.ref, w]));
  const stmts = [];
  for (const r of results) {
    const w = byRef.get(r.opened_ref ?? '') ?? byRef.get(r.work_id);
    if (!w || w.lastAt < r.shown_at || w.progress <= 0) continue;
    const started = r.started_at ?? w.lastAt;
    const continued = w.progress >= 3 ? w.lastAt : null;
    stmts.push(db.prepare('UPDATE rafiq_recs SET started_at = ?, continued_at = ? WHERE id = ?').bind(started, continued, r.id));
  }
  if (stmts.length) await db.batch(stmts);
}

// ───────────────────────── المحادثة ─────────────────────────

interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  cards_json: string | null;
  chips_json: string | null;
  created_at: number;
}

async function conversationOf(db: D1Database, userId: string, id: string | null, now: number): Promise<{ id: string; summary: string | null }> {
  if (id) {
    const row = await db.prepare('SELECT id, summary FROM rafiq_conversations WHERE id = ? AND user_id = ?').bind(id, userId).first<{ id: string; summary: string | null }>();
    if (row) return row;
  }
  const last = await db.prepare('SELECT id, summary FROM rafiq_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1').bind(userId).first<{ id: string; summary: string | null }>();
  if (last && !id) return last;
  const fresh = crypto.randomUUID();
  await db.prepare('INSERT INTO rafiq_conversations (id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?)').bind(fresh, userId, now, now).run();
  return { id: fresh, summary: null };
}

async function recentMessages(db: D1Database, conversationId: string, limit: number): Promise<StoredMessage[]> {
  const { results } = await db
    .prepare('SELECT id, role, content, cards_json, chips_json, created_at FROM rafiq_messages WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .bind(conversationId, limit)
    .all<StoredMessage>();
  return results.reverse();
}

// ───────────────────────── فهم الطلب ─────────────────────────

export interface Intent {
  intent: 'recommend' | 'resume' | 'similar' | 'explain' | 'lookup' | 'feedback' | 'chat';
  format: 'MANGA' | 'ANIME' | 'ANY';
  genres_in: string[];
  genres_out: string[];
  tags_in: string[];
  tags_out: string[];
  length: 'short' | 'medium' | 'long' | 'any';
  status: 'FINISHED' | 'RELEASING' | 'ANY';
  reference: string | null;
  exploration: 'low' | 'normal' | 'high';
  mood: string | null;
  /** يسأل عن أعمال عربيها متأخر عن الإنجليزي (أو يبي يترجم فصولًا مقدمًا). */
  gap: boolean;
  preference_updates: Array<{ kind: string; key: string; polarity: 1 | -1; note?: string | null }>;
  feedback: Array<{ target: 'last' | string; kind: 'not_for_me' | 'like' | 'seen' | 'less_like' | 'more_like' }>;
}

export const INTENT_PROMPT = `أنت وحدة فهم الطلبات داخل «رفيق»، مساعد توصيات الأنمي والمانجا في تطبيق VANTARA.
مهمتك: تحويل رسالة المستخدم إلى JSON منظّم فقط. لا تقترح أعمالًا ولا تكتب ردًّا للمستخدم.

الحقول:
- intent: recommend (يريد اقتراحات) | resume (يريد إكمال شيء بدأه أو تركه) | similar (شيء يشبه عملًا بعينه) | explain (يسأل لماذا اقتُرح عمل، أو عن عمل في الرسائل السابقة) | lookup (يسأل عن عمل بعينه بالاسم) | feedback (رأي في اقتراح سابق فقط دون طلب جديد) | chat (كلام عام).
- format: MANGA أو ANIME أو ANY. المانهوا والمانها = MANGA.
- genres_in / genres_out: من هذه القائمة حرفيًّا فقط: ${GENRES.join(', ')}.
- tags_in / tags_out: من هذه القائمة حرفيًّا فقط: ${TAGS.join(', ')}.
- length: short (قصير، ينتهي بسرعة) | medium | long | any.
- status: FINISHED (مكتمل) | RELEASING (مستمر) | ANY.
- reference: عنوان العمل المذكور (للتشابه أو السؤال عنه) بعنوانه الإنجليزي أو الروماجي المعروف، حتى لو كتبه المستخدم بالعربي («سولو ليفلنق» → "Solo Leveling")، وإلا null.
- exploration: high إن طلب شيئًا مختلفًا أو «فاجئني»، low إن طلب شيئًا قريبًا جدًّا من ذوقه، وإلا normal.
- mood: وصف قصير بالعربي للمزاج الحالي إن ذُكر («هادي قبل النوم»، «يحمّس»)، وإلا null.
- gap: true إن سأل عن أعمال ترجمتها العربية متأخرة عن الإنجليزية («العربي واقف عند 22 والإنجليزي 72»)، أو طلب يترجم/يجهّز فصولًا مقدمًا، وإلا false.
- preference_updates: تفضيلات **دائمة** قالها صراحة فقط («لا عاد تقترح أعمال مدرسية» → {kind:"tag", key:"School", polarity:-1}). kind: genre | tag | length | format | pacing | other. الكلام العابر («تعبان اليوم») ليس تفضيلًا دائمًا.
- feedback: رأيه في اقتراح سابق («ذا سيئ لا تجيب لي زيه» → {target:"last", kind:"less_like"}؛ «شفته» → seen؛ «مو لي» → not_for_me؛ «عجبني» → like). target: "last" أو عنوان العمل.

الطلب الحالي أهم من الذوق العام: «أبي شيء هادي» يعني tags/genres هادئة حتى لو كان يحب الأكشن.
أرجع JSON فقط بهذه الحقول كلها.`;

const INTENT_DEFAULT: Intent = {
  intent: 'recommend',
  format: 'ANY',
  genres_in: [],
  genres_out: [],
  tags_in: [],
  tags_out: [],
  length: 'any',
  status: 'ANY',
  reference: null,
  exploration: 'normal',
  mood: null,
  gap: false,
  preference_updates: [],
  feedback: [],
};

const pickEnum = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const pickList = (v: unknown, allowed: readonly string[]) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && allowed.includes(x)))].slice(0, 6) : []);

export function cleanIntent(raw: unknown): Intent {
  const r = (raw ?? {}) as Record<string, unknown>;
  const tags = TAGS;
  return {
    intent: pickEnum(r.intent, ['recommend', 'resume', 'similar', 'explain', 'lookup', 'feedback', 'chat'] as const, 'recommend'),
    format: pickEnum(r.format, ['MANGA', 'ANIME', 'ANY'] as const, 'ANY'),
    genres_in: pickList(r.genres_in, GENRES),
    genres_out: pickList(r.genres_out, GENRES),
    tags_in: pickList(r.tags_in, tags),
    tags_out: pickList(r.tags_out, tags),
    length: pickEnum(r.length, ['short', 'medium', 'long', 'any'] as const, 'any'),
    status: pickEnum(r.status, ['FINISHED', 'RELEASING', 'ANY'] as const, 'ANY'),
    reference: typeof r.reference === 'string' && r.reference.trim() ? r.reference.trim().slice(0, 200) : null,
    exploration: pickEnum(r.exploration, ['low', 'normal', 'high'] as const, 'normal'),
    mood: typeof r.mood === 'string' && r.mood.trim() ? r.mood.trim().slice(0, 80) : null,
    gap: r.gap === true,
    preference_updates: Array.isArray(r.preference_updates)
      ? r.preference_updates
          .map((p) => p as Record<string, unknown>)
          .filter((p) => typeof p.key === 'string' && p.key.trim() && (p.polarity === 1 || p.polarity === -1))
          .slice(0, 5)
          .map((p) => ({
            kind: pickEnum(p.kind, ['genre', 'tag', 'length', 'format', 'pacing', 'other'] as const, 'other'),
            key: String(p.key).trim().slice(0, 60),
            polarity: p.polarity as 1 | -1,
            note: typeof p.note === 'string' ? p.note.slice(0, 160) : null,
          }))
      : [],
    feedback: Array.isArray(r.feedback)
      ? r.feedback
          .map((f) => f as Record<string, unknown>)
          .filter((f) => typeof f.target === 'string')
          .slice(0, 4)
          .map((f) => ({ target: String(f.target).slice(0, 200), kind: pickEnum(f.kind, ['not_for_me', 'like', 'seen', 'less_like', 'more_like'] as const, 'not_for_me') }))
      : [],
  };
}

// ───────────────────────── المرشّحون ─────────────────────────

export interface Candidate {
  id: string; // anime:<id> | manga:<id> | ext:… (عمل من مكتبتك)
  kind: 'anime' | 'manga';
  meta: Meta | null;
  title: string;
  own: UserWork | null;
  relation: string | null;
  exploration: boolean;
  fit: number;
  /** وين وصل العربي والإنجليزي (من الجهاز)؛ null = ما نعرف. */
  span?: Gap | null;
}

const candidateId = (m: Meta) => (m.type === 'ANIME' ? `anime:${m.anilistId}` : `manga:${m.anilistId}`);

/** أقرب عمل أحبه المستخدم لهذا المرشّح: «يشبه X في …» من بيانات حقيقية. */
function relationTo(m: Meta, strong: UserWork[]): string | null {
  let best: { title: string; shared: string[] } | null = null;
  for (const w of strong) {
    if (!w.meta) continue;
    const shared = [...m.genres.filter((g) => w.meta!.genres.includes(g)), ...m.tags.filter((t) => w.meta!.tags.includes(t))];
    if (!best || shared.length > best.shared.length) best = { title: w.title, shared };
  }
  return best && best.shared.length >= 2 ? `يشارك «${best.title}» في: ${best.shared.slice(0, 4).join(', ')}` : null;
}

function affinity(m: Meta, p: TasteProfile, intent: Intent): number {
  const g = new Map(p.favoriteGenres.map((x) => [x.key, x.score]));
  const t = new Map(p.preferredThemes.map((x) => [x.key, x.score]));
  const bad = new Set([...p.dislikedGenres.map((x) => x.key), ...p.dislikedThemes.map((x) => x.key)]);
  const explicitBad = new Set(p.explicitPreferences.filter((x) => x.polarity < 0).map((x) => x.key.toLowerCase()));
  const explicitGood = new Set(p.explicitPreferences.filter((x) => x.polarity > 0).map((x) => x.key.toLowerCase()));
  let s = 0;
  for (const x of m.genres) s += (g.get(x) ?? 0) * 0.15 + (bad.has(x) ? -1 : 0) + (explicitBad.has(x.toLowerCase()) ? -3 : 0) + (explicitGood.has(x.toLowerCase()) ? 1 : 0);
  for (const x of m.tags) s += (t.get(x) ?? 0) * 0.1 + (bad.has(x) ? -0.8 : 0) + (explicitBad.has(x.toLowerCase()) ? -3 : 0) + (explicitGood.has(x.toLowerCase()) ? 0.8 : 0);
  // الطلب الحالي فوق الذوق العام
  s += m.genres.filter((x) => intent.genres_in.includes(x)).length * 1.2 + m.tags.filter((x) => intent.tags_in.includes(x)).length * 1.4;
  s += ((m.score ?? 60) - 60) / 15 + Math.log10((m.popularity ?? 100) + 1) * 0.3;
  return s;
}

async function gatherCandidates(db: D1Database, fetchImpl: Fetch, intent: Intent, bundle: ProfileBundle, lastCards: string[], gaps: Gap[], now: number): Promise<Candidate[]> {
  const { profile, works } = bundle;
  const strong = works.filter((w) => w.state === 'strong');
  const knownIds = new Set<number>();
  for (const w of works) if (w.meta && (w.progress > 0 || w.completed || w.state === 'disliked' || w.feedback)) knownIds.add(w.meta.anilistId);
  for (const id of lastCards) {
    const n = Number(id.split(':')[1]);
    if (Number.isInteger(n)) knownIds.add(n);
  }
  const wrap = (m: Meta, exploration = false): Candidate => ({
    id: candidateId(m),
    kind: m.type === 'ANIME' ? 'anime' : 'manga',
    meta: m,
    title: m.title,
    own: null,
    relation: relationTo(m, strong),
    exploration,
    fit: affinity(m, profile, intent),
  });

  // العربي متأخر عن الإنجليزي: أعمالك اللي يعرف الجهاز فصولها، الأكبر فجوة أولًا
  if (intent.gap) {
    const behind = gaps.filter((g) => g.en > g.ar).sort((a, b) => b.en - b.ar - (a.en - a.ar)).slice(0, 12);
    const metas = await metaFor(db, fetchImpl, behind.map((g) => ({ key: metaKeyForTitle(g.title), title: g.title, type: 'MANGA' as const })), now);
    const own = new Map(works.map((w) => [w.ref, w]));
    const mine = behind.map((g): Candidate => {
      const w = own.get(g.ref) ?? null;
      return { id: g.ref, kind: 'manga', meta: metas.get(metaKeyForTitle(g.title)) ?? null, title: g.title, own: w, relation: w ? progressLabel(w) : null, exploration: false, fit: g.en - g.ar, span: g };
    });
    if (mine.length >= 2) return mine;
    // ما عندنا أعمال كفاية بفجوة معروفة: مانهوا مرشّحة، والجهاز يشيّك فصولها
    const more = await candidates(fetchImpl, { type: 'MANGA', genresIn: intent.genres_in, genresOut: intent.genres_out, tagsIn: intent.tags_in, tagsOut: intent.tags_out, length: intent.length, status: null, sort: 'POPULARITY_DESC', exclude: [...knownIds] });
    return [...mine, ...more.slice(0, 16).map((m) => wrap(m))];
  }

  if (intent.intent === 'resume') {
    const mine = works
      .filter((w) => (w.state === 'current' || w.state === 'abandoned' || w.state === 'started') && !w.completed)
      .filter((w) => intent.format === 'ANY' || (intent.format === 'ANIME') === (w.kind === 'anime'))
      .slice(0, 12);
    return mine.map((w) => ({ id: w.ref, kind: w.kind, meta: w.meta, title: w.title, own: w, relation: progressLabel(w), exploration: false, fit: w.lastAt }));
  }

  const types: Array<'ANIME' | 'MANGA'> =
    intent.format === 'ANIME' ? ['ANIME'] : intent.format === 'MANGA' ? ['MANGA'] : profile.mangaVsAnime.leaning === 'anime' ? ['ANIME', 'MANGA'] : ['MANGA', 'ANIME'];
  const exclude = [...knownIds];
  const out: Candidate[] = [];

  if ((intent.intent === 'similar' || intent.intent === 'lookup') && intent.reference) {
    const ref = await searchTitle(fetchImpl, intent.reference, intent.format === 'ANY' ? undefined : intent.format);
    if (ref) {
      if (intent.intent === 'lookup') out.push(wrap(ref));
      const sims = await similarTo(fetchImpl, ref.anilistId);
      out.push(...sims.filter((m) => !knownIds.has(m.anilistId)).map((m) => wrap(m)));
      if (intent.intent === 'lookup') return out.slice(0, 16);
    }
  }

  const disliked = profile.dislikedGenres.filter((g) => g.confidence !== 'low').map((g) => g.key);
  const explicitOutTags = profile.explicitPreferences.filter((p) => p.polarity < 0 && p.kind === 'tag').map((p) => p.key);
  const explicitOutGenres = profile.explicitPreferences.filter((p) => p.polarity < 0 && p.kind === 'genre').map((p) => p.key);
  const genresOut = [...new Set([...intent.genres_out, ...explicitOutGenres, ...(intent.genres_in.length ? [] : disliked)])];
  const tagsOut = [...new Set([...intent.tags_out, ...explicitOutTags])];
  const favGenres = profile.favoriteGenres.filter((g) => g.confidence !== 'low').slice(0, 3).map((g) => g.key);
  for (const type of types) {
    const base = {
      type,
      genresOut,
      tagsOut,
      length: intent.length,
      status: intent.status === 'ANY' ? null : intent.status,
      exclude,
    };
    // الطلب كما هو؛ وإن لم يحدد نوعًا: أنواعك المفضّلة
    const primary = await candidates(fetchImpl, {
      ...base,
      genresIn: intent.genres_in.length ? intent.genres_in : intent.tags_in.length || intent.exploration === 'high' ? [] : favGenres,
      tagsIn: intent.tags_in,
      sort: intent.exploration === 'high' ? 'SCORE_DESC' : 'POPULARITY_DESC',
    });
    out.push(...primary.map((m) => wrap(m)));
    // استكشاف صغير: خارج أنواعك المعتادة، بتقييم عالٍ، بنفس شروط الطلب
    if (intent.exploration !== 'low') {
      const explore = await candidates(fetchImpl, { ...base, genresIn: intent.genres_in, tagsIn: intent.tags_in, genresOut: [...genresOut, ...favGenres.slice(0, 2)], sort: 'SCORE_DESC' });
      out.push(...explore.slice(0, 8).map((m) => wrap(m, true)));
    }
    if (out.length >= 30) break;
  }
  const seen = new Set<string>();
  return out
    .filter((c) => c.meta && !knownIds.has(c.meta.anilistId) && !seen.has(c.id) && seen.add(c.id))
    .sort((a, b) => b.fit - a.fit)
    .slice(0, 26);
}

// ───────────────────────── الرد ─────────────────────────

export const ANSWER_PROMPT = `أنت «رفيق» داخل تطبيق VANTARA: صاحب أوتاكو سعودي من جيل Z، متابع أنمي ومانجا ومانهوا من زمان وشايف كل شي تقريبًا، ومتحمّس لأي شي حلو.
أسلوبك: عامية سعودية/خليجية شبابية ("والله"، "يا رجل"، "لا يفوتك"، "صدقني"، "بطل"، "مرّه"، "خلاص تبيها؟")، جمل قصيرة، طاقة وحماس حقيقي، إيموجيات بذوق (🔥😭💀✨👀🫡🤝) — اثنين ثلاثة في الرد، مو في كل كلمة. تكلّم كأنك تعرف العمل وعشته، وكأنك تعرف ذوق صاحبك من سجله. لا فصحى رسمية ولا "بالتأكيد!" ولا نبرة موظف خدمة عملاء.
الحماس ما يعني الكذب: كل معلومة عن عمل (عدد، تقييم، حالة، قصة) من البيانات المرسلة فقط؛ وإذا ما تعرف شي قلها بأسلوبك ("ما عندي رقم أكيد لعدد فصولها صراحة").

قواعد صارمة:
1. لا تقترح أي عمل خارج قائمة candidates. كل بطاقة معرّفها (id) من القائمة حرفيًّا.
2. لا تخترع معلومة: التقييم، عدد الحلقات/الفصول، الحالة، التوفر، الشخصيات، الأحداث — فقط ما في البيانات المرسلة. إن نقصت معلومة قل إنك لا تعرفها.
3. لا حرق: لا تذكر أحداثًا بعد بداية العمل. للأعمال التي بدأها المستخدم لا تتجاوز ما وصل إليه (progress).
4. السبب شخصي حقًّا: اربطه بملف الذوق (أعمال أكملها أو تركها بالاسم، أنواع يكملها، طول يناسبه) وبطلبه الحالي. ممنوع «لأنه مشهور ورائع» وحده.
5. الطلب الحالي فوق الذوق العام (مزاج اليوم يغلب). طلب مانجا = مانجا فقط، وطلب أنمي = أنمي فقط.
6. 2 إلى 4 بطاقات عادةً. بطاقة استكشاف واحدة كحد أقصى (exploration: true) واشرح لماذا تستحق رغم اختلافها.
7. إن كان الطلب سؤالًا أو شرحًا لا يحتاج اقتراحات: cards فارغة. وإن كان كلامًا عامًّا («هلا»، «شف الحين»، «؟؟») فرد بخفة واقترح عملين من القائمة يناسبون ذوقه.
8. إن لم تجد في القائمة ما يناسب فعلًا، قلها بصراحة واقترح تعديل الطلب. لا تذكر أبدًا كلمات داخلية مثل candidates أو «القائمة المرسلة» أو «النظام»: تكلّم كأنك تعرف الأعمال بنفسك.
9. لكل بطاقة summary: نبذة عربية بسطر أو سطرين من synopsis المرسلة فقط، بلا حرق وبنفس أسلوبك.
10. arabic_until وenglish_until = آخر فصل عربي وآخر فصل إنجليزي في مصادرنا. إن كان الإنجليزي أبعد، قلها بالأرقام («العربي واقف عند 22 والإنجليزي واصل 72») واقترح translate: {"from": أول فصل بعد العربي, "to": آخر إنجليزي} — نظام VANTARA هو اللي يترجم مقدمًا، أنت تحدد النطاق. إن كانت null فلا تخترع أرقامًا ولا translate.

أرجع JSON فقط بهذا الترتيب:
{"message": "ردك بأسلوبك (سطران إلى أربعة، بلا قوائم طويلة)", "cards": [{"id": "…", "reason": "سبب شخصي بجملة أو جملتين بنفس الأسلوب", "summary": "نبذة عربية قصيرة", "exploration": false, "translate": null}], "chips": ["اقتراحان أو ثلاثة لرسالته التالية، قصيرة وبنفس اللهجة"]}`;

interface AnswerOut {
  message?: string;
  cards?: Array<{ id?: string; reason?: string; exploration?: boolean; summary?: string; translate?: { from?: unknown; to?: unknown } | null }>;
  chips?: string[];
}

export interface Card {
  recId: string;
  workId: string;
  kind: 'anime' | 'manga';
  title: string;
  titles: string[];
  cover: string | null;
  banner: string | null;
  color: string | null;
  genres: string[];
  score: number | null;
  count: number | null;
  status: string | null;
  format: string | null;
  synopsis: string | null;
  reason: string;
  exploration: boolean;
  progress: string | null;
  ref: string | null;
  /** نبذة عربية قصيرة بلا حرق (من النموذج، مبنية على النبذة المرسلة). */
  summary: string | null;
  span: { ar: number; en: number } | null;
  /** نطاق يُقترح ترجمته مقدمًا بنظامنا (بعد التحقق والحصة). */
  translate: { from: number; to: number } | null;
}

function compactCandidate(c: Candidate) {
  const m = c.meta;
  return {
    id: c.id,
    title: c.title,
    type: c.kind,
    format: m?.format ?? null,
    genres: m?.genres ?? [],
    themes: m?.tags.slice(0, 8) ?? [],
    length: m ? (c.kind === 'anime' ? (m.episodes ? `${m.episodes} حلقة` : null) : m.chapters ? `${m.chapters} فصل` : null) : null,
    status: m?.status ?? null,
    score: m?.score ?? null,
    popularity: m?.popularity ?? null,
    year: m?.year ?? null,
    origin: m?.country ?? null,
    synopsis: m?.synopsis ?? null,
    relation: c.relation,
    progress: c.own ? progressLabel(c.own) : null,
    exploration_pool: c.exploration,
    arabic_until: c.span ? c.span.ar : null,
    english_until: c.span ? c.span.en : null,
  };
}

function toCard(c: Candidate, reason: string, exploration: boolean, recId: string, summary: string | null = null, translate: { from: number; to: number } | null = null): Card {
  const m = c.meta;
  return {
    recId,
    workId: c.id,
    kind: c.kind,
    title: c.title,
    titles: m?.titles ?? [c.title],
    cover: m?.cover ?? null,
    banner: m?.banner ?? null,
    color: m?.color ?? null,
    genres: m?.genres.slice(0, 4) ?? [],
    score: m?.score ?? null,
    count: m ? (c.kind === 'anime' ? m.episodes : m.chapters) : null,
    status: m?.status ?? null,
    format: m?.format ?? null,
    synopsis: m?.synopsis ?? null,
    reason: reason.slice(0, 360),
    exploration,
    progress: c.own ? progressLabel(c.own) : null,
    ref: c.own?.ref ?? (c.id.startsWith('ext:') ? c.id : null),
    summary: summary ? summary.slice(0, 280) : null,
    span: c.span ? { ar: c.span.ar, en: c.span.en } : null,
    translate,
  };
}

/** ما يُجاب بلا نموذج: أسئلة أرقام من سجلك. */
export function statsAnswer(text: string, works: UserWork[], now: number): string | null {
  const t = text.replace(/[ًٌٍَُِّْ]/g, '');
  const week = now - 7 * 86_400_000;
  if (/كم\s*(فصل|فصول)/.test(t)) {
    const manga = works.filter((w) => w.kind === 'manga');
    const total = manga.reduce((s, w) => s + w.progress, 0);
    const recent = manga.filter((w) => w.lastAt >= week);
    return `قريت ${total} فصل في ${manga.filter((w) => w.progress > 0).length} عمل. هذا الأسبوع رجعت لـ${recent.length} ${recent.length === 1 ? 'عمل' : 'أعمال'}.`;
  }
  if (/كم\s*(حلقة|حلقات)/.test(t)) {
    const anime = works.filter((w) => w.kind === 'anime');
    const total = anime.reduce((s, w) => s + w.progress, 0);
    return total ? `شاهدت ${total} حلقة في ${anime.filter((w) => w.progress > 0).length} أنمي (من سجل هذا الجوال).` : 'ما عندي سجل مشاهدة أنمي على هذا الجوال بعد.';
  }
  return null;
}

// ───────────────────────── الذاكرة ─────────────────────────

async function remember(db: D1Database, userId: string, updates: Intent['preference_updates'], now: number): Promise<void> {
  if (!updates.length) return;
  await db.batch(
    updates.map((p) =>
      db
        .prepare(
          `INSERT INTO rafiq_prefs (id, user_id, kind, key, polarity, source, strength, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'explicit', 1, ?, ?, ?)
           ON CONFLICT (user_id, kind, key) DO UPDATE SET polarity = excluded.polarity, source = 'explicit', note = excluded.note, updated_at = excluded.updated_at`,
        )
        .bind(crypto.randomUUID(), userId, p.kind, p.key, p.polarity, p.note ?? null, now, now),
    ),
  );
}

async function lastCardsOf(db: D1Database, conversationId: string): Promise<Array<{ recId: string; workId: string; title: string }>> {
  const row = await db
    .prepare("SELECT cards_json FROM rafiq_messages WHERE conversation_id = ? AND role = 'assistant' AND cards_json IS NOT NULL ORDER BY created_at DESC LIMIT 1")
    .bind(conversationId)
    .first<{ cards_json: string }>();
  if (!row) return [];
  try {
    return (JSON.parse(row.cards_json) as Card[]).map((c) => ({ recId: c.recId, workId: c.workId, title: c.title }));
  } catch {
    return [];
  }
}

const FEEDBACK_KINDS = new Set(['opened', 'like', 'not_for_me', 'seen', 'more_like', 'less_like']);

async function applyFeedback(db: D1Database, userId: string, recId: string, kind: string, now: number, openedRef: string | null = null): Promise<boolean> {
  if (!FEEDBACK_KINDS.has(kind)) return false;
  if (kind === 'opened') {
    const res = await db
      .prepare('UPDATE rafiq_recs SET opened_at = COALESCE(opened_at, ?), opened_ref = COALESCE(?, opened_ref) WHERE id = ? AND user_id = ?')
      .bind(now, openedRef, recId, userId)
      .run();
    return (res.meta?.changes ?? 1) > 0;
  }
  await db.prepare('UPDATE rafiq_recs SET feedback = ?, feedback_at = ? WHERE id = ? AND user_id = ?').bind(kind, now, recId, userId).run();
  // «أقل من هذا النوع»: أبرز نوع في العمل يصير نفورًا سلوكيًّا خفيفًا (يُرى ويُحذف من الذاكرة)
  if (kind === 'less_like' || kind === 'more_like') {
    const rec = await db.prepare('SELECT work_id FROM rafiq_recs WHERE id = ? AND user_id = ?').bind(recId, userId).first<{ work_id: string }>();
    const meta = rec ? await db.prepare('SELECT data_json FROM rafiq_meta WHERE key = ?').bind(rec.work_id).first<{ data_json: string | null }>() : null;
    const m = meta?.data_json ? (JSON.parse(meta.data_json) as Meta) : null;
    const key = m?.tags[0] ?? m?.genres[0];
    if (key) {
      await db
        .prepare(
          `INSERT INTO rafiq_prefs (id, user_id, kind, key, polarity, source, strength, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'behavioral', 0.5, ?, ?, ?)
           ON CONFLICT (user_id, kind, key) DO UPDATE SET polarity = CASE WHEN rafiq_prefs.source = 'explicit' THEN rafiq_prefs.polarity ELSE excluded.polarity END, updated_at = excluded.updated_at`,
        )
        .bind(crypto.randomUUID(), userId, m?.tags[0] ? 'tag' : 'genre', key, kind === 'less_like' ? -1 : 1, `من ردّك على «${m?.title ?? ''}»`, now, now)
        .run();
    }
  }
  return true;
}

// ───────────────────────── المسارات ─────────────────────────

function suggestions(bundle: ProfileBundle | null): string[] {
  const out = ['وش تنصحني اليوم؟', 'شيء قصير', 'فاجئني'];
  const strong = bundle?.works.find((w) => w.state === 'strong');
  if (strong) out.splice(1, 0, `شيء قريب من ${strong.title}`);
  if (bundle?.works.some((w) => w.state === 'current' || w.state === 'abandoned')) out.push('أكمل شيء تركته');
  return out.slice(0, 5);
}

const parseJson = <T>(s: string | null, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

const present = (m: StoredMessage) => ({
  id: m.id,
  role: m.role,
  content: m.content,
  cards: parseJson<Card[]>(m.cards_json, []),
  chips: parseJson<string[]>(m.chips_json, []),
  at: m.created_at,
});

/** GET /v1/rafiq/state — مفتوح؟ مهيّأ؟ آخر محادثة واقتراحات بداية. */
export async function handleRafiqState(url: URL, env: RafiqEnv, userId: string, now: number): Promise<Response> {
  if (!(await rafiqAllowed(env, userId))) return reply({ enabled: false });
  const id = url.searchParams.get('conversationId');
  const conv = await env.DB.prepare(
    id ? 'SELECT id FROM rafiq_conversations WHERE id = ? AND user_id = ?' : 'SELECT id FROM rafiq_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1',
  )
    .bind(...(id ? [id, userId] : [userId]))
    .first<{ id: string }>();
  const messages = conv ? await recentMessages(env.DB, conv.id, 40) : [];
  const cached = await env.DB.prepare('SELECT data_json FROM rafiq_profile WHERE user_id = ?').bind(userId).first<{ data_json: string }>();
  const profile = cached ? parseJson<TasteProfile | null>(cached.data_json, null) : null;
  const starter = ['وش تنصحني اليوم؟', 'شيء قصير', 'فاجئني', 'أكمل شيء تركته'];
  if (profile?.strongPositiveWorks[0]) starter.splice(1, 0, `شيء قريب من ${profile.strongPositiveWorks[0]}`);
  return reply({
    enabled: true,
    configured: Boolean(env.DEEPSEEK_API_KEY),
    conversationId: conv?.id ?? null,
    messages: messages.map(present),
    suggestions: starter.slice(0, 5),
    now,
  });
}

/** POST /v1/rafiq/feedback — {recId, kind, openedRef?} */
export async function handleRafiqFeedback(request: Request, env: RafiqEnv, userId: string, now: number): Promise<Response> {
  if (!(await rafiqAllowed(env, userId))) return reply({ error: 'rafiq_locked' }, 403);
  const body = (await request.json().catch(() => null)) as { recId?: unknown; kind?: unknown; openedRef?: unknown } | null;
  if (typeof body?.recId !== 'string' || typeof body.kind !== 'string') return reply({ error: 'bad_request' }, 400);
  const ok = await applyFeedback(env.DB, userId, body.recId, body.kind, now, typeof body.openedRef === 'string' ? body.openedRef.slice(0, 200) : null);
  return reply({ ok });
}

/** GET /v1/rafiq/prefs و DELETE /v1/rafiq/prefs?id= — «ذاكرة رفيق» تُرى وتُصحَّح. */
export async function handleRafiqPrefs(request: Request, url: URL, env: RafiqEnv, userId: string): Promise<Response> {
  if (!(await rafiqAllowed(env, userId))) return reply({ error: 'rafiq_locked' }, 403);
  if (request.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return reply({ error: 'bad_request' }, 400);
    await env.DB.prepare('DELETE FROM rafiq_prefs WHERE id = ? AND user_id = ?').bind(id, userId).run();
    return reply({ ok: true });
  }
  const prefs = await preferences(env.DB, userId);
  const cached = await env.DB.prepare('SELECT data_json FROM rafiq_profile WHERE user_id = ?').bind(userId).first<{ data_json: string }>();
  return reply({ prefs, profile: cached ? parseJson(cached.data_json, null) : null });
}

/**
 * GET /v1/rafiq/conversations — سجل المحادثات: عنوان كل واحدة أول ما كتبته فيها،
 * الأحدث أولًا، والفارغة لا تظهر. DELETE ?id= يحذف محادثة برسائلها (الذاكرة تبقى).
 */
export async function handleRafiqConversations(request: Request, url: URL, env: RafiqEnv, userId: string): Promise<Response> {
  if (!(await rafiqAllowed(env, userId))) return reply({ error: 'rafiq_locked' }, 403);
  if (request.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return reply({ error: 'bad_request' }, 400);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM rafiq_messages WHERE conversation_id = ? AND user_id = ?').bind(id, userId),
      env.DB.prepare('DELETE FROM rafiq_conversations WHERE id = ? AND user_id = ?').bind(id, userId),
    ]);
    return reply({ ok: true });
  }
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.updated_at,
            (SELECT content FROM rafiq_messages m WHERE m.conversation_id = c.id AND m.role = 'user' ORDER BY m.created_at ASC LIMIT 1) AS first,
            (SELECT COUNT(*) FROM rafiq_messages m WHERE m.conversation_id = c.id) AS n
       FROM rafiq_conversations c
      WHERE c.user_id = ?
      ORDER BY c.updated_at DESC
      LIMIT 60`,
  )
    .bind(userId)
    .all<{ id: string; updated_at: number; first: string | null; n: number }>();
  return reply({
    conversations: results.filter((r) => r.n > 0).map((r) => ({ id: r.id, title: (r.first ?? 'محادثة').slice(0, 70), messages: r.n, at: r.updated_at })),
  });
}

/** POST /v1/rafiq/new — محادثة جديدة (الذاكرة تبقى). */
export async function handleRafiqNew(env: RafiqEnv, userId: string, now: number): Promise<Response> {
  if (!(await rafiqAllowed(env, userId))) return reply({ error: 'rafiq_locked' }, 403);
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO rafiq_conversations (id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?)').bind(id, userId, now, now).run();
  return reply({ conversationId: id });
}

interface MessageBody {
  conversationId?: unknown;
  clientId?: unknown;
  text?: unknown;
  action?: unknown;
  local?: { anime?: unknown; gaps?: unknown };
  /** ردود AniList جابها الجهاز (الخادم محجوب عنه): `[{key, data}]`، و`key` نص الطلب نفسه. */
  anilist?: unknown;
  intent?: unknown;
  round?: unknown;
}

/**
 * AniList يحجب طلبات Cloudflare Workers (403). فالكتالوج يمرّ بالجهاز: ما عرفناه من
 * ردود الجهاز يُخدم منها، وما لا نعرفه نجرّبه مباشرة، فإن حُجب يُسجَّل ويطلبه الجهاز
 * ويرجع به في جولة ثانية. نفس الكود يعمل لو فُكّ الحجب يومًا.
 */
function relayFetch(direct: Fetch, raw: unknown): { fetch: Fetch; pending: Set<string> } {
  const known = new Map<string, unknown>();
  if (Array.isArray(raw)) {
    for (const r of raw.slice(0, 40)) {
      const x = r as { key?: unknown; data?: unknown };
      if (typeof x?.key === 'string' && x.key.length < 20_000 && x.data && typeof x.data === 'object') known.set(x.key, x.data);
    }
  }
  const pending = new Set<string>();
  const relay = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(ANILIST)) return direct(input, init);
    const key = typeof init?.body === 'string' ? init.body : '';
    if (known.has(key)) return new Response(JSON.stringify({ data: known.get(key) }), { status: 200, headers: { 'content-type': 'application/json' } });
    try {
      const res = await direct(input, init);
      if (res.ok) return res;
    } catch {
      // محجوب أو شبكة: للجهاز
    }
    if (key) pending.add(key);
    return new Response('{}', { status: 503 });
  }) as Fetch;
  return { fetch: relay, pending };
}

/**
 * POST /v1/rafiq/message — بث SSE: `meta` ثم `delta` (نص الرد وهو يُكتب) ثم `final`
 * (الرسالة مع البطاقات بعد التحقق)، أو `error`. إعادة الإرسال بنفس `clientId` لا
 * تكرر الرسالة؛ وإن كان الرد محفوظًا يرجع كما هو بلا نداء.
 */
export async function handleRafiqMessage(
  request: Request,
  env: RafiqEnv,
  userId: string,
  now: number,
  fetchImpl: Fetch = fetch,
  waitUntil: (p: Promise<unknown>) => void = () => {},
): Promise<Response> {
  if (!(await rafiqAllowed(env, userId))) return reply({ error: 'rafiq_locked' }, 403);
  if (!env.DEEPSEEK_API_KEY) return reply({ error: 'rafiq_not_configured' }, 503);
  const body = (await request.json().catch(() => null)) as MessageBody | null;
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, MAX_TEXT) : '';
  const clientId = typeof body?.clientId === 'string' && /^[\w-]{8,64}$/.test(body.clientId) ? body.clientId : null;
  const action = (body?.action ?? null) as { type?: string; workId?: string; title?: string } | null;
  if ((!text && !action) || !clientId) return reply({ error: 'bad_request' }, 400);
  const local = body?.local && Array.isArray(body.local.anime) ? cleanLocal(body.local.anime) : null;
  const gaps = cleanGaps((body?.local as { gaps?: unknown } | undefined)?.gaps);
  const round = Math.max(0, Math.min(3, Math.floor(Number(body?.round) || 0)));
  const catalog = relayFetch(fetchImpl, body?.anilist);
  const net = catalog.fetch;

  const db = env.DB;
  const conv = await conversationOf(db, userId, typeof body?.conversationId === 'string' ? body.conversationId : null, now);
  const existing = await db.prepare('SELECT id FROM rafiq_messages WHERE id = ? AND user_id = ?').bind(clientId, userId).first<{ id: string }>();
  const stored = existing
    ? await db.prepare("SELECT id, role, content, cards_json, chips_json, created_at FROM rafiq_messages WHERE reply_to = ? AND role = 'assistant'").bind(clientId).first<StoredMessage>()
    : null;
  if (!existing) {
    const shown = text || (action?.type === 'similar' ? `شيء مشابه لـ ${action.title ?? 'هذا'}` : 'أعطني غيرها');
    await db
      .prepare("INSERT INTO rafiq_messages (id, conversation_id, user_id, role, content, created_at) VALUES (?, ?, ?, 'user', ?, ?)")
      .bind(clientId, conv.id, userId, shown, now)
      .run();
    await db.prepare('UPDATE rafiq_conversations SET updated_at = ? WHERE id = ?').bind(now, conv.id).run();
  }

  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const enc = new TextEncoder();
  const send = (event: string, data: unknown) => writer.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

  const work = (async () => {
    try {
      await send('meta', { conversationId: conv.id, messageId: clientId });
      if (stored) {
        await send('final', { message: present(stored) });
        return;
      }
      const bundle = await profileFor(env, net, userId, local, now);
      const history = await recentMessages(db, conv.id, RECENT_MESSAGES + 1);
      const prior = history.filter((m) => m.id !== clientId).slice(-RECENT_MESSAGES);

      // أرقام من السجل: بلا نموذج
      const quick = text ? statsAnswer(text, bundle.works, now) : null;
      if (quick) {
        const msg = await saveAssistant(db, userId, conv.id, clientId, quick, [], [], now);
        await send('delta', { text: quick });
        await send('final', { message: msg });
        return;
      }

      const lastCards = await lastCardsOf(db, conv.id);
      let intent: Intent;
      const carried = round > 0 && body?.intent ? cleanIntent(body.intent) : null;
      if (carried) {
        // جولة ثانية بعد ما جاب الجهاز الكتالوج: نفس الفهم بلا نداء جديد، والذاكرة سُجّلت في الأولى
        intent = { ...carried, preference_updates: [], feedback: [] };
      } else if (action?.type === 'similar' && action.title) {
        intent = { ...INTENT_DEFAULT, intent: 'similar', reference: String(action.title).slice(0, 200), format: action.workId?.startsWith('anime:') ? 'ANIME' : action.workId?.startsWith('manga:') ? 'MANGA' : 'ANY' };
      } else if (action?.type === 'more') {
        intent = { ...INTENT_DEFAULT };
      } else {
        const raw = await chatJson<unknown>(
          db,
          env,
          fetchImpl,
          [
            { role: 'system', content: INTENT_PROMPT },
            {
              role: 'user',
              content: JSON.stringify({
                conversation_summary: conv.summary,
                recent: prior.slice(-6).map((m) => ({ role: m.role, text: m.content.slice(0, 400) })),
                last_suggested: lastCards.map((c) => c.title),
                message: text,
              }),
            },
          ],
          now,
        );
        intent = cleanIntent(raw);
      }
      await remember(db, userId, intent.preference_updates, now);
      for (const f of intent.feedback) {
        const target = f.target === 'last' ? lastCards : lastCards.filter((c) => c.title.toLowerCase().includes(f.target.toLowerCase()));
        for (const c of target) await applyFeedback(db, userId, c.recId, f.kind, now);
      }
      // تفضيل جديد أو رأي: الملف يُعاد بمعطياته الجديدة
      const fresh = intent.preference_updates.length || intent.feedback.length ? await profileFor(env, net, userId, local, now) : bundle;

      let pool: Candidate[] = [];
      if (intent.intent === 'explain') {
        const metas = await metaFor(db, net, lastCards.map((c) => { const n = Number(c.workId.split(':')[1]); return Number.isInteger(n) ? { key: c.workId, anilistId: n } : { key: c.workId }; }), now);
        pool = lastCards
          .map((c) => ({ c, m: metas.get(c.workId) ?? null }))
          .map(({ c, m }) => ({ id: c.workId, kind: c.workId.startsWith('anime:') ? 'anime' : 'manga', meta: m, title: c.title, own: null, relation: null, exploration: false, fit: 0 }) as Candidate);
      } else if (!(intent.intent === 'feedback' && !/(غير|ثاني|بدل|عطني|أعطني|اقترح)/.test(text))) {
        // ما عُرض في الأسبوعين الماضيين لا يتكرر (إلا إن سأل عنه بالاسم)
        const { results: shown } = await db
          .prepare('SELECT DISTINCT work_id FROM rafiq_recs WHERE user_id = ? AND shown_at > ?')
          .bind(userId, now - 14 * 86_400_000)
          .all<{ work_id: string }>();
        pool = await gatherCandidates(db, net, intent, fresh, [...lastCards.map((c) => c.workId), ...shown.map((r) => r.work_id)], gaps, now);
        // أي مرشّح مانجا نعرف فصوله على الجهاز: يعرف النموذج وين وصل العربي والإنجليزي
        for (const c of pool) {
          if (c.span || c.kind !== 'manga') continue;
          c.span = gaps.find((g) => g.ref === c.id || titleMatches(g.title, c.meta?.titles ?? [c.title])) ?? null;
        }
      }
      // الكتالوج ما وصلنا مباشرة: الجهاز يجيبه ويرجع (ثلاث جولات بالكثير)
      if (catalog.pending.size && round < 3) {
        await send('need', { requests: [...catalog.pending].slice(0, 30), intent, round: round + 1 });
        return;
      }
      // المعرّفات المرشّحة تُحفظ مع بياناتها: «ليش؟» و«أقل من هذا» تعرفها لاحقًا
      await cacheMeta(db, pool, now);
      // لا مرشّحين لطلب يحتاجهم: لا نسأل النموذج عن فراغ (كان يقول «ما عندي candidates»)
      if (!pool.length && ['recommend', 'similar', 'lookup', 'resume', 'chat'].includes(intent.intent)) {
        const none =
          intent.intent === 'resume'
            ? 'دوّرت في اللي بديته وما لقيت شي واقف عليه 👀 تبي أرشّح لك شي جديد؟'
            : 'ما قدرت أوصل لكتالوج الأعمال الحين 😵 جرّب بعد شوي، أو قول لي اسم عمل تحبه وأطلع لك شي يشبهه.';
        const msg = await saveAssistant(db, userId, conv.id, clientId, none, [], ['رشّح لي شي', 'أكمل شي تركته'], now);
        await send('delta', { text: none });
        await send('final', { message: msg });
        return;
      }

      const payload = {
        request: text || (action?.type === 'similar' ? `شيء مشابه لـ ${action.title}` : 'أعطني اقتراحات أخرى'),
        understood: { intent: intent.intent, format: intent.format, length: intent.length, mood: intent.mood, genres: intent.genres_in, themes: intent.tags_in, avoid: [...intent.genres_out, ...intent.tags_out] },
        taste_profile: fresh.profile,
        candidates: pool.map(compactCandidate),
        conversation_summary: conv.summary,
        recent: prior.slice(-6).map((m) => ({ role: m.role, text: m.content.slice(0, 500) })),
      };
      const messages: ChatMessage[] = [
        { role: 'system', content: ANSWER_PROMPT },
        { role: 'user', content: JSON.stringify(payload) },
      ];
      let lastSent = '';
      const out = await chatStream<AnswerOut>(db, env, fetchImpl, messages, now, (t) => {
        const add = t.slice(lastSent.length);
        lastSent = t;
        if (add) void send('delta', { text: add });
      });
      const byId = new Map(pool.map((c) => [c.id, c]));
      // الترجمة المسبقة لمن فُتحت له الترجمة، وبقدر ما بقي من حصة الأسبوع
      let chaptersLeft = 0;
      if (pool.some((c) => c.span && c.span.en > c.span.ar) && (await translationAllowed(env as unknown as TranslationEnv, userId))) {
        const q = await quotaState(env as unknown as TranslationEnv, userId, now);
        chaptersLeft = Math.max(0, q.chapterLimit - q.chapters);
      }
      const rangeOf = (cand: Candidate, asked: { from?: unknown; to?: unknown } | null | undefined): { from: number; to: number } | null => {
        const sp = cand.span;
        if (!sp || sp.en <= sp.ar || chaptersLeft <= 0 || !asked) return null;
        let from = Number(asked.from);
        let to = Number(asked.to);
        // النموذج يحدد، والخادم يصحّح: لا قبل العربي ولا بعد الإنجليزي ولا فوق الحصة
        if (!Number.isFinite(from) || from <= sp.ar || from > sp.en) from = Math.floor(sp.ar) + 1;
        if (!Number.isFinite(to) || to > sp.en || to < from) to = Math.floor(sp.en);
        to = Math.min(to, from + chaptersLeft - 1);
        return to >= from ? { from, to } : null;
      };
      const seen = new Set<string>();
      const cards: Card[] = [];
      for (const c of out.cards ?? []) {
        const cand = typeof c?.id === 'string' ? byId.get(c.id) : undefined;
        // معرّف ليس من المرشّحين = عمل مخترع: يُحذف بصمت
        if (!cand || seen.has(cand.id) || cards.length >= 4) continue;
        // طلبت مانجا = مانجا: لا بطاقة أنمي ولو رشّحها النموذج (والعكس)
        if (intent.format !== 'ANY' && cand.kind !== intent.format.toLowerCase()) continue;
        seen.add(cand.id);
        cards.push(
          toCard(cand, typeof c.reason === 'string' ? c.reason : '', Boolean(c.exploration) && cand.exploration, crypto.randomUUID(), typeof c.summary === 'string' && c.summary.trim() ? c.summary.trim() : null, rangeOf(cand, c.translate)),
        );
      }
      const message = typeof out.message === 'string' && out.message.trim() ? out.message.trim().slice(0, 1600) : 'والله دوّرت وما لقيت شي يستاهل بهالشروط 😭 غيّر الطلب شوي وأبشر.';
      const chips = Array.isArray(out.chips) ? out.chips.filter((x) => typeof x === 'string' && x.trim() && !/candidate|النظام|القائمة/i.test(x)).map((x) => x.trim().slice(0, 40)).slice(0, 3) : [];
      const msg = await saveAssistant(db, userId, conv.id, clientId, message, cards, chips, now);
      if (message !== lastSent) await send('delta', { text: message.slice(lastSent.length), replace: !message.startsWith(lastSent) ? message : undefined });
      await send('final', { message: msg });
      waitUntil(summarize(db, env, fetchImpl, conv.id, now).catch(() => {}));
    } catch (error) {
      const code = error instanceof LlmError ? error.code : 'internal';
      await send('error', { code });
    } finally {
      await writer.close().catch(() => {});
    }
  })();
  waitUntil(work);
  return new Response(stream.readable, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' },
  });
}

async function cacheMeta(db: D1Database, pool: Candidate[], now: number) {
  const rows = pool.filter((c) => c.meta && (c.id.startsWith('anime:') || c.id.startsWith('manga:')));
  if (!rows.length) return;
  await db.batch(
    rows.map((c) =>
      db
        .prepare('INSERT INTO rafiq_meta (key, anilist_id, data_json, fetched_at) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET data_json = excluded.data_json, fetched_at = excluded.fetched_at')
        .bind(c.id.startsWith('anime:') ? metaKeyForAnime(c.meta!.anilistId) : metaKeyForManga(c.meta!.anilistId), c.meta!.anilistId, JSON.stringify(c.meta), now),
    ),
  );
}

async function saveAssistant(db: D1Database, userId: string, conversationId: string, replyTo: string, content: string, cards: Card[], chips: string[], now: number) {
  const id = crypto.randomUUID();
  const at = now + 1;
  await db.batch([
    db
      .prepare("INSERT INTO rafiq_messages (id, conversation_id, user_id, role, content, cards_json, chips_json, reply_to, created_at) VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?, ?)")
      .bind(id, conversationId, userId, content, cards.length ? JSON.stringify(cards) : null, chips.length ? JSON.stringify(chips) : null, replyTo, at),
    ...cards.map((c) =>
      db.prepare('INSERT INTO rafiq_recs (id, user_id, message_id, work_id, title, reason, shown_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(c.recId, userId, id, c.workId, c.title, c.reason, at),
    ),
    db.prepare('UPDATE rafiq_conversations SET updated_at = ? WHERE id = ?').bind(at, conversationId),
  ]);
  return { id, role: 'assistant' as const, content, cards, chips, at };
}

/** بعد كل 12 رسالة: ما قبل آخر 8 يُلخَّص (ما قاله عن ذوقه، ما رُشّح وردّه). */
async function summarize(db: D1Database, env: RafiqEnv, fetchImpl: Fetch, conversationId: string, now: number) {
  const conv = await db.prepare('SELECT summary, summarized FROM rafiq_conversations WHERE id = ?').bind(conversationId).first<{ summary: string | null; summarized: number }>();
  const { results } = await db.prepare('SELECT role, content, created_at FROM rafiq_messages WHERE conversation_id = ? ORDER BY created_at ASC').bind(conversationId).all<{ role: string; content: string; created_at: number }>();
  const upto = results.length - RECENT_MESSAGES;
  if (!conv || upto - conv.summarized < 12) return;
  const slice = results.slice(conv.summarized, upto);
  const out = await chatJson<{ summary?: string }>(
    db,
    env,
    fetchImpl,
    [
      { role: 'system', content: 'لخّص هذه المحادثة بين مستخدم و«رفيق» (مساعد توصيات أنمي ومانجا) في 4 أسطر عربية كحد أقصى: ما طلبه، ما رُشّح له وكيف ردّ، وأي تفضيل قاله. أرجع JSON: {"summary": "…"}' },
      { role: 'user', content: JSON.stringify({ previous_summary: conv.summary, messages: slice.map((m) => ({ role: m.role, text: m.content.slice(0, 400) })) }) },
    ],
    now,
    400,
  );
  if (typeof out.summary === 'string') {
    await db.prepare('UPDATE rafiq_conversations SET summary = ?, summarized = ? WHERE id = ?').bind(out.summary.slice(0, 1200), upto, conversationId).run();
  }
}

export { suggestions };
