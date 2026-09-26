/**
 * «رفيق» — عميل DeepSeek (صيغة OpenAI Chat Completions).
 *
 * كل نداء يمرّ بالموجّه (`rafiq-models.ts`): نموذج وتفكير حسب المهمة، ويُسجَّل في
 * `rafiq_usage` بكلفته الفعلية (محفوظ/جديد/إخراج، الذروة ضعف) ولأي مهارة وطلب.
 * التفكير الداخلي (`reasoning_content`) لا يُحفظ ولا يُرسل للجهاز أبدًا.
 *
 * البث: نقرأ دفق النموذج ونستخرج حقل `message` من JSON وهو يُكتب، فيصل للجهاز
 * حرفًا حرفًا، والبطاقات تُرسل بعد التحقق منها لا قبل.
 */

import type { D1Database } from './types.ts';
import { DEFAULT_MODEL, type Effort, type Usage, costOf, thinkingParams } from './rafiq-models.ts';

type Fetch = typeof fetch;

export interface LlmEnv {
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_BASE_URL?: string;
  RAFIQ_MODEL?: string;
  RAFIQ_MONTHLY_BUDGET_USD?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CallOpts {
  effort?: Effort;
  maxTokens?: number;
  /** للمحاسبة: من طلب ولأي غرض. */
  userId?: string;
  requestId?: string;
  skill?: string;
  purpose?: string;
  model?: string;
}

const DEFAULT_BUDGET_USD = 5;

export class LlmError extends Error {
  constructor(public code: 'not_configured' | 'budget' | 'upstream' | 'bad_output') {
    super(code);
  }
}

const month = (now: number) => new Date(now).toISOString().slice(0, 7);

export function budgetOf(env: LlmEnv): number {
  const n = Number(env.RAFIQ_MONTHLY_BUDGET_USD);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BUDGET_USD;
}

/** نسبة الباقي من ميزانية الشهر (0..1): الموجّه يخفّف التفكير حين تضيق. */
export async function budgetLeft(db: D1Database, env: LlmEnv, now: number): Promise<number> {
  const row = await db.prepare('SELECT usd FROM rafiq_spend WHERE month = ?').bind(month(now)).first<{ usd: number }>();
  return Math.max(0, 1 - (row?.usd ?? 0) / budgetOf(env));
}

async function record(db: D1Database, now: number, model: string, effort: Effort, usage: Usage | undefined, opts: CallOpts, latency: number, ok: boolean): Promise<void> {
  const usd = costOf(usage, model, now);
  const hit = usage?.prompt_cache_hit_tokens ?? 0;
  const miss = usage?.prompt_cache_miss_tokens ?? Math.max(0, (usage?.prompt_tokens ?? 0) - hit);
  await db.batch([
    db
      .prepare('INSERT INTO rafiq_spend (month, usd, calls) VALUES (?, ?, 1) ON CONFLICT (month) DO UPDATE SET usd = usd + excluded.usd, calls = calls + 1')
      .bind(month(now), usd),
    db
      .prepare(
        `INSERT INTO rafiq_usage (id, user_id, request_id, skill, purpose, model, effort, input_hit, input_miss, output_tokens, reasoning_tokens, usd, latency_ms, ok, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        opts.userId ?? '',
        opts.requestId ?? null,
        opts.skill ?? null,
        opts.purpose ?? 'chat',
        model,
        effort,
        hit,
        miss,
        usage?.completion_tokens ?? 0,
        usage?.completion_tokens_details?.reasoning_tokens ?? 0,
        usd,
        latency,
        ok ? 1 : 0,
        now,
      ),
  ]);
}

function endpoint(env: LlmEnv) {
  return `${(env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '')}/chat/completions`;
}

async function begin(db: D1Database, env: LlmEnv, now: number) {
  if (!env.DEEPSEEK_API_KEY) throw new LlmError('not_configured');
  if ((await budgetLeft(db, env, now)) <= 0) throw new LlmError('budget');
}

function body(env: LlmEnv, messages: ChatMessage[], opts: CallOpts, extra: Record<string, unknown>) {
  const model = opts.model ?? env.RAFIQ_MODEL ?? DEFAULT_MODEL;
  const effort = opts.effort ?? 'none';
  return {
    model,
    effort,
    payload: {
      model,
      messages,
      response_format: { type: 'json_object' },
      max_tokens: opts.maxTokens ?? 900,
      // «ثابت أولًا»: تعليمات النظام نفسها في كل طلب، فيحفظها DeepSeek (سعر المحفوظ أرخص 50 مرة)
      ...thinkingParams(effort),
      ...(effort === 'none' ? { temperature: 0.3 } : {}),
      ...extra,
    },
  };
}

/** نداء JSON كامل (بلا بث): فهم الطلب، الملخّص. */
export async function chatJson<T>(db: D1Database, env: LlmEnv, fetchImpl: Fetch, messages: ChatMessage[], now: number, opts: CallOpts = {}): Promise<T> {
  await begin(db, env, now);
  const { model, effort, payload } = body(env, messages, { maxTokens: 700, ...opts }, {});
  const started = Date.now();
  let res: Response;
  try {
    res = await fetchImpl(endpoint(env), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new LlmError('upstream');
  }
  if (!res.ok) throw new LlmError('upstream');
  const out = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: Usage };
  const content = out.choices?.[0]?.message?.content ?? '';
  let parsed: T;
  try {
    parsed = JSON.parse(content) as T;
  } catch {
    await record(db, now, model, effort, out.usage, opts, Date.now() - started, false);
    throw new LlmError('bad_output');
  }
  await record(db, now, model, effort, out.usage, opts, Date.now() - started, true);
  return parsed;
}

/**
 * يستخرج قيمة حقل نصي (`"message": "…"`) من JSON يُكتب تدريجيًّا. يرجع ما اكتمل منه
 * حتى الآن (بعد فك الهروب)، وهل انغلق.
 */
export function partialString(json: string, field: string): { text: string; closed: boolean } | null {
  const m = new RegExp(`"${field}"\\s*:\\s*"`).exec(json);
  if (!m) return null;
  let i = m.index + m[0].length;
  let out = '';
  while (i < json.length) {
    const c = json[i]!;
    if (c === '"') return { text: out, closed: true };
    if (c === '\\') {
      const n = json[i + 1];
      if (n === undefined) break;
      if (n === 'u') {
        const hex = json.slice(i + 2, i + 6);
        if (hex.length < 4) break;
        out += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        continue;
      }
      out += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '' : n;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return { text: out, closed: false };
}

/**
 * نداء مبثوث: `onText` يستلم نص الحقل `message` كلما زاد، والوعد يرجع JSON الكامل.
 * في وضع التفكير يصل `reasoning_content` أولًا: يُتجاهل تمامًا (لا يُحفظ ولا يُبث).
 */
export async function chatStream<T>(
  db: D1Database,
  env: LlmEnv,
  fetchImpl: Fetch,
  messages: ChatMessage[],
  now: number,
  onText: (text: string) => void,
  opts: CallOpts = {},
): Promise<T> {
  await begin(db, env, now);
  const { model, effort, payload } = body(env, messages, { maxTokens: 1600, ...opts }, { stream: true, stream_options: { include_usage: true } });
  const started = Date.now();
  let res: Response;
  try {
    res = await fetchImpl(endpoint(env), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new LlmError('upstream');
  }
  if (!res.ok || !res.body) throw new LlmError('upstream');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let json = '';
  let sent = '';
  let usage: Usage | undefined;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const chunk = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }>; usage?: Usage };
        if (chunk.usage) usage = chunk.usage;
        const piece = chunk.choices?.[0]?.delta?.content;
        if (!piece) continue;
        json += piece;
        const partial = partialString(json, 'message');
        if (partial && partial.text.length > sent.length) {
          sent = partial.text;
          onText(sent);
        }
      } catch {
        // سطر ناقص: يكتمل مع التالي
      }
    }
  }
  let parsed: T;
  try {
    parsed = JSON.parse(json) as T;
  } catch {
    await record(db, now, model, effort, usage, opts, Date.now() - started, false);
    throw new LlmError('bad_output');
  }
  await record(db, now, model, effort, usage, opts, Date.now() - started, true);
  return parsed;
}
