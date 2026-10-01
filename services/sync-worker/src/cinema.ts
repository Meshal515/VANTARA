/**
 * VANTARA CINEMA — قصة العمل بالعربية.
 *
 * Cinemeta يعطي القصة بالإنجليزية فقط. الجهاز يرسل النصوص (عمل أو حلقة)،
 * ونترجم ما لم يُترجم من قبل في نداء واحد عبر DeepSeek (المفتاح هنا وحده)،
 * ونحفظ الناتج لكل الحسابات ببصمة النص: تغيّر القصة في المصدر يعيد ترجمتها.
 * العناوين لا تُترجم: أسماء الأعمال تبقى كما هي.
 */

import { chatJson, LlmError, type LlmEnv } from './rafiq-llm.ts';
import type { D1Database } from './types.ts';

export interface CinemaEnv extends LlmEnv {
  DB: D1Database;
}

type Fetch = typeof fetch;

const KEY = /^tt\d{1,10}(?::\d{1,3}:\d{1,4})?$/;
const MAX_ITEMS = 24;
const MAX_TEXT = 1200;
/** ترجمات جديدة لكل حساب في اليوم: سقف يمنع استنزاف الرصيد، والمحفوظ بلا حد. */
export const DAILY_NEW = 400;

const SYSTEM = `أنت مترجم أفلام ومسلسلات محترف. تترجم ملخّصات القصص من الإنجليزية إلى عربية فصحى سلسة كما تُكتب على منصات البث.
- لا تترجم أسماء الأشخاص والأماكن والأعمال: اكتبها بحروفها اللاتينية كما هي.
- لا تضف معلومة ولا تحذف، ولا تحرق أحداثًا غير موجودة في النص.
- أعد JSON فقط بالشكل: {"t": {"<المفتاح>": "<الترجمة>"}} لكل مفتاح وصلك.`;

async function sha(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export async function handleCinemaOverviews(request: Request, env: CinemaEnv, userId: string, now: number, fetchImpl: Fetch = fetch): Promise<Response> {
  let body: { items?: unknown };
  try {
    body = (await request.json()) as { items?: unknown };
  } catch {
    return reply({ error: 'bad_json' }, 400);
  }
  const items = (Array.isArray(body.items) ? body.items : [])
    .map((x) => x as { key?: unknown; text?: unknown })
    .filter((x) => typeof x.key === 'string' && KEY.test(x.key) && typeof x.text === 'string' && x.text.trim().length >= 12)
    .slice(0, MAX_ITEMS)
    .map((x) => ({ key: x.key as string, text: (x.text as string).trim().slice(0, MAX_TEXT) }));
  if (!items.length) return reply({ overviews: {} });

  const hashed = await Promise.all(items.map(async (x) => ({ ...x, hash: await sha(x.text) })));
  const out: Record<string, string> = {};
  const marks = hashed.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`SELECT key, source_hash, text_ar FROM cinema_overviews WHERE key IN (${marks})`)
    .bind(...hashed.map((x) => x.key))
    .all<{ key: string; source_hash: string; text_ar: string }>();
  const saved = new Map((results ?? []).map((r) => [r.key, r]));
  const missing = hashed.filter((x) => {
    const row = saved.get(x.key);
    if (row && row.source_hash === x.hash) {
      out[x.key] = row.text_ar;
      return false;
    }
    return true;
  });
  if (!missing.length) return reply({ overviews: out });

  const since = now - 86_400_000;
  const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM cinema_overviews WHERE created_by = ? AND created_at >= ?').bind(userId, since).first<{ n: number }>();
  const room = Math.max(0, DAILY_NEW - (used?.n ?? 0));
  const batch = missing.slice(0, room);
  if (!batch.length) return reply({ overviews: out, pending: missing.map((x) => x.key), reason: 'daily_limit' });

  let translated: Record<string, unknown> = {};
  try {
    const res = await chatJson<{ t?: Record<string, unknown> }>(
      env.DB,
      env,
      fetchImpl,
      [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: JSON.stringify(Object.fromEntries(batch.map((x) => [x.key, x.text]))) },
      ],
      now,
      { userId, purpose: 'cinema_overview', maxTokens: Math.min(4000, 200 + batch.length * 260) },
    );
    translated = res.t ?? {};
  } catch (e) {
    const code = e instanceof LlmError ? e.code : 'upstream';
    return reply({ overviews: out, pending: batch.map((x) => x.key), reason: code });
  }
  const writes = [];
  for (const x of batch) {
    const ar = typeof translated[x.key] === 'string' ? (translated[x.key] as string).trim() : '';
    // ترجمة فعلية فقط: نص عربي، لا الإنجليزي راجعًا كما هو
    if (!ar || !/[؀-ۿ]/.test(ar)) continue;
    out[x.key] = ar.slice(0, 2400);
    writes.push(
      env.DB.prepare(
        `INSERT INTO cinema_overviews (key, source_hash, text_ar, created_by, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET source_hash = excluded.source_hash, text_ar = excluded.text_ar, created_by = excluded.created_by, created_at = excluded.created_at`,
      ).bind(x.key, x.hash, out[x.key], userId, now),
    );
  }
  if (writes.length) await env.DB.batch(writes);
  return reply({ overviews: out });
}
