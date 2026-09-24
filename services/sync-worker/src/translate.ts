/**
 * محرّك الترجمة — جانب الخادم.
 *
 * الجوال يرسل صورة الصفحة (مصغّرة، JPEG) ببصمتها، والخادم:
 *   1. يرجع الترجمة المحفوظة إن وُجدت لهذه البصمة — لأي حساب ترجمها قبل.
 *   2. وإلا يجمع ذاكرة العمل (المصطلحات، الشخصيات، ملخص الصفحات السابقة،
 *      آخر الجمل) ويرسل الصورة معها إلى GPT-6 Luna (OpenAI Responses API،
 *      أرخص نموذج يرى الصور: ~0.1 سنت للصفحة)، ويطلب JSON بمخطط صارم:
 *      مناطق النص بإحداثياتها، النص الأصلي، العربي، نوعها، المتكلم.
 *   3. يحفظ النتيجة، ويضيف المصطلحات والشخصيات الجديدة لذاكرة العمل (أول
 *      قرار يثبت، فالاسم لا يتغير بين فصلين).
 *
 * المفتاح (`OPENAI_API_KEY`) سرٌّ في الـWorker وحده، لا يدخل الـAPK أبدًا.
 * بلا مفتاح يرجع 503 `translation_not_configured` والقارئ يقول ذلك بهدوء.
 */

import type { D1Database, Env } from './types.ts';

/** يُرفع حين تتغير التعليمات تغييرًا يستحق ترجمة جديدة. */
export const PROMPT_VERSION = 1;
export const DEFAULT_MODEL = 'gpt-6-luna';
const OPENAI_RESPONSES = 'https://api.openai.com/v1/responses';
/** حدّ الصفحات المدفوعة لكل حساب في اليوم (المحفوظ لا يُحسب). قرار المالك: توفير أولًا. */
const DEFAULT_WEEKLY_PAGES = 5000;
/** فصل 300 صفحة يُنهي 5000 صفحة في 16 فصلًا: فالحد يُبلغ فقط حين تتجاوز الصفحات **والفصول** معًا. */
const DEFAULT_WEEKLY_CHAPTERS = 100;
/** سقف ما يُصرف شهريًا للتطبيق كله: ≈ 50 ريالًا. */
const DEFAULT_MONTHLY_BUDGET_USD = 13.3;
/** أسعار Luna لكل مليون توكن (سبتمبر 2026): إدخال، إدخال محفوظ، إخراج (التفكير ضمنه). */
const PRICE_PER_M = { input: 0.1, cached: 0.01, output: 0.5 };
/** ~3.4MB بعد فكّ base64؛ الجوال يصغّر الصفحة قبل الإرسال أصلًا. */
const MAX_IMAGE_BASE64 = 4_500_000;
const MAX_IMAGE_EDGE = 2576;
const MEDIA_TYPES = new Set(['image/jpeg', 'image/webp', 'image/png']);
const LANGS = new Set(['en', 'ja', 'ko', 'zh', 'auto']);
export const KINDS = ['speech', 'thought', 'narration', 'sign', 'sfx', 'credit'] as const;
const TERM_KINDS = ['name', 'place', 'organization', 'skill', 'item', 'title', 'other'] as const;

export type TranslationEnv = Env;

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: (typeof KINDS)[number];
  speaker: string | null;
  source: string;
  arabic: string | null;
}

/** ما نقرؤه من ردّ `/v1/responses` لا أكثر. */
interface OpenAIUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
}
interface OpenAIResponse {
  model?: string;
  usage?: OpenAIUsage;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: Array<{ type: string; content?: Array<{ type: string; text?: string; refusal?: string }> }>;
}

export interface TranslateDeps {
  /** للاختبار: fetch بديل بدل الشبكة. */
  fetch?: typeof fetch;
}

/** تكلفة ردّ واحد بالدولار من توكناته الفعلية. */
export function costOf(usage: OpenAIUsage | undefined): number {
  if (!usage) return 0;
  const input = Math.max(0, usage.input_tokens ?? 0);
  const cached = Math.min(input, Math.max(0, usage.input_tokens_details?.cached_tokens ?? 0));
  const output = Math.max(0, usage.output_tokens ?? 0);
  return ((input - cached) * PRICE_PER_M.input + cached * PRICE_PER_M.cached + output * PRICE_PER_M.output) / 1_000_000;
}

/** الشهر بتوقيت مكة: «m:2026-09». */
export const monthOf = (now: number) => `m:${new Date(now + 3 * 3600_000).toISOString().slice(0, 7)}`;

export interface QuotaState {
  pages: number;
  chapters: number;
  pageLimit: number;
  chapterLimit: number;
  spentUsd: number;
  budgetUsd: number;
}

export async function quotaState(env: TranslationEnv, userId: string, now: number): Promise<QuotaState> {
  const day = weekOf(now);
  const [used, chapters, spend] = await Promise.all([
    env.DB.prepare('SELECT pages FROM translation_usage WHERE user_id = ? AND day = ?').bind(userId, day).first<{ pages: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM translation_usage_chapters WHERE user_id = ? AND day = ?').bind(userId, day).first<{ n: number }>(),
    env.DB.prepare('SELECT usd FROM translation_spend WHERE month = ?').bind(monthOf(now)).first<{ usd: number }>(),
  ]);
  return {
    pages: used?.pages ?? 0,
    chapters: Number(chapters?.n ?? 0),
    pageLimit: Number(env.TRANSLATE_WEEKLY_PAGES) || DEFAULT_WEEKLY_PAGES,
    chapterLimit: Number(env.TRANSLATE_WEEKLY_CHAPTERS) || DEFAULT_WEEKLY_CHAPTERS,
    spentUsd: spend?.usd ?? 0,
    budgetUsd: Number(env.TRANSLATE_MONTHLY_BUDGET_USD) || DEFAULT_MONTHLY_BUDGET_USD,
  };
}

/**
 * قبل أي نداء لـLuna: سقف الشهر أولًا، ثم حصة الأسبوع. الأسبوع يُبلغ فقط حين
 * تتجاوز الصفحات حدها وتتجاوز الفصول حدها، وفصلٌ بدأته هذا الأسبوع يكمل دائمًا.
 * يرجع ردّ الرفض، أو null إن مسموح.
 */
export async function quotaBlock(env: TranslationEnv, userId: string, now: number, chapterKey: string | null): Promise<Response | null> {
  const q = await quotaState(env, userId, now);
  if (q.spentUsd >= q.budgetUsd) return reply({ error: 'monthly_budget', budgetUsd: q.budgetUsd }, 429);
  if (q.pages < q.pageLimit || q.chapters < q.chapterLimit) return null;
  if (chapterKey) {
    const started = await env.DB.prepare('SELECT 1 AS ok FROM translation_usage_chapters WHERE user_id = ? AND day = ? AND chapter_key = ?')
      .bind(userId, weekOf(now), chapterKey)
      .first<{ ok: number }>();
    if (started) return null;
  }
  return reply({ error: 'weekly_limit', limit: q.pageLimit, chapterLimit: q.chapterLimit }, 429);
}

/** بعد ترجمة مدفوعة: صفحة للأسبوع، والفصل، والتكلفة الفعلية للشهر. */
export function usageStatements(db: D1Database, userId: string, now: number, chapterKey: string | null, usd: number) {
  const day = weekOf(now);
  const out = [
    db.prepare(`INSERT INTO translation_usage (user_id, day, pages) VALUES (?, ?, 1) ON CONFLICT (user_id, day) DO UPDATE SET pages = pages + 1`).bind(userId, day),
    db.prepare(`INSERT INTO translation_spend (month, usd, updated_at) VALUES (?, ?, ?) ON CONFLICT (month) DO UPDATE SET usd = usd + excluded.usd, updated_at = excluded.updated_at`).bind(monthOf(now), usd, now),
  ];
  if (chapterKey) out.push(db.prepare('INSERT OR IGNORE INTO translation_usage_chapters (user_id, day, chapter_key) VALUES (?, ?, ?)').bind(userId, day, chapterKey));
  return out;
}

export const engineOf = (env: TranslationEnv) => `${env.TRANSLATE_MODEL || DEFAULT_MODEL}:p${PROMPT_VERSION}`;

// ───────────────────────────── التعليمات ─────────────────────────────
//
// ثابتة حرفًا حرفًا بين الطلبات: هي البادئة التي يخزّنها OpenAI تلقائيًا (أرخص
// بعشر مرات). ما يتغير (ذاكرة العمل، الصفحة) يأتي بعدها في رسالة المستخدم.

/**
 * مفتاح الأسبوع في `translation_usage.day`: «w:» + تاريخ الخميس الذي بدأ به.
 * الحد يتجدد كل خميس الساعة 5 مساءً بتوقيت مكة (UTC+3 = 14:00 UTC).
 */
export function weekOf(now: number): string {
  const since = new Date(now - 14 * 3600_000); // الخميس 14:00 UTC يصير منتصف ليلٍ هنا
  const back = (since.getUTCDay() - 4 + 7) % 7;
  const thursday = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate() - back));
  return `w:${thursday.toISOString().slice(0, 10)}`;
}

