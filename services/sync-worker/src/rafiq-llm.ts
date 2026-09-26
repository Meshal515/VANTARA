/**
 * «رفيق» — عميل DeepSeek (واجهة متوافقة مع OpenAI Chat Completions).
 *
 * النموذج للمحادثة والترتيب والشرح فقط، ومخرجه JSON بمخطط نتحقق منه (`json_object`).
 * البث: الخادم يقرأ دفق النموذج ويستخرج حقل `message` وهو يُكتب، فيصل للجهاز حرفًا
 * حرفًا، والبطاقات تُرسل بعد التحقق منها لا قبل.
 */

import type { D1Database } from './types.ts';

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

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

export const DEFAULT_MODEL = 'deepseek-chat';
/** دولار لكل مليون توكن: إدخال محفوظ، إدخال جديد، إخراج (أسعار DeepSeek المنشورة؛ تقدير للسقف لا فاتورة). */
const PRICE = { hit: 0.07, miss: 0.27, out: 1.1 };
const DEFAULT_BUDGET_USD = 5;

export class LlmError extends Error {
  constructor(public code: 'not_configured' | 'budget' | 'upstream' | 'bad_output') {
    super(code);
  }
}

const month = (now: number) => new Date(now).toISOString().slice(0, 7);

export function costOf(u: Usage | undefined): number {
  if (!u) return 0;
  const hit = u.prompt_cache_hit_tokens ?? 0;
  const miss = u.prompt_cache_miss_tokens ?? Math.max(0, (u.prompt_tokens ?? 0) - hit);
  return (hit * PRICE.hit + miss * PRICE.miss + (u.completion_tokens ?? 0) * PRICE.out) / 1_000_000;
}

async function underBudget(db: D1Database, env: LlmEnv, now: number): Promise<boolean> {
  const cap = Number(env.RAFIQ_MONTHLY_BUDGET_USD ?? DEFAULT_BUDGET_USD);
  const row = await db.prepare('SELECT usd FROM rafiq_spend WHERE month = ?').bind(month(now)).first<{ usd: number }>();
  return (row?.usd ?? 0) < cap;
}

async function record(db: D1Database, now: number, usage: Usage | undefined): Promise<void> {
  await db
    .prepare('INSERT INTO rafiq_spend (month, usd, calls) VALUES (?, ?, 1) ON CONFLICT (month) DO UPDATE SET usd = usd + excluded.usd, calls = calls + 1')
    .bind(month(now), costOf(usage))
    .run();
}

function endpoint(env: LlmEnv) {
  return `${(env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '')}/chat/completions`;
}

/** نداء JSON كامل (بلا بث): تحليل الطلب، الملخّص. */
export async function chatJson<T>(db: D1Database, env: LlmEnv, fetchImpl: Fetch, messages: ChatMessage[], now: number, maxTokens = 700): Promise<T> {
  if (!env.DEEPSEEK_API_KEY) throw new LlmError('not_configured');
  if (!(await underBudget(db, env, now))) throw new LlmError('budget');
  let res: Response;
  try {
    res = await fetchImpl(endpoint(env), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({ model: env.RAFIQ_MODEL ?? DEFAULT_MODEL, messages, response_format: { type: 'json_object' }, temperature: 0.2, max_tokens: maxTokens }),
    });
  } catch {
    throw new LlmError('upstream');
  }
  if (!res.ok) throw new LlmError('upstream');
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: Usage };
  await record(db, now, body.usage);
  try {
    return JSON.parse(body.choices?.[0]?.message?.content ?? '') as T;
  } catch {
    throw new LlmError('bad_output');
  }
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
 */
export async function chatStream<T>(
  db: D1Database,
  env: LlmEnv,
  fetchImpl: Fetch,
  messages: ChatMessage[],
  now: number,
  onText: (text: string) => void,
  maxTokens = 1400,
): Promise<T> {
  if (!env.DEEPSEEK_API_KEY) throw new LlmError('not_configured');
  if (!(await underBudget(db, env, now))) throw new LlmError('budget');
  let res: Response;
  try {
    res = await fetchImpl(endpoint(env), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: env.RAFIQ_MODEL ?? DEFAULT_MODEL,
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.5,
        max_tokens: maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      }),
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
  await record(db, now, usage);
  try {
    return JSON.parse(json) as T;
  } catch {
    throw new LlmError('bad_output');
  }
}
