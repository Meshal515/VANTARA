/**
 * الخيطان الرفيعان لآخر التحديثات المحلي (خطة 27 نوفمبر، المرحلة 7). الخادم لا يكشف ولا يقرر:
 * - نسخة الحساب: ملخص صغير لصاحبه وحده (≤256KB)، يُستعاد في تثبيت جديد فلا يضيع ما كشفه جهازه.
 * - إشارات الأصحاب: حدث اكتشفه جهاز يصل لبقية حسابات النسخة، بلا روابط وبلا هوية المرسل في الرد. جهاز المستقبل
 *   يقبلها لمصدر مثبت عنده فقط ويمررها على قراره هو (لغته وسياسته)، فلا يطرق المصدر نفسه مرة ثانية.
 */
import type { D1Database } from './types.ts';

export interface ThreadsEnv { DB: D1Database }

const MAX_BACKUP = 256 * 1024;
const MAX_SIGNALS = 100;
const SIGNAL_TTL = 30 * 86_400_000;
const SECTIONS = new Set(['manga', 'anime', 'cinema']);
const KINDS = new Set(['chapter', 'episode', 'movie']);
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function handleBackupGet(env: ThreadsEnv, userId: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT payload, updated_at FROM latest_backups WHERE user_id = ?').bind(userId).first<{ payload: string; updated_at: number }>();
  return reply(row ? { payload: JSON.parse(row.payload), updatedAt: row.updated_at } : { payload: null, updatedAt: null });
}

export async function handleBackupPut(request: Request, env: ThreadsEnv, userId: string, now: number): Promise<Response> {
  const text = await request.text();
  if (text.length > MAX_BACKUP + 1024) return reply({ error: 'too_large' }, 413);
  let body: { payload?: unknown } | null = null;
  try { body = JSON.parse(text); } catch { return reply({ error: 'json' }, 400); }
  const payload = body?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return reply({ error: 'payload' }, 400);
  const serial = JSON.stringify(payload);
  if (serial.length > MAX_BACKUP) return reply({ error: 'too_large' }, 413);
  // لا روابط في النسخة: المصادر بمعرّفها فقط
  if (/https?:\/\//i.test(serial)) return reply({ error: 'urls_not_allowed' }, 400);
  await env.DB.prepare(`INSERT INTO latest_backups (user_id, payload, bytes, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, bytes = excluded.bytes, updated_at = excluded.updated_at`).bind(userId, serial, serial.length, now).run();
  return reply({ ok: true, bytes: serial.length });
}

export async function handleSignalsPost(request: Request, env: ThreadsEnv, userId: string, now: number): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { signals?: unknown } | null;
  const list = (Array.isArray(body?.signals) ? body!.signals : []).slice(0, MAX_SIGNALS);
  let accepted = 0;
  for (const raw of list) {
    const s = raw as Record<string, unknown>;
    const eventId = str(s.eventId, 300), work = str(s.work, 220), title = str(s.title, 300), sourceId = str(s.sourceId, 160), at = num(s.at);
    if (!eventId || !work || !title || !sourceId || at == null || !SECTIONS.has(String(s.section)) || !KINDS.has(String(s.kind))) continue;
    if (/https?:\/\//i.test(`${title}${sourceId}${work}`)) continue;
    const r = await env.DB.prepare(`INSERT OR IGNORE INTO latest_signals (sender_id, event_id, work, section, kind, season, number, title, source_id, at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(userId, eventId, work, s.section, s.kind, num(s.season), num(s.number), title, sourceId, Math.min(at, now), now).run();
    accepted += r.meta?.changes ?? 0;
  }
  // ترحيل مؤقت: الأقدم من 30 يومًا لا يحتاجه أحد (النتائج على الأجهزة)
  await env.DB.prepare('DELETE FROM latest_signals WHERE created_at < ?').bind(now - SIGNAL_TTL).run();
  return reply({ accepted });
}

export async function handleSignalsGet(url: URL, env: ThreadsEnv, userId: string): Promise<Response> {
  const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
  const { results } = await env.DB.prepare(`SELECT id, event_id, work, section, kind, season, number, title, source_id, at FROM latest_signals
    WHERE id > ? AND sender_id <> ? ORDER BY id ASC LIMIT 200`).bind(after, userId).all<Record<string, unknown>>();
  const rows = results ?? [];
  return reply({
    // بلا هوية المرسل: صديقك يعرف أن فصلًا نزل، لا من اكتشفه
    signals: rows.map((r: Record<string, unknown>) => ({ eventId: r.event_id, work: r.work, section: r.section, kind: r.kind, season: r.season, number: r.number, title: r.title, sourceId: r.source_id, at: r.at })),
    next: rows.length ? Number(rows[rows.length - 1]!.id) : after,
  });
}