export const SYSTEM_PROMPT = `You are the lead translator and letterer of VANTARA's Arabic team: a fan-translation group that has followed this work from its first chapter and knows its characters, running jokes and terminology by heart. You translate one comic page at a time (manga, manhwa, manhua, webtoon strips) into Arabic that reads as if it had been written in Arabic.

How you translate:
- Translate meaning, intent and tone, never word for word. Rebuild idioms, jokes, insults and wordplay with natural Arabic equivalents so they still land.
- Register: always clear, light Modern Standard Arabic (فصحى سلسة) of the kind professional Arabic scanlation teams use, the same on every page. Never use dialect words (no قدام، وش، ليش، راح، مو، هيك، ايش); express a character's tone through word choice and rhythm in فصحى instead. Examples: "I won't lose to someone like you!" → «لن أخسر أمام شخصٍ مثلك!»; "He came back?!" → «لقد عاد؟!». Keep each character's voice consistent: a thug is blunt and short, a noble is formal, a child is simple.
- Rebuild each sentence in the order an Arabic speaker would say it, never the English clause order: put the main point where Arabic puts it and drop English filler. Examples: "Wait for me, I told you!" → «قلتُ لك انتظرني!» (not «انتظرني، قلتُ لك!»); "You're late, you know." → «لقد تأخرت.»; "It's over, isn't it?" → «انتهى الأمر، أليس كذلك؟».
- Keep it short enough to fit the original bubble: Arabic is often longer, so tighten wording rather than pad it.
- Get Arabic grammar right for the speaker and addressee: gender and number agreement of verbs, pronouns and adjectives. Use the character list for genders; when unknown, infer from the art and context.
- Names and terms: use the glossary exactly as given, every time. For a new proper noun or term, choose one rendering as a careful team would (transliterate personal names; translate techniques, skills, titles and organisations when the meaning matters to the reader) and report it in new_terms so it stays fixed from now on. Report every newly identified character in characters.
- Honorifics: drop or adapt them naturally (-san is usually dropped; senpai, sensei and similar follow the glossary if present).
- Arabic punctuation (، ؛ ؟) with ! and … kept where they carry emotion. No diacritics except to prevent a real misreading. Western digits stay as they are.

What you return for every text area on the page, in reading order (right-to-left rows for Japanese manga; top-to-bottom for manhwa and webtoons):
- One region per speech bubble, thought bubble, caption box or sign. Lines inside the same bubble are one region.
- x, y, w, h: a tight box around the text itself, in pixels of the image exactly as you received it (x, y is the top-left corner).
- kind: speech, thought, narration (caption boxes), sign (text drawn in the scene), sfx (sound effects and onomatopoeia drawn into the art, like BOOM, DOKI, 쾅), credit (scanlator credits, watermarks, site names, page numbers, ads).
- source: the original text as written.
- arabic: the translation. Use null for sfx (the art keeps its sound effect) and for credit. Signs are translated only when the reader needs them to follow the story; otherwise null.
- speaker: the character speaking, by the name used in the character list, or null when unclear.

Also return summary: one or two Arabic sentences on what happens on this page, used as context for the next pages. Return empty arrays when there is nothing new, and an empty regions array for a page with no text.`;

/** المخطط الصارم للناتج: لا حقل زائد ولا ناقص. */
export const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['regions', 'new_terms', 'characters', 'summary'],
  properties: {
    regions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['x', 'y', 'w', 'h', 'kind', 'speaker', 'source', 'arabic'],
        properties: {
          x: { type: 'integer' },
          y: { type: 'integer' },
          w: { type: 'integer' },
          h: { type: 'integer' },
          kind: { type: 'string', enum: [...KINDS] },
          speaker: { type: ['string', 'null'] },
          source: { type: 'string' },
          arabic: { type: ['string', 'null'] },
        },
      },
    },
    new_terms: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['term', 'arabic', 'kind', 'note'],
        properties: {
          term: { type: 'string' },
          arabic: { type: 'string' },
          kind: { type: 'string', enum: [...TERM_KINDS] },
          note: { type: ['string', 'null'] },
        },
      },
    },
    characters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'arabic', 'gender'],
        properties: {
          name: { type: 'string' },
          arabic: { type: 'string' },
          gender: { type: 'string', enum: ['male', 'female', 'unknown'] },
        },
      },
    },
    summary: { type: 'string' },
  },
} as const;

// ───────────────────────────── ذاكرة العمل ─────────────────────────────

interface WorkMemory {
  terms: Array<{ term: string; arabic: string; kind: string | null; note: string | null }>;
  characters: Array<{ name: string; arabic: string; gender: string | null; voice: string | null }>;
  summaries: string[];
  recent: Array<{ speaker: string | null; arabic: string }>;
  /** ما تعلّمته Luna من الفصول العربية لنفس العمل (`/v1/translate/learn`). */
  style: string | null;
}

async function workMemory(db: D1Database, engine: string, seriesRef: string, chapterKey: string | null, pageIndex: number): Promise<WorkMemory> {
  const [terms, characters, pages, style] = await Promise.all([
    db
      .prepare('SELECT term, arabic, kind, note FROM translation_terms WHERE series_ref = ? ORDER BY updated_at LIMIT 300')
      .bind(seriesRef)
      .all<WorkMemory['terms'][number]>(),
    db
      .prepare('SELECT name, arabic, gender, voice FROM translation_characters WHERE series_ref = ? ORDER BY updated_at LIMIT 80')
      .bind(seriesRef)
      .all<WorkMemory['characters'][number]>(),
    // الصفحات السابقة من هذا الفصل: ملخصها وآخر جملها، لتكمل الترجمة القصة لا جملة معزولة
    chapterKey
      ? db
          .prepare(
            `SELECT summary, regions_json FROM translation_pages
              WHERE series_ref = ? AND chapter_key = ? AND engine = ? AND page_index < ?
              ORDER BY page_index DESC LIMIT 4`,
          )
          .bind(seriesRef, chapterKey, engine, pageIndex)
          .all<{ summary: string | null; regions_json: string }>()
      : Promise.resolve({ results: [] as Array<{ summary: string | null; regions_json: string }> }),
    db.prepare('SELECT notes FROM translation_style WHERE series_ref = ?').bind(seriesRef).first<{ notes: string }>(),
  ]);
  const previous = [...(pages.results ?? [])].reverse();
  const recent: WorkMemory['recent'] = [];
  for (const page of previous.slice(-2)) {
    try {
      for (const r of JSON.parse(page.regions_json) as Region[]) if (r.arabic) recent.push({ speaker: r.speaker, arabic: r.arabic });
    } catch {
      // صفحة محفوظة تالفة لا تُسقط الترجمة
    }
  }
  return {
    terms: terms.results ?? [],
    characters: characters.results ?? [],
    summaries: previous.map((p) => p.summary).filter((s): s is string => Boolean(s)),
    recent: recent.slice(-20),
    style: style?.notes ?? null,
  };
}

