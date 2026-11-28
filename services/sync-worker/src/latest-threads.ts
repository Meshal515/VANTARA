/**
 * الخيطان الرفيعان لآخر التحديثات المحلي (خطة 27 نوفمبر، المرحلة 7). الخادم لا يكشف ولا يقرر:
 * - نسخة الحساب: ملخص صغير لصاحبه وحده (≤256KB)، يُستعاد في تثبيت جديد فلا يضيع ما كشفه جهازه.
 * - إشارات الأصحاب: حدث اكتشفه جهاز يصل لبقية حسابات النسخة، بلا روابط وبلا هوية المرسل في الرد. جهاز المستقبل
 *   يقبلها لمصدر مثبت عنده فقط ويمررها على قراره هو (لغته وسياسته)، فلا يطرق المصدر نفسه مرة ثانية.
 */
import type { D1Database } from './types.ts';

export interface ThreadsEnv { DB: D1Database }

const MAX_BACKUP = 256 * 1024;
/** حد صريح لا تقليم صامت: ما زاد يُرفض برمز quota ويبقى في جهازه. */
const MAX_BACKUP_EVENTS = 50_000;
const MAX_EVENT_BYTES = 4 * 1024;
const MAX_UPLOAD = 100;
const PAGE = 500;
const MAX_SIGNALS = 100;
const SIGNAL_TTL = 30 * 86_400_000;
const SECTIONS = new Set(['manga', 'anime', 'cinema']);
const KINDS = new Set(['chapter', 'episode', 'movie']);
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * النسخة كلها صفحة صفحة: الصف القديم (رفع الإصدارات السابقة) في الصفحة الأولى، ثم الأحداث بترتيب (at, id). الجهاز يدمج
 * بالمعرّف، فالتكرار بين الاثنين لا يضر.
 */
export async function handleBackupGet(env: ThreadsEnv, userId: string, url?: URL): Promise<Response> {
  const cursor = url?.searchParams.get('after') ?? '';
  const [afterAt, afterId] = cursor ? [Number(cursor.split('|')[0]) || 0, cursor.slice(cursor.indexOf('|') + 1)] : [-1, ''];
  const legacy = cursor ? null : await env.DB.prepare('SELECT payload, updated_at FROM latest_backups WHERE user_id = ?').bind(userId).first<{ payload: string; updated_at: number }>();
  const { results } = await env.DB.prepare(`SELECT event_id, payload, at FROM latest_backup_events WHERE user_id = ? AND (at > ? OR (at = ? AND event_id > ?))
    ORDER BY at ASC, event_id ASC LIMIT ?`).bind(userId, afterAt, afterAt, afterId, PAGE).all<{ event_id: string; payload: string; at: number }>();
  const rows = results ?? [];
  const legacyEvents = legacy ? ((JSON.parse(legacy.payload) as { events?: unknown[] }).events ?? []) : [];
  const events = [...legacyEvents, ...rows.map((r) => JSON.parse(r.payload))];
  const last = rows[rows.length - 1];
  return reply({
    payload: legacy || rows.length ? { v: 2, events } : null,
    updatedAt: legacy?.updated_at ?? null,
    next: rows.length === PAGE && last ? `${last.at}|${last.event_id}` : null,
  });
}

/** حدث النسخة كما يرفعه الجهاز (بلا روابط): يُقبل بمعرّفه ووقته وحجم محدود، وإلا يُرفض صراحة لا يُقلَّم. */
function backupEvent(raw: unknown): { id: string; at: number; serial: string } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  const id = str(e.id, 300), at = num(e.at);
  if (!id || at == null) return null;
  const serial = JSON.stringify(e);
  if (serial.length > MAX_EVENT_BYTES || /https?:\/\//i.test(serial)) return null;
  return { id, at, serial };
}

/**
 * النسخة القديمة (جهاز بإصدار سابق يرفع كل شيء دفعة): تُدمج بالمعرّف مع ما عندنا ولا تستبدله. كان كل رفع يمحو ما رفعه
 * جهاز آخر لصاحب الحساب نفسه.
 */
