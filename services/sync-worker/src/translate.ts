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
const DEFAULT_WEEKLY_PAGES = 1000;
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
interface OpenAIResponse {
  model?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: Array<{ type: string; content?: Array<{ type: string; text?: string; refusal?: string }> }>;
}

export interface TranslateDeps {
  /** للاختبار: fetch بديل بدل الشبكة. */
  fetch?: typeof fetch;
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
}

async function workMemory(db: D1Database, engine: string, seriesRef: string, chapterKey: string | null, pageIndex: number): Promise<WorkMemory> {
  const [terms, characters, pages] = await Promise.all([
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

  // ٢. الحد الأسبوعي: الترجمة تكلّف، والمحفوظ مجاني
  const day = weekOf(now);
  const limit = Number(env.TRANSLATE_WEEKLY_PAGES) || DEFAULT_WEEKLY_PAGES;
  const used = await env.DB.prepare('SELECT pages FROM translation_usage WHERE user_id = ? AND day = ?').bind(userId, day).first<{ pages: number }>();
  if ((used?.pages ?? 0) >= limit) return reply({ error: 'weekly_limit', limit }, 429);

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
    env.DB.prepare(
      `INSERT INTO translation_usage (user_id, day, pages) VALUES (?, ?, 1)
       ON CONFLICT (user_id, day) DO UPDATE SET pages = pages + 1`,
    ).bind(userId, day),
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

Also return summary: one or two Arabic sentences on what happens on this page, used as context for the next pages. Return empty arrays when there is nothing new.`;

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
  const engine = textEngineOf(env);

  const cached = await env.DB.prepare('SELECT regions_json, summary FROM translation_pages WHERE page_hash = ? AND engine = ?')
    .bind(pageHash, engine)
    .first<{ regions_json: string; summary: string | null }>();
  if (cached) {
    // المحفوظ صالح ما دامت المعرّفات نفسها (نفس الصورة = نفس الكشف = نفس المعرّفات)
    const saved = JSON.parse(cached.regions_json) as TextRegionOut[];
    const known = new Set(regionsIn.map((r) => r.id));
    if (saved.some((r) => known.has(r.id))) return reply({ engine, cached: true, regions: saved.filter((r) => known.has(r.id)), summary: cached.summary });
  }

  if (!env.OPENAI_API_KEY) return reply({ error: 'translation_not_configured' }, 503);
  const day = weekOf(now);
  const limit = Number(env.TRANSLATE_WEEKLY_PAGES) || DEFAULT_WEEKLY_PAGES;
  const used = await env.DB.prepare('SELECT pages FROM translation_usage WHERE user_id = ? AND day = ?').bind(userId, day).first<{ pages: number }>();
  if ((used?.pages ?? 0) >= limit) return reply({ error: 'weekly_limit', limit }, 429);

  const memory = await workMemory(env.DB, engine, seriesRef, chapterKey, pageIndex);
  const effort = (['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const).find((e) => e === env.TRANSLATE_EFFORT) ?? 'low';
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
              { type: 'input_image', image_url: `data:${mediaType};base64,${data}`, detail: 'high' },
              { type: 'input_text', text: textContext({ seriesTitle, chapterNumber, pageIndex, sourceLang, memory, regions: regionsIn }) },
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
  const regions = cleanTextRegionsOut(parsed.regions, new Set(regionsIn.map((r) => r.id)));
  const summary = typeof parsed.summary === 'string' ? parsed.summary.slice(0, 600) : null;

  const statements = [
    env.DB.prepare(
      `INSERT INTO translation_pages (page_hash, engine, series_ref, chapter_key, page_index, source_lang, width, height, regions_json, summary, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (page_hash, engine) DO NOTHING`,
    ).bind(pageHash, engine, seriesRef, chapterKey, pageIndex, sourceLang, width, height, JSON.stringify(regions), summary, userId, now),
    env.DB.prepare(
      `INSERT INTO translation_usage (user_id, day, pages) VALUES (?, ?, 1)
       ON CONFLICT (user_id, day) DO UPDATE SET pages = pages + 1`,
    ).bind(userId, day),
    ...memoryStatements(env.DB, seriesRef, parsed, now),
  ];
  await env.DB.batch(statements);
  return reply({ engine, cached: false, regions, summary, model: payload.model ?? model });
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

/** مصطلحات العمل وشخصياته — لعرضها وتعديلها. */
export async function handleTranslateGlossary(url: URL, env: TranslationEnv): Promise<Response> {
  const seriesRef = url.searchParams.get('seriesRef')?.slice(0, 200);
  if (!seriesRef) return reply({ error: 'bad_request' }, 400);
  const memory = await workMemory(env.DB, engineOf(env), seriesRef, null, 0);
  return reply({ terms: memory.terms, characters: memory.characters });
}