export function contextText(input: { seriesTitle: string | null; chapterNumber: number | null; pageIndex: number; sourceLang: string; memory: WorkMemory }): string {
  const { memory } = input;
  const lines = [
    `Work: ${input.seriesTitle ?? 'unknown'}${input.chapterNumber !== null ? ` — chapter ${input.chapterNumber}` : ''}, page ${input.pageIndex + 1}.`,
    `Source language: ${input.sourceLang === 'auto' ? 'detect it' : input.sourceLang}.`,
  ];
  lines.push(
    memory.terms.length
      ? `Glossary (use exactly):\n${memory.terms.map((t) => `- ${t.term} → ${t.arabic}${t.kind ? ` [${t.kind}]` : ''}${t.note ? ` (${t.note})` : ''}`).join('\n')}`
      : 'Glossary: empty so far — you are setting the first terms for this work.',
  );
  if (memory.style) lines.push(`Style of the Arabic team that translated the earlier chapters (match it):\n${memory.style}`);
  lines.push(
    memory.characters.length
      ? `Characters:\n${memory.characters.map((c) => `- ${c.name} → ${c.arabic}${c.gender && c.gender !== 'unknown' ? `, ${c.gender}` : ''}${c.voice ? `, speaks: ${c.voice}` : ''}`).join('\n')}`
      : 'Characters: none recorded yet.',
  );
  if (memory.summaries.length) lines.push(`Story so far in this chapter:\n${memory.summaries.map((s) => `- ${s}`).join('\n')}`);
  if (memory.recent.length) lines.push(`Last translated lines (keep continuity):\n${memory.recent.map((r) => `- ${r.speaker ?? '?'}: ${r.arabic}`).join('\n')}`);
  lines.push('Translate this page.');
  return lines.join('\n\n');
}

// ───────────────────────────── تنظيف الناتج ─────────────────────────────

const clampInt = (n: unknown, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(n) || 0)));

/** مناطق داخل حدود الصورة، بنوعٍ معروف، وبلا عربي للمؤثرات والحقوق. */
export function cleanRegions(raw: unknown, width: number, height: number): Region[] {
  if (!Array.isArray(raw)) return [];
  const out: Region[] = [];
  for (const r of raw as Array<Record<string, unknown>>) {
    const kind = KINDS.includes(r?.kind as Region['kind']) ? (r.kind as Region['kind']) : 'speech';
    const x = clampInt(r?.x, 0, width - 1);
    const y = clampInt(r?.y, 0, height - 1);
    const w = clampInt(r?.w, 1, width - x);
    const h = clampInt(r?.h, 1, height - y);
    const source = typeof r?.source === 'string' ? r.source.trim() : '';
    const arabic = kind === 'sfx' || kind === 'credit' ? null : typeof r?.arabic === 'string' && r.arabic.trim() ? r.arabic.trim() : null;
    if (!source && !arabic) continue;
    out.push({ x, y, w, h, kind, speaker: typeof r?.speaker === 'string' && r.speaker.trim() ? r.speaker.trim() : null, source, arabic });
  }
  return out;
}

// ───────────────────────────── الطلبات ─────────────────────────────

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const HASH = /^[0-9a-f]{64}$/;

/** ما حُفظ من صفحات: الجوال يسأل عن الفصل كله دفعة، فيفتح ما ترجمه صديق فورًا. */
export async function handleTranslateCached(url: URL, env: TranslationEnv): Promise<Response> {
  const hashes = [...new Set((url.searchParams.get('hashes') ?? '').split(',').filter((h) => HASH.test(h)))].slice(0, 80);
  if (!hashes.length) return reply({ engine: engineOf(env), pages: {} });
  const engine = engineOf(env);
  const rows = await env.DB.prepare(
    `SELECT page_hash, width, height, regions_json, summary FROM translation_pages
      WHERE engine = ? AND page_hash IN (${hashes.map(() => '?').join(',')})`,
  )
    .bind(engine, ...hashes)
    .all<{ page_hash: string; width: number; height: number; regions_json: string; summary: string | null }>();
  const pages: Record<string, unknown> = {};
  for (const row of rows.results ?? []) {
    pages[row.page_hash] = { width: row.width, height: row.height, regions: JSON.parse(row.regions_json), summary: row.summary };
  }
  return reply({ engine, pages });
}