export async function handleBackupPut(request: Request, env: ThreadsEnv, userId: string, now: number): Promise<Response> {
  const text = await request.text();
  if (text.length > MAX_BACKUP + 1024) return reply({ error: 'too_large' }, 413);
  let body: { payload?: unknown } | null = null;
  try { body = JSON.parse(text); } catch { return reply({ error: 'json' }, 400); }
  const payload = body?.payload as { events?: unknown } | undefined;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return reply({ error: 'payload' }, 400);
  if (/https?:\/\//i.test(JSON.stringify(payload))) return reply({ error: 'urls_not_allowed' }, 400);
  const events = (Array.isArray(payload.events) ? payload.events : []).map(backupEvent).filter((e): e is { id: string; at: number; serial: string } => e !== null);
  const written = await upsertEvents(env, userId, events, now);
  return written < 0 ? reply({ error: 'quota', limit: MAX_BACKUP_EVENTS }, 409) : reply({ ok: true, events: written });
}

/** الرفع التفاضلي: ما لم يُرفع بعد، حتى 100 حدث في الطلب، بدفعة D1 واحدة. */
export async function handleBackupEventsPost(request: Request, env: ThreadsEnv, userId: string, now: number): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { events?: unknown } | null;
  const raw = Array.isArray(body?.events) ? body!.events : null;
  if (!raw || raw.length > MAX_UPLOAD) return reply({ error: 'events' }, 400);
  const events = raw.map(backupEvent);
  // حدث مرفوض يُقال مع رقمه؛ لا يضيع وسط الدفعة بصمت
  const rejected = events.flatMap((e, i) => (e ? [] : [i]));
  const written = await upsertEvents(env, userId, events.filter((e): e is { id: string; at: number; serial: string } => e !== null), now);
  return written < 0 ? reply({ error: 'quota', limit: MAX_BACKUP_EVENTS }, 409) : reply({ ok: true, events: written, rejected });
}

async function upsertEvents(env: ThreadsEnv, userId: string, events: { id: string; at: number; serial: string }[], now: number): Promise<number> {
  if (!events.length) return 0;
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM latest_backup_events WHERE user_id = ?').bind(userId).first<{ n: number }>();
  if ((count?.n ?? 0) + events.length > MAX_BACKUP_EVENTS) return -1;
  await env.DB.batch(events.map((e) => env.DB.prepare(`INSERT INTO latest_backup_events (user_id, event_id, payload, at, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, event_id) DO UPDATE SET payload = excluded.payload, at = excluded.at, updated_at = excluded.updated_at`).bind(userId, e.id, e.serial, e.at, now)));
  return events.length;
}

export async function handleSignalsPost(request: Request, env: ThreadsEnv, userId: string, now: number): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { signals?: unknown } | null;
  const list = (Array.isArray(body?.signals) ? body!.signals : []).slice(0, MAX_SIGNALS);
  const statements = [];
  for (const raw of list) {
    const s = raw as Record<string, unknown>;
    const eventId = str(s.eventId, 300), work = str(s.work, 220), title = str(s.title, 300), sourceId = str(s.sourceId, 160), at = num(s.at);
    if (!eventId || !work || !title || !sourceId || at == null || !SECTIONS.has(String(s.section)) || !KINDS.has(String(s.kind))) continue;
    if (/https?:\/\//i.test(`${title}${sourceId}${work}`)) continue;
    statements.push(env.DB.prepare(`INSERT OR IGNORE INTO latest_signals (sender_id, event_id, work, section, kind, season, number, title, source_id, at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(userId, eventId, work, s.section, s.kind, num(s.season), num(s.number), title, sourceId, Math.min(at, now), now));
  }
  // ترحيل مؤقت: الأقدم من 30 يومًا لا يحتاجه أحد (النتائج على الأجهزة). كل الإدراجات والتنظيف دفعة D1 واحدة (كان طلبًا لكل إشارة)
  statements.push(env.DB.prepare('DELETE FROM latest_signals WHERE created_at < ?').bind(now - SIGNAL_TTL));
  const results = await env.DB.batch(statements);
  const accepted = results.slice(0, -1).reduce((n, r) => n + Number((r as { meta?: { changes?: number } }).meta?.changes ?? 0), 0);
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
