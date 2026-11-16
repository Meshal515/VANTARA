/**
 * إشعارات الجوال والتطبيق مغلق (الفحص الدوري كل 15 دقيقة، بلا FCM ولا خدمة خارجية).
 *
 *   POST /v1/notify/device   بالجلسة: رمز جديد لهذا الجهاز يُعطى مرة واحدة. يُحفظ HMAC فقط.
 *   DELETE /v1/notify/device بالرمز: الجهاز خرج أو أطفأ إشعارات الجوال.
 *   GET  /v1/notify/pending  بالرمز: إشعارات صاحبه غير المعروضة وغير المقروءة، نصها جاهز
 *                            (نفس صياغة التطبيق: apps/web/lib/notifications.js)، بعد إعداداته.
 *   POST /v1/notify/seen     بالرمز: عُرضت على الجوال، فلا يعيد التطبيق عرضها منبثقة.
 *
 * الرمز لا يفتح غير هذا: لا مزامنة ولا كتابة ولا حساب. يسقط بحذف الحساب (CASCADE)
 * وبإلغاء المالك أجهزة الشخص، وبخروج الجهاز.
 */

import { commitAtNextRevision } from './index.ts';
import type { Env } from './types.ts';
import { describeNotification } from '../../../apps/web/lib/notifications.js';

const MAX_DEVICES_PER_USER = 6;
const PENDING_WINDOW_MS = 3 * 86_400_000;
const PENDING_LIMIT = 20;
const encoder = new TextEncoder();

async function tokenHash(env: Env, token: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.VANTARA_DEVICE_PEPPER), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`notify:${token}`)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function newToken(): string {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return 'vn_' + btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

/** صاحب رمز الإشعارات، أو null. */
export async function notifyOwner(env: Env, request: Request, now: number): Promise<{ userId: string; hash: string } | null> {
  const header = request.headers.get('authorization') ?? '';
  const token = /^Notify\s+(vn_[A-Za-z0-9_-]{20,80})$/.exec(header)?.[1];
  if (!token) return null;
  const hash = await tokenHash(env, token);
  const row = await env.DB.prepare(
    `SELECT d.user_id FROM notify_devices d JOIN accounts a ON a.user_id = d.user_id AND a.lifecycle = 'ACTIVE' AND a.suspended_at IS NULL WHERE d.token_hash = ?`,
  ).bind(hash).first<{ user_id: string }>();
  if (!row) return null;
  await env.DB.prepare('UPDATE notify_devices SET last_used_at = ? WHERE token_hash = ?').bind(now, hash).run();
  return { userId: row.user_id, hash };
}

/** بالجلسة: رمز جديد. الأقدم يسقط فوق السقف (جهاز قديم لم يخرج). */
export async function registerNotifyDevice(env: Env, userId: string, now: number): Promise<Response> {
  const token = newToken();
  const hash = await tokenHash(env, token);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO notify_devices (token_hash, user_id, created_at, last_used_at) VALUES (?, ?, ?, NULL)').bind(hash, userId, now),
    env.DB.prepare(
      `DELETE FROM notify_devices WHERE user_id = ? AND token_hash NOT IN (
         SELECT token_hash FROM notify_devices WHERE user_id = ? ORDER BY created_at DESC LIMIT ${MAX_DEVICES_PER_USER})`,
    ).bind(userId, userId),
  ]);
  return reply({ token });
}

export async function forgetNotifyDevice(env: Env, hash: string): Promise<Response> {
  await env.DB.prepare('DELETE FROM notify_devices WHERE token_hash = ?').bind(hash).run();
  return reply({ ok: true });
}

/** إعدادات الشخص: إشعارات الجوال، والأنواع المطفأة، وإخفاء المحتوى على شاشة القفل. */
function phoneSettings(raw: string | null | undefined) {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(raw ?? '{}') as Record<string, unknown>;
  } catch {
    data = {};
  }
  const block = (data['notifications'] ?? {}) as Record<string, unknown>;
  const kinds = (block['kinds'] ?? {}) as Record<string, unknown>;
  return {
    phone: block['phone'] !== false,
    lockPreview: block['lockPreview'] === true,
    off: new Set(Object.entries(kinds).filter(([, v]) => v === false).map(([k]) => k)),
  };
}

export async function pendingNotifications(env: Env, userId: string, now: number): Promise<Response> {
  const settings = phoneSettings((await env.DB.prepare('SELECT data FROM settings WHERE user_id = ?').bind(userId).first<{ data: string }>())?.data);
  if (!settings.phone) return reply({ items: [], lockPreview: settings.lockPreview });
  const { results } = await env.DB.prepare(
    `SELECT n.id, n.kind, n.actor_id, n.series_ref, n.body, n.meta, n.link, n.created_at, p.display_name, p.avatar_key
       FROM notifications n LEFT JOIN profiles p ON p.user_id = n.actor_id
      WHERE n.user_id = ? AND n.read = 0 AND n.seen = 0 AND n.created_at >= ?
        AND (n.actor_id IS NULL OR n.actor_id != ?)
      ORDER BY n.created_at DESC LIMIT ${PENDING_LIMIT}`,
  ).bind(userId, now - PENDING_WINDOW_MS, userId).all<Record<string, unknown>>();
  const items = (results ?? [])
    .filter((r) => !settings.off.has(String(r['kind'])))
    .map((r) => {
      const actor = typeof r['display_name'] === 'string' && r['display_name'] ? (r['display_name'] as string) : 'صديق';
      const told = describeNotification(r, actor);
      return {
        id: r['id'],
        kind: r['kind'],
        group: told.group,
        title: told.title,
        body: told.body,
        // صورة الإشعار: غلاف العمل لجديد المفضلة، وصورة المرسل لغيره
        image: told.image ?? (typeof r['avatar_key'] === 'string' ? r['avatar_key'] : null),
        round: !told.image,
        link: r['link'] ?? null,
        at: r['created_at'],
      };
    });
  return reply({ items, lockPreview: settings.lockPreview });
}

export async function markNotifySeen(env: Env, userId: string, request: Request, now: number): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = (Array.isArray(body?.ids) ? body!.ids : []).filter((v): v is string => typeof v === 'string' && v.length <= 250).slice(0, PENDING_LIMIT);
  if (!ids.length) return reply({ ok: true, marked: 0 });
  await commitAtNextRevision(env, now, [], (rev) => [
    env.DB.prepare(`UPDATE notifications SET seen = 1, rev = ? WHERE user_id = ? AND seen = 0 AND id IN (${ids.map(() => '?').join(',')})`)
      .bind(rev, userId, ...ids),
  ]);
  return reply({ ok: true, marked: ids.length });
}