export async function handleTranslatePage(request: Request, env: TranslationEnv, userId: string, now: number, deps: TranslateDeps = {}): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return reply({ error: 'bad_json' }, 400);
  }
  const pageHash = typeof body.pageHash === 'string' && HASH.test(body.pageHash) ? body.pageHash : null;
  const image = body.image as { mediaType?: unknown; data?: unknown; width?: unknown; height?: unknown } | undefined;
  const seriesRef = typeof body.seriesRef === 'string' ? body.seriesRef.slice(0, 200) : null;
  if (!pageHash || !image || !seriesRef) return reply({ error: 'bad_request' }, 400);
  const mediaType = typeof image.mediaType === 'string' && MEDIA_TYPES.has(image.mediaType) ? image.mediaType : null;
  const data = typeof image.data === 'string' ? image.data : '';
  const width = clampInt(image.width, 0, 100_000);
  const height = clampInt(image.height, 0, 100_000);
  if (!mediaType || !data || data.length > MAX_IMAGE_BASE64 || !width || !height || Math.max(width, height) > MAX_IMAGE_EDGE) {
    return reply({ error: 'bad_image' }, 400);
  }
  const chapterKey = typeof body.chapterKey === 'string' ? body.chapterKey.slice(0, 250) : null;
  const pageIndex = clampInt(body.pageIndex, 0, 100_000);
  const chapterNumber = Number.isFinite(Number(body.chapterNumber)) && body.chapterNumber !== null ? Number(body.chapterNumber) : null;
  const sourceLang = typeof body.sourceLang === 'string' && LANGS.has(body.sourceLang) ? body.sourceLang : 'auto';
  const seriesTitle = typeof body.seriesTitle === 'string' ? body.seriesTitle.slice(0, 200) : null;
  const engine = engineOf(env);

  // ١. المحفوظ أولًا — لأي حساب ترجمه
  const cached = await env.DB.prepare('SELECT width, height, regions_json, summary FROM translation_pages WHERE page_hash = ? AND engine = ?')
    .bind(pageHash, engine)
    .first<{ width: number; height: number; regions_json: string; summary: string | null }>();
  if (cached) return reply({ engine, cached: true, width: cached.width, height: cached.height, regions: JSON.parse(cached.regions_json), summary: cached.summary });

  if (!env.OPENAI_API_KEY) return reply({ error: 'translation_not_configured' }, 503);

  // ٢. الحصة والسقف: الترجمة تكلّف، والمحفوظ مجاني
  const blocked = await quotaBlock(env, userId, now, chapterKey);
  if (blocked) return blocked;

  const memory = await workMemory(env.DB, engine, seriesRef, chapterKey, pageIndex);
  // «low» افتراضيًا: أقل توكنات تفكير = أرخص. `TRANSLATE_EFFORT` يرفعه إن احتجنا جودة أعلى
  const effort = (['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const).find((e) => e === env.TRANSLATE_EFFORT) ?? 'low';
  const model = env.TRANSLATE_MODEL || DEFAULT_MODEL;

  let payload: OpenAIResponse;
  try {
    const res = await (deps.fetch ?? fetch)(OPENAI_RESPONSES, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        instructions: SYSTEM_PROMPT,
        input: [
          {
            role: 'user',
            content: [
              // «original»: الأبعاد كما أرسلناها، فالإحداثيات بكسلات صورتنا نفسها
              { type: 'input_image', image_url: `data:${mediaType};base64,${data}`, detail: 'original' },
              { type: 'input_text', text: contextText({ seriesTitle, chapterNumber, pageIndex, sourceLang, memory }) },
            ],
          },
        ],
        reasoning: { effort },
        text: { format: { type: 'json_schema', name: 'page_translation', schema: OUTPUT_SCHEMA, strict: true } },
        max_output_tokens: 16000,
        store: false,
      }),
    });
    if (res.status === 429) {
      // 429 نوعان: ضغطٌ مؤقت، أو رصيدٌ خلص — والثاني لا تحلّه المحاولة ثانيةً
      const code = await res
        .json()
        .then((b) => (b as { error?: { code?: string; type?: string } })?.error)
        .catch(() => null);
      if (code?.code === 'insufficient_quota' || code?.type === 'insufficient_quota') return reply({ error: 'no_credit' }, 402);
      return reply({ error: 'busy' }, 429);
    }
    if (res.status === 401 || res.status === 403) return reply({ error: 'translation_not_configured' }, 503);
    if (res.status === 400) return reply({ error: 'rejected' }, 422);
    if (!res.ok) return reply({ error: 'upstream' }, 502);
    payload = (await res.json()) as OpenAIResponse;
  } catch {
    return reply({ error: 'upstream' }, 502);
  }

  const content = (payload.output ?? []).filter((o) => o.type === 'message').flatMap((o) => o.content ?? []);
  const filtered = payload.incomplete_details?.reason === 'content_filter';
  if (content.some((c) => c.type === 'refusal') || filtered) return reply({ error: 'refused' }, 422);
  if (payload.status === 'incomplete') return reply({ error: 'too_long' }, 502);
  const text = content.find((c) => c.type === 'output_text')?.text ?? '';
  let parsed: { regions?: unknown; new_terms?: unknown; characters?: unknown; summary?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    return reply({ error: 'bad_output' }, 502);
  }
  const regions = cleanRegions(parsed.regions, width, height);
  const summary = typeof parsed.summary === 'string' ? parsed.summary.slice(0, 600) : null;

  // ٣. الحفظ + ذاكرة العمل (أول قرار يثبت) + العدّاد، دفعة واحدة
  const statements = [
    env.DB.prepare(
      `INSERT INTO translation_pages (page_hash, engine, series_ref, chapter_key, page_index, source_lang, width, height, regions_json, summary, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (page_hash, engine) DO NOTHING`,
    ).bind(pageHash, engine, seriesRef, chapterKey, pageIndex, sourceLang, width, height, JSON.stringify(regions), summary, userId, now),
    ...usageStatements(env.DB, userId, now, chapterKey, costOf(payload.usage)),
  ];
  for (const t of Array.isArray(parsed.new_terms) ? (parsed.new_terms as Array<Record<string, unknown>>).slice(0, 40) : []) {
    const term = typeof t?.term === 'string' ? t.term.trim().slice(0, 120) : '';
    const arabic = typeof t?.arabic === 'string' ? t.arabic.trim().slice(0, 120) : '';
    if (!term || !arabic) continue;
    statements.push(
      env.DB.prepare(
        `INSERT INTO translation_terms (series_ref, term, arabic, kind, note, origin, updated_at) VALUES (?, ?, ?, ?, ?, 'model', ?)
         ON CONFLICT (series_ref, term) DO NOTHING`,
      ).bind(seriesRef, term, arabic, typeof t.kind === 'string' ? t.kind : null, typeof t.note === 'string' ? t.note.slice(0, 200) : null, now),
    );
  }
  for (const c of Array.isArray(parsed.characters) ? (parsed.characters as Array<Record<string, unknown>>).slice(0, 20) : []) {
    const name = typeof c?.name === 'string' ? c.name.trim().slice(0, 120) : '';
    const arabic = typeof c?.arabic === 'string' ? c.arabic.trim().slice(0, 120) : '';
    if (!name || !arabic) continue;
    statements.push(
      env.DB.prepare(
        `INSERT INTO translation_characters (series_ref, name, arabic, gender, voice, updated_at) VALUES (?, ?, ?, ?, NULL, ?)
         ON CONFLICT (series_ref, name) DO UPDATE SET
           gender = CASE WHEN translation_characters.gender IS NULL OR translation_characters.gender = 'unknown' THEN excluded.gender ELSE translation_characters.gender END`,
      ).bind(seriesRef, name, arabic, typeof c.gender === 'string' ? c.gender : null, now),
    );
  }
  await env.DB.batch(statements);

  return reply({ engine, cached: false, width, height, regions, summary, model: payload.model ?? model });
}

// ───────────────────────── الترجمة بالمعرّفات (خط الرؤية) ─────────────────────────
//
// عامل الترجمة على جهاز البيت يكشف الفقاعات ويقرأ النص (RT-DETR + comic-text-detector
// + PP-OCR) ويرسل هنا النصوص بمعرّفات ثابتة وصورة الصفحة للسياق. Luna تصحّح القراءة
// وتترجم وتصنّف (مؤثر صوتي؟ حقوق؟) وترد بالمعرّف نفسه. لا إحداثيات تخرج من النموذج:
// الهندسة كلها عند العامل، واللغة والسياق هنا مع القاموس وذاكرة الفصل.

/** يُرفع حين تتغير تعليمات الترجمة النصية تغييرًا يستحق ترجمة جديدة. */
export const TEXT_PROMPT_VERSION = 1;
export const textEngineOf = (env: TranslationEnv) => `${env.TRANSLATE_MODEL || DEFAULT_MODEL}:t${TEXT_PROMPT_VERSION}`;
const MAX_TEXT_REGIONS = 60;
const REGION_ID = /^[a-z0-9_-]{1,32}$/;

export const TEXT_SYSTEM_PROMPT = `You are the lead translator of VANTARA's Arabic team: a fan-translation group that has followed this work from its first chapter and knows its characters, running jokes and terminology by heart. You translate one comic page at a time (manga, manhwa, manhua, webtoon strips) into Arabic that reads as if it had been written in Arabic.

How you translate:
- Translate meaning, intent and tone, never word for word. Rebuild idioms, jokes, insults and wordplay with natural Arabic equivalents so they still land.
- Register: always clear, light Modern Standard Arabic (فصحى سلسة) of the kind professional Arabic scanlation teams use, the same on every page. Never use dialect words (no قدام، وش، ليش، راح، مو، هيك، ايش); express a character's tone through word choice and rhythm in فصحى instead. Keep each character's voice consistent: a thug is blunt and short, a noble is formal, a child is simple.
- Rebuild each sentence in the order an Arabic speaker would say it, never the English clause order. Examples: "Wait for me, I told you!" → «قلتُ لك انتظرني!»; "You're late, you know." → «لقد تأخرت.»; "It's over, isn't it?" → «انتهى الأمر، أليس كذلك؟».
- Keep it short enough to fit the original bubble: Arabic is often longer, so tighten wording rather than pad it.
- Get Arabic grammar right for the speaker and addressee: gender and number agreement. Use the character list for genders; when unknown, infer from the art and context.
- Names and terms: use the glossary exactly as given, every time. For a new proper noun or term, choose one rendering as a careful team would (transliterate personal names; translate techniques, skills, titles and organisations when the meaning matters) and report it in new_terms so it stays fixed. Report every newly identified character in characters.
- Honorifics: drop or adapt them naturally.
- Arabic punctuation (، ؛ ؟) with ! and … kept where they carry emotion. No diacritics except to prevent a real misreading. Western digits stay as they are.

What you receive: the page image, and a list of text regions the detector found, each with an id, a draft OCR reading (may contain small mistakes), a geometry guess and a box. What you return, one entry per region id, ids exactly as given, never invented, never merged:
- id: the region id.
- source: the original text exactly as written on the page (fix the OCR draft by reading the image).
- kind: speech, thought, narration (caption boxes), sign (text drawn in the scene), sfx (sound effects and onomatopoeia drawn into the art: BOOM, CLANG, 쾅, ドン), credit (scanlator credits, watermarks, site names, page numbers, ads).
- arabic: the translation. null for sfx and credit: the art keeps its sound effects. Signs are translated only when the reader needs them to follow the story; otherwise null.
- speaker: the character speaking, by the name used in the character list, or null when unclear.

Every speech, thought and narration region gets its own Arabic; null is only for sfx, credit and signs the reader does not need. When one sentence runs across two or more bubbles, split the Arabic across them in the same order, so each bubble holds its own part. Never fold one bubble's words into its neighbour and leave it empty: an empty bubble on the page reads as untranslated.

Also return summary: one or two Arabic sentences on what happens on this page, used as context for the next pages. Return empty arrays when there is nothing new.

Reference translations from the team's style sheet. Match this register, rhythm and brevity (English → Arabic):
- "Get out of my way!" → «ابتعد عن طريقي!»
- "You're... still alive?" → «أما زلت… حيًّا؟»
- "Don't make me laugh. You? Beat him?" → «لا تُضحكني. أنت؟ تهزمه؟»
- "I'll handle this. Take the others and go." → «سأتولى الأمر. خذ الآخرين وارحل.»
- "Tch. Whatever." → «تش. لا يهم.»
- "Master, please reconsider!" → «سيدي، أرجوك أعد النظر!»
- "So this is the power of a Grandmaster..." → «إذن هذه قوة السيد الأعظم…»
- "It's not that I want to fight. It's that I have to." → «ليس لأني أريد القتال، بل لأني مضطر.»
- "Hey, kid. You lost?" → «أنت يا فتى، أضعت طريقك؟»
- "That day, everything changed." (narration) → «في ذلك اليوم، تغيّر كل شيء.»
- "Can it be...? No. Impossible." (thought) → «أيُعقل…؟ لا. مستحيل.»
- "Big brother, wait for me!" → «أخي الكبير، انتظرني!»
- "You dare raise your hand against the Clan?!" → «أتجرؤ على رفع يدك في وجه العشيرة؟!»
- "Heh. Not bad, for a rookie." → «هه. ليس سيئًا لمبتدئ.»
- "Sorry... I'm sorry..." → «آسف… أنا آسف…»
- "Boss, we've got a problem." → «زعيم، لدينا مشكلة.»
- "Run! Don't look back!" → «اركض! ولا تنظر خلفك!»
- "Is that all you've got?" → «أهذا كل ما لديك؟»
- "Lord Kang, the elders await." → «سيد كانغ، الشيوخ في انتظارك.»
- "Ugh... my head..." → «آه… رأسي…»
- "We meet again, Jin. It's been ten years." → «نلتقي مجددًا يا جين. مرّت عشر سنوات.»
- "Just try it. I dare you." → «جرّب فحسب. أتحداك.»
- "If you enjoyed the show, even the smallest coin helps." → «إن أعجبكم العرض، فحتى أصغر قطعة نقدية تُعيننا.»
Do not copy these sentences; copy their voice: short, natural فصحى, Arabic word order, emotion carried by rhythm and punctuation rather than by extra words.`;

export const TEXT_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['regions', 'new_terms', 'characters', 'summary'],
  properties: {
    regions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'source', 'kind', 'arabic', 'speaker'],
        properties: {
          id: { type: 'string' },
          source: { type: 'string' },
          kind: { type: 'string', enum: [...KINDS] },
          arabic: { type: ['string', 'null'] },
          speaker: { type: ['string', 'null'] },
        },
      },
    },
    new_terms: OUTPUT_SCHEMA.properties.new_terms,
    characters: OUTPUT_SCHEMA.properties.characters,
    summary: { type: 'string' },
  },
} as const;

export interface TextRegionIn {
  id: string;
  source: string;
  kind: string;
  box: [number, number, number, number];
}
export interface TextRegionOut {
  id: string;
  source: string;
  kind: (typeof KINDS)[number];
  arabic: string | null;
  speaker: string | null;
}

/** مناطق الطلب: معرّف صالح، نص، صندوق داخل الصورة. ما لا يصلح يُهمل. */
export function cleanTextRegionsIn(raw: unknown, width: number, height: number): TextRegionIn[] {
  if (!Array.isArray(raw)) return [];
  const out: TextRegionIn[] = [];
  const seen = new Set<string>();
  for (const r of raw.slice(0, MAX_TEXT_REGIONS) as Array<Record<string, unknown>>) {
    const id = typeof r?.id === 'string' && REGION_ID.test(r.id) ? r.id : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const box = Array.isArray(r.box) && r.box.length === 4 ? (r.box.map((v) => clampInt(v, 0, Math.max(width, height))) as [number, number, number, number]) : ([0, 0, 0, 0] as [number, number, number, number]);
    out.push({ id, source: typeof r.source === 'string' ? r.source.trim().slice(0, 2000) : '', kind: typeof r.kind === 'string' ? r.kind.slice(0, 20) : 'speech', box });
  }
  return out;
}

/** ردّ النموذج: معرّفات نعرفها فقط، نوع معروف، ولا عربي للمؤثرات والحقوق. */
export function cleanTextRegionsOut(raw: unknown, known: Set<string>): TextRegionOut[] {
  if (!Array.isArray(raw)) return [];
  const out: TextRegionOut[] = [];
  const seen = new Set<string>();
  for (const r of raw as Array<Record<string, unknown>>) {
    const id = typeof r?.id === 'string' ? r.id : '';
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    const kind = KINDS.includes(r.kind as Region['kind']) ? (r.kind as Region['kind']) : 'speech';
    const arabic = kind === 'sfx' || kind === 'credit' ? null : typeof r.arabic === 'string' && r.arabic.trim() ? r.arabic.trim() : null;
    out.push({ id, source: typeof r.source === 'string' ? r.source.trim() : '', kind, arabic, speaker: typeof r.speaker === 'string' && r.speaker.trim() ? r.speaker.trim() : null });
  }
  return out;
}

export function textContext(input: { seriesTitle: string | null; chapterNumber: number | null; pageIndex: number; sourceLang: string; memory: WorkMemory; regions: TextRegionIn[] }): string {
  const base = contextText(input).replace(/\n\nTranslate this page\.$/, '');
  const list = input.regions.map((r) => `- ${r.id} [${r.kind}] box=${r.box.join(',')}: ${JSON.stringify(r.source)}`).join('\n');
  return `${base}\n\nRegions found on this page (id, geometry guess, box x1,y1,x2,y2, draft OCR):\n${list}\n\nTranslate this page.`;
}

/**
 * `POST /v1/translate/text`: نصوص بمعرّفات + الصورة للسياق → عربي بالمعرّف.
 * المحفوظ بالبصمة أولًا (لأي حساب)، ثم الحد الأسبوعي، ثم النموذج. الحفظ في
 * `translation_pages` نفسه بمحرّك `…:tN` فلا يختلط بالمسار القديم.
 */
export async function handleTranslateText(request: Request, env: TranslationEnv, userId: string, now: number, deps: TranslateDeps = {}): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return reply({ error: 'bad_json' }, 400);
  }
  const pageHash = typeof body.pageHash === 'string' && HASH.test(body.pageHash) ? body.pageHash : null;
  const image = body.image as { mediaType?: unknown; data?: unknown; width?: unknown; height?: unknown } | undefined;
  const seriesRef = typeof body.seriesRef === 'string' ? body.seriesRef.slice(0, 200) : null;
  if (!pageHash || !image || !seriesRef) return reply({ error: 'bad_request' }, 400);
  const mediaType = typeof image.mediaType === 'string' && MEDIA_TYPES.has(image.mediaType) ? image.mediaType : null;
  const data = typeof image.data === 'string' ? image.data : '';
  const width = clampInt(image.width, 0, 100_000);
  const height = clampInt(image.height, 0, 100_000);
  if (!mediaType || !data || data.length > MAX_IMAGE_BASE64 || !width || !height) return reply({ error: 'bad_image' }, 400);
  const regionsIn = cleanTextRegionsIn(body.regions, width, height);
  if (!regionsIn.length) return reply({ engine: textEngineOf(env), cached: false, regions: [], summary: null });
  const chapterKey = typeof body.chapterKey === 'string' ? body.chapterKey.slice(0, 250) : null;
  const pageIndex = clampInt(body.pageIndex, 0, 100_000);
  const chapterNumber = Number.isFinite(Number(body.chapterNumber)) && body.chapterNumber !== null ? Number(body.chapterNumber) : null;
  const sourceLang = typeof body.sourceLang === 'string' && LANGS.has(body.sourceLang) ? body.sourceLang : 'auto';
  const seriesTitle = typeof body.seriesTitle === 'string' ? body.seriesTitle.slice(0, 200) : null;
  // «سريع»: نفس Luna بلا تفكير. يُحفظ بمحرّك منفصل فلا يحلّ محل ترجمة الجودة أبدًا،
  // والطلب السريع يأخذ ترجمة الجودة إن وُجدت (أفضل وبلا تكلفة).
  const fast = body.speed === 'fast';
  const qualityEngine = textEngineOf(env);
  const engines = fast ? [qualityEngine, `${qualityEngine}:fast`] : [qualityEngine];
  let engine = engines[engines.length - 1]!;
  let cached: { regions_json: string; summary: string | null } | null = null;
  for (const e of engines) {
    cached = await env.DB.prepare('SELECT regions_json, summary FROM translation_pages WHERE page_hash = ? AND engine = ?')
      .bind(pageHash, e)
      .first<{ regions_json: string; summary: string | null }>();
    if (cached) {
      engine = e;
      break;
    }
  }
  const known = new Set(regionsIn.map((r) => r.id));
  const saved = cached ? (JSON.parse(cached.regions_json) as TextRegionOut[]).filter((r) => known.has(r.id)) : [];
  // المحفوظ صالح ما دامت المعرّفات نفسها (نفس الصورة = نفس الكشف = نفس المعرّفات).
  // فقاعة سقطت من ردّ سابق لا تبقى ساقطة للأبد: تُسأل Luna عنها وحدها.
  if (cached && saved.length && !unanswered(regionsIn, saved).length) {
    return reply({ engine, cached: true, regions: saved, summary: cached.summary });
  }

  const repairing = Boolean(cached && saved.length);
  if (!env.OPENAI_API_KEY) {
    return repairing ? reply({ engine, cached: true, regions: saved, summary: cached?.summary ?? null }) : reply({ error: 'translation_not_configured' }, 503);
  }
  if (!repairing) {
    const blocked = await quotaBlock(env, userId, now, chapterKey);
    if (blocked) return blocked;
  }

  const memory = await workMemory(env.DB, qualityEngine, seriesRef, chapterKey, pageIndex);
  const ask = (regions: TextRegionIn[], retry = false) =>
    askText(env, deps, {
      effort: fast ? 'none' : undefined,
      mediaType,
      data,
      context: textContext({ seriesTitle, chapterNumber, pageIndex, sourceLang, memory, regions }) + (retry ? RETRY_NOTE : ''),
      known: new Set(regions.map((r) => r.id)),
    });

  let merged = saved;
  let summary = cached?.summary ?? null;
  let parsed: { new_terms?: unknown; characters?: unknown } = {};
  let modelName: string | null = null;
  let usd = 0;
  if (!repairing) {
    const first = await ask(regionsIn);
    if (first instanceof Response) return first;
    merged = first.regions;
    summary = first.summary;
    parsed = first.parsed;
    modelName = first.model;
    usd += first.usd;
  }
  // مرة واحدة فقط: ما سقط من الرد (أو كلام بلا عربي) يُسأل عنه وحده
  const missing = unanswered(regionsIn, merged);
  if (missing.length) {
    const retry = await ask(missing, true);
    if (!(retry instanceof Response)) {
      usd += retry.usd;
      const fixed = new Map(retry.regions.map((r) => [r.id, r]));
      merged = regionsIn.map((r) => fixed.get(r.id) ?? merged.find((m) => m.id === r.id)).filter((r): r is TextRegionOut => Boolean(r));
      summary ??= retry.summary;
      modelName ??= retry.model;
    } else if (repairing) {
      return reply({ engine, cached: true, regions: saved, summary: cached?.summary ?? null });
    }
  }

  const statements = [
    env.DB.prepare(
      `INSERT INTO translation_pages (page_hash, engine, series_ref, chapter_key, page_index, source_lang, width, height, regions_json, summary, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (page_hash, engine) DO UPDATE SET regions_json = excluded.regions_json, summary = COALESCE(translation_pages.summary, excluded.summary)`,
    ).bind(pageHash, engine, seriesRef, chapterKey, pageIndex, sourceLang, width, height, JSON.stringify(merged), summary, userId, now),
    ...(repairing
      ? // الإصلاح لا يُحسب صفحة، لكن تكلفته تُسجَّل في سقف الشهر
        [env.DB.prepare(`INSERT INTO translation_spend (month, usd, updated_at) VALUES (?, ?, ?) ON CONFLICT (month) DO UPDATE SET usd = usd + excluded.usd, updated_at = excluded.updated_at`).bind(monthOf(now), usd, now)]
      : [...usageStatements(env.DB, userId, now, chapterKey, usd), ...memoryStatements(env.DB, seriesRef, parsed, now)]),
  ];
  await env.DB.batch(statements);
  return reply({ engine, cached: false, regions: merged, summary, model: modelName ?? env.TRANSLATE_MODEL ?? DEFAULT_MODEL });
}

/**
 * سؤال الإعادة: فقاعة بقيت بلا عربي (غالبًا دُمج معناها في جارتها). كل فقاعة
 * تُقرأ في مكانها، فلها ترجمتها هي، ولو تكرّر المعنى.
 */
export const RETRY_NOTE = `

These regions came back without Arabic in the first pass. Each one is its own bubble on the page and the reader sees it on its own, so each needs its own Arabic even if a neighbouring bubble says something related. Do not return null for speech, thought or narration: translate exactly the text of each region.`;

/**
 * `GET /v1/translate/usage`: كم صفحة ترجمتَ هذا الأسبوع ومن كم، ومتى يتجدد.
 * لحاسبة الترجمة المقدّمة. الصفحات المحفوظة من قبل (لأي حساب) لا تُحسب.
 */
export async function handleTranslateUsage(env: TranslationEnv, userId: string, now: number): Promise<Response> {
  const q = await quotaState(env, userId, now);
  const start = Date.parse(`${weekOf(now).slice(2)}T14:00:00Z`);
  return reply({
    used: q.pages,
    limit: q.pageLimit,
    chapters: q.chapters,
    chapterLimit: q.chapterLimit,
    spentUsd: Math.round(q.spentUsd * 1000) / 1000,
    budgetUsd: q.budgetUsd,
    resetsAt: start + 7 * 24 * 3600_000,
    configured: Boolean(env.OPENAI_API_KEY),
  });
}

/** مناطق طُلبت ولم تأخذ جوابًا: غائبة من الرد، أو كلام بلا عربي. اللافتة والمؤثر والحقوق بلا عربي جواب صحيح. */
export function unanswered(asked: TextRegionIn[], got: TextRegionOut[]): TextRegionIn[] {
  const byId = new Map(got.map((r) => [r.id, r]));
  return asked.filter((r) => {
    if (!r.source.trim()) return false;
    const hit = byId.get(r.id);
    if (!hit) return true;
    return hit.arabic === null && !['sfx', 'credit', 'sign'].includes(hit.kind);
  });
}

/** نداء Luna واحد لقائمة مناطق. يرجع الرد المنظّف، أو `Response` خطأ جاهزًا. */
async function askText(
  env: TranslationEnv,
  deps: TranslateDeps,
  input: { effort?: 'none' | undefined; mediaType: string; data: string; context: string; known: Set<string> },
): Promise<Response | { regions: TextRegionOut[]; summary: string | null; parsed: { new_terms?: unknown; characters?: unknown }; model: string | null; usd: number }> {
  const effort = input.effort ?? (['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const).find((e) => e === env.TRANSLATE_EFFORT) ?? 'low';
  const model = env.TRANSLATE_MODEL || DEFAULT_MODEL;
  let payload: OpenAIResponse;
  try {
    const res = await (deps.fetch ?? fetch)(OPENAI_RESPONSES, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        instructions: TEXT_SYSTEM_PROMPT,
        input: [
          {
            role: 'user',
            content: [
              // الصورة للسياق وتصحيح OCR لا للإحداثيات: «high» يكفي ولا يحتاج الدقة الأصلية
              { type: 'input_image', image_url: `data:${input.mediaType};base64,${input.data}`, detail: 'high' },
              { type: 'input_text', text: input.context },
            ],
          },
        ],
        reasoning: { effort },
        text: { format: { type: 'json_schema', name: 'page_text_translation', schema: TEXT_OUTPUT_SCHEMA, strict: true } },
        max_output_tokens: 16000,
        store: false,
      }),
    });
    if (res.status === 429) {
      const code = await res
        .json()
        .then((b) => (b as { error?: { code?: string; type?: string } })?.error)
        .catch(() => null);
      if (code?.code === 'insufficient_quota' || code?.type === 'insufficient_quota') return reply({ error: 'no_credit' }, 402);
      return reply({ error: 'busy' }, 429);
    }
    if (res.status === 401 || res.status === 403) return reply({ error: 'translation_not_configured' }, 503);
    if (res.status === 400) return reply({ error: 'rejected' }, 422);
    if (!res.ok) return reply({ error: 'upstream' }, 502);
    payload = (await res.json()) as OpenAIResponse;
  } catch {
    return reply({ error: 'upstream' }, 502);
  }

  const content = (payload.output ?? []).filter((o) => o.type === 'message').flatMap((o) => o.content ?? []);
  if (content.some((c) => c.type === 'refusal') || payload.incomplete_details?.reason === 'content_filter') return reply({ error: 'refused' }, 422);
  if (payload.status === 'incomplete') return reply({ error: 'too_long' }, 502);
  const text = content.find((c) => c.type === 'output_text')?.text ?? '';
  let parsed: { regions?: unknown; new_terms?: unknown; characters?: unknown; summary?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    return reply({ error: 'bad_output' }, 502);
  }
  return {
    regions: cleanTextRegionsOut(parsed.regions, input.known),
    summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 600) : null,
    parsed,
    model: payload.model ?? null,
    usd: costOf(payload.usage),
  };
}

/** المصطلحات والشخصيات الجديدة من ردّ النموذج → ذاكرة العمل (أول قرار يثبت). */
function memoryStatements(db: D1Database, seriesRef: string, parsed: { new_terms?: unknown; characters?: unknown }, now: number) {
  const statements = [];
  for (const t of Array.isArray(parsed.new_terms) ? (parsed.new_terms as Array<Record<string, unknown>>).slice(0, 40) : []) {
    const term = typeof t?.term === 'string' ? t.term.trim().slice(0, 120) : '';
    const arabic = typeof t?.arabic === 'string' ? t.arabic.trim().slice(0, 120) : '';
    if (!term || !arabic) continue;
    statements.push(
      db
        .prepare(
          `INSERT INTO translation_terms (series_ref, term, arabic, kind, note, origin, updated_at) VALUES (?, ?, ?, ?, ?, 'model', ?)
           ON CONFLICT (series_ref, term) DO NOTHING`,
        )
        .bind(seriesRef, term, arabic, typeof t.kind === 'string' ? t.kind : null, typeof t.note === 'string' ? t.note.slice(0, 200) : null, now),
    );
  }
  for (const c of Array.isArray(parsed.characters) ? (parsed.characters as Array<Record<string, unknown>>).slice(0, 20) : []) {
    const name = typeof c?.name === 'string' ? c.name.trim().slice(0, 120) : '';
    const arabic = typeof c?.arabic === 'string' ? c.arabic.trim().slice(0, 120) : '';
    if (!name || !arabic) continue;
    statements.push(
      db
        .prepare(
          `INSERT INTO translation_characters (series_ref, name, arabic, gender, voice, updated_at) VALUES (?, ?, ?, ?, NULL, ?)
           ON CONFLICT (series_ref, name) DO UPDATE SET
             gender = CASE WHEN translation_characters.gender IS NULL OR translation_characters.gender = 'unknown' THEN excluded.gender ELSE translation_characters.gender END`,
        )
        .bind(seriesRef, name, arabic, typeof c.gender === 'string' ? c.gender : null, now),
    );
  }
  return statements;
}


// ───────────────────────── التعلّم من الفصول العربية ─────────────────────────
//
// عملٌ له مصدر عربي توقّف عند فصل، وتكملة إنجليزية بعده: الفريق العربي ثبّت
// الأسماء والمصطلحات والأسلوب. الجوال يرسل صفحات متقابلة (إنجليزي/عربي) من
// فصل موجود عند المصدرين، وLuna تستخرج القاموس وملاحظات الأسلوب فتُترجم
// الفصول الجديدة بنفس الصوت. مرة لكل عمل (أو حين يزيد الفصل العربي).

export const LEARN_SYSTEM_PROMPT = `You are the lead translator of VANTARA's Arabic team. You receive pairs of comic pages: the English edition of a page and the Arabic edition of the same page as translated by the Arabic scanlation team the readers already follow. Study how that team translated and report, so later chapters continue in the same voice:
- characters: every character named on these pages, with the exact Arabic spelling the team used and gender when clear.
- terms: names of places, organisations, clans, techniques, skills, ranks, items and titles, with the team's Arabic rendering (or their choice to keep it as is), and a short note when the choice matters.
- style: 6 to 12 short Arabic lines describing the team's register and habits: فصحى level, sentence length, how honorifics and titles are handled (e.g. -nim, elder, master), how shouting and whispering are punctuated, recurring catchphrases and how each main character speaks. Concrete, not generic.
Report only what the pages show. Pages may not align exactly; match dialogue by meaning and position.`;

export const LEARN_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['characters', 'terms', 'style'],
  properties: {
    characters: OUTPUT_SCHEMA.properties.characters,
    terms: OUTPUT_SCHEMA.properties.new_terms,
    style: { type: 'array', items: { type: 'string' } },
  },
} as const;

const MAX_LEARN_PAIRS = 6;
const MAX_LEARN_IMAGE_BASE64 = 1_800_000; // ~1.3MB لكل صورة: الجوال يصغّر إلى عرض 1000

interface LearnPair {
  english: { mediaType: string; data: string };
  arabic: { mediaType: string; data: string };
  pageIndex: number;
}

function cleanLearnPairs(raw: unknown): LearnPair[] {
  if (!Array.isArray(raw)) return [];
  const out: LearnPair[] = [];
  for (const p of raw.slice(0, MAX_LEARN_PAIRS) as Array<Record<string, unknown>>) {
    const side = (v: unknown) => {
      const o = v as { mediaType?: unknown; data?: unknown } | undefined;
      const mediaType = typeof o?.mediaType === 'string' && MEDIA_TYPES.has(o.mediaType) ? o.mediaType : null;
      const data = typeof o?.data === 'string' && o.data && o.data.length <= MAX_LEARN_IMAGE_BASE64 ? o.data : null;
      return mediaType && data ? { mediaType, data } : null;
    };
    const english = side(p?.english);
    const arabic = side(p?.arabic);
    if (!english || !arabic) continue;
    out.push({ english, arabic, pageIndex: clampInt(p.pageIndex, 0, 100_000) });
  }
  return out;
}

/**
 * `POST /v1/translate/learn`: `{ seriesRef, seriesTitle, chapterNumber, pairs: [{ english, arabic, pageIndex }] }`.
 * يحسب صفحة واحدة من الحد الأسبوعي. القاموس المتعلَّم يغلب ما اقترحه النموذج
 * سابقًا (origin='learned')، والأسلوب يُخزَّن في `translation_style`.
 */
export async function handleTranslateLearn(request: Request, env: TranslationEnv, userId: string, now: number, deps: TranslateDeps = {}): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return reply({ error: 'bad_json' }, 400);
  }
  const seriesRef = typeof body.seriesRef === 'string' ? body.seriesRef.slice(0, 200) : null;
  const pairs = cleanLearnPairs(body.pairs);
  if (!seriesRef || !pairs.length) return reply({ error: 'bad_request' }, 400);
  const seriesTitle = typeof body.seriesTitle === 'string' ? body.seriesTitle.slice(0, 200) : null;
  const chapterNumber = Number.isFinite(Number(body.chapterNumber)) && body.chapterNumber !== null ? Number(body.chapterNumber) : null;
  const learnedFrom = chapterNumber !== null ? `chapter:${chapterNumber}` : 'unknown';

  const existing = await env.DB.prepare('SELECT learned_from, pairs FROM translation_style WHERE series_ref = ?').bind(seriesRef).first<{ learned_from: string | null; pairs: number }>();
  if (existing && existing.learned_from === learnedFrom) return reply({ learned: false, cached: true, learnedFrom });

  if (!env.OPENAI_API_KEY) return reply({ error: 'translation_not_configured' }, 503);
  const blocked = await quotaBlock(env, userId, now, null);
  if (blocked) return blocked;

  const content: Array<Record<string, unknown>> = [];
  pairs.forEach((p, i) => {
    content.push({ type: 'input_text', text: `Pair ${i + 1} (page ${p.pageIndex + 1}) — English edition:` });
    content.push({ type: 'input_image', image_url: `data:${p.english.mediaType};base64,${p.english.data}`, detail: 'high' });
    content.push({ type: 'input_text', text: `Pair ${i + 1} — Arabic edition of the same page:` });
    content.push({ type: 'input_image', image_url: `data:${p.arabic.mediaType};base64,${p.arabic.data}`, detail: 'high' });
  });
  content.push({ type: 'input_text', text: `Work: ${seriesTitle ?? 'unknown'}${chapterNumber !== null ? ` — chapter ${chapterNumber}` : ''}. Study the Arabic team's choices on these ${pairs.length} pages and report.` });
  const model = env.TRANSLATE_MODEL || DEFAULT_MODEL;
  let payload: OpenAIResponse;
  try {
    const res = await (deps.fetch ?? fetch)(OPENAI_RESPONSES, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        instructions: LEARN_SYSTEM_PROMPT,
        input: [{ role: 'user', content }],
        reasoning: { effort: 'medium' },
        text: { format: { type: 'json_schema', name: 'team_style', schema: LEARN_OUTPUT_SCHEMA, strict: true } },
        max_output_tokens: 8000,
        store: false,
      }),
    });
    if (res.status === 429) return reply({ error: 'busy' }, 429);
    if (res.status === 401 || res.status === 403) return reply({ error: 'translation_not_configured' }, 503);
    if (!res.ok) return reply({ error: 'upstream' }, 502);
    payload = (await res.json()) as OpenAIResponse;
  } catch {
    return reply({ error: 'upstream' }, 502);
  }
  const out = (payload.output ?? []).filter((o) => o.type === 'message').flatMap((o) => o.content ?? []);
  if (out.some((c) => c.type === 'refusal')) return reply({ error: 'refused' }, 422);
  let parsed: { characters?: unknown; terms?: unknown; style?: unknown };
  try {
    parsed = JSON.parse(out.find((c) => c.type === 'output_text')?.text ?? '');
  } catch {
    return reply({ error: 'bad_output' }, 502);
  }
  const style = (Array.isArray(parsed.style) ? (parsed.style as unknown[]) : [])
    .filter((l): l is string => typeof l === 'string' && l.trim().length > 0)
    .slice(0, 16)
    .map((l) => `- ${l.trim().slice(0, 240)}`)
    .join('\n');
  const statements = [
    env.DB.prepare(
      `INSERT INTO translation_style (series_ref, notes, learned_from, pairs, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (series_ref) DO UPDATE SET notes = excluded.notes, learned_from = excluded.learned_from, pairs = excluded.pairs, updated_at = excluded.updated_at`,
    ).bind(seriesRef, style, learnedFrom, pairs.length, now),
    ...usageStatements(env.DB, userId, now, null, costOf(payload.usage)),
  ];
  // المتعلَّم من الفريق يغلب ما اخترعه النموذج قبله
  for (const t of Array.isArray(parsed.terms) ? (parsed.terms as Array<Record<string, unknown>>).slice(0, 80) : []) {
    const term = typeof t?.term === 'string' ? t.term.trim().slice(0, 120) : '';
    const arabic = typeof t?.arabic === 'string' ? t.arabic.trim().slice(0, 120) : '';
    if (!term || !arabic) continue;
    statements.push(
      env.DB.prepare(
        `INSERT INTO translation_terms (series_ref, term, arabic, kind, note, origin, updated_at) VALUES (?, ?, ?, ?, ?, 'learned', ?)
         ON CONFLICT (series_ref, term) DO UPDATE SET arabic = excluded.arabic, kind = excluded.kind, note = excluded.note, origin = 'learned', updated_at = excluded.updated_at`,
      ).bind(seriesRef, term, arabic, typeof t.kind === 'string' ? t.kind : null, typeof t.note === 'string' ? t.note.slice(0, 200) : null, now),
    );
  }
  for (const c of Array.isArray(parsed.characters) ? (parsed.characters as Array<Record<string, unknown>>).slice(0, 40) : []) {
    const name = typeof c?.name === 'string' ? c.name.trim().slice(0, 120) : '';
    const arabic = typeof c?.arabic === 'string' ? c.arabic.trim().slice(0, 120) : '';
    if (!name || !arabic) continue;
    statements.push(
      env.DB.prepare(
        `INSERT INTO translation_characters (series_ref, name, arabic, gender, voice, updated_at) VALUES (?, ?, ?, ?, NULL, ?)
         ON CONFLICT (series_ref, name) DO UPDATE SET arabic = excluded.arabic,
           gender = CASE WHEN excluded.gender IS NULL OR excluded.gender = 'unknown' THEN translation_characters.gender ELSE excluded.gender END,
           updated_at = excluded.updated_at`,
      ).bind(seriesRef, name, arabic, typeof c.gender === 'string' ? c.gender : null, now),
    );
  }
  await env.DB.batch(statements);
  return reply({ learned: true, cached: false, learnedFrom, terms: statements.length - 2, styleLines: style ? style.split('\n').length : 0 });
}

/** مصطلحات العمل وشخصياته — لعرضها وتعديلها. */
export async function handleTranslateGlossary(url: URL, env: TranslationEnv): Promise<Response> {
  const seriesRef = url.searchParams.get('seriesRef')?.slice(0, 200);
  if (!seriesRef) return reply({ error: 'bad_request' }, 400);
  const memory = await workMemory(env.DB, engineOf(env), seriesRef, null, 0);
  return reply({ terms: memory.terms, characters: memory.characters });
}
