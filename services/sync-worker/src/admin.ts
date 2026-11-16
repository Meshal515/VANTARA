/**
 * لوحة المالك داخل VANTARA (قرار المالك، 16 نوفمبر 2026). كل عملية هنا تتحقق من شارة
 * المالك في القاعدة نفسها (`accounts.badge = 'owner'`)، لا من الواجهة.
 *
 *   GET  /v1/admin/accounts   كل الحسابات: الحالة، الإيقاف، الـPIN، الأجهزة، آخر استعمال.
 *   POST /v1/admin/pin-key    { userId } مفتاح استعادة PIN لمرة واحدة (24 ساعة). يُرى مرة.
 *   POST /v1/admin/suspend    { userId, on } إيقاف أو إعادة: لا جلسة جديدة ولا إشعارات جوال.
 *   POST /v1/admin/signout    { userId } إخراج من كل الأجهزة: يُلغى اعتمادها ورموز الإشعارات.
 *   POST /v1/admin/delete     { userId } حذف الحساب بلا PIN صاحبه (نفس المهلة ثم المسح النهائي).
 *
 * المالك لا يطبّق شيئًا من هذا على نفسه: لا يقفل نفسه خارج التطبيق بالخطأ.
 */

import { commitAtNextRevision } from './index.ts';
import { DELETE_GRACE_MS, DELETE_NETWORK_ALLOWANCE_MS, lifecycleOf } from './accounts.ts';
import type { Env } from './types.ts';

const KEY_TTL_MS = 24 * 3_600_000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const encoder = new TextEncoder();

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

async function keyHash(env: Env, userId: string, key: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', encoder.encode(env.VANTARA_DEVICE_PEPPER), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, encoder.encode(`pin-reset:${userId}:${key}`)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** VNTR-XXXX-XXXX-XXXX-XXXX: 80 بت، حروف لا تلتبس (لا O/0 ولا I/1). */
function newKey(): string {
  const raw = crypto.getRandomValues(new Uint8Array(16));
  const chars = [...raw].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `VNTR-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${chars.slice(12, 16)}`;
}

/** ما يكتبه الشخص: مسافات وحروف صغيرة وشرطات ناقصة لا تُفشل مفتاحًا صحيحًا. */
export function normalizeResetKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const bare = value.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^VNTR/, '');
  if (bare.length !== 16 || [...bare].some((c) => !ALPHABET.includes(c))) return null;
  return `VNTR-${bare.slice(0, 4)}-${bare.slice(4, 8)}-${bare.slice(8, 12)}-${bare.slice(12, 16)}`;
}

/**
 * مفتاح صحيح لم ينتهِ ⇒ يُستهلك ويُزال الـPIN في معاملة واحدة (لا يُستعمل مرتين). يُرجع true عند النجاح.
 */
export async function consumeResetKey(env: Env, userId: string, raw: unknown, now: number): Promise<boolean> {
  const key = normalizeResetKey(raw);
  if (!key) return false;
  const hash = await keyHash(env, userId, key);
  const used = await env.DB.prepare('DELETE FROM pin_reset_keys WHERE user_id = ? AND key_hash = ? AND expires_at > ? RETURNING user_id')
    .bind(userId, hash, now).first<{ user_id: string }>();
  if (!used) return false;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM account_pins WHERE user_id = ?').bind(userId),
    env.DB.prepare('UPDATE trusted_devices SET pin_grant_hash = NULL WHERE user_id = ?').bind(userId),
  ]);
  return true;
}

export async function isOwner(env: Env, userId: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT 1 AS ok FROM accounts WHERE user_id = ? AND badge = 'owner' AND lifecycle = 'ACTIVE'").bind(userId).first<{ ok: number }>();
  return Boolean(row);
}

export async function isSuspended(env: Env, userId: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT suspended_at FROM accounts WHERE user_id = ?').bind(userId).first<{ suspended_at: number | null }>();
  return Boolean(row?.suspended_at);
}

async function target(env: Env, body: Record<string, unknown> | null, ownerId: string) {
  const userId = typeof body?.['userId'] === 'string' ? body['userId'] : '';
  if (!userId) return { error: reply({ error: 'bad_request' }, 400) };
  if (userId === ownerId) return { error: reply({ error: 'not_on_self' }, 409) };
  const state = await lifecycleOf(env, userId);
  if (!state || state.lifecycle === 'DELETED') return { error: reply({ error: 'unknown_account' }, 404) };
  return { userId, state };
}

export async function adminRoute(path: string, request: Request, env: Env, now: number, ownerId: string): Promise<Response | null> {
  if (!path.startsWith('/v1/admin/')) return null;
  if (!(await isOwner(env, ownerId))) return reply({ error: 'owner_only' }, 403);

  if (path === '/v1/admin/accounts' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT a.user_id, a.username, a.lifecycle, a.badge, a.suspended_at, a.created_at, p.display_name, p.avatar_key,
              (SELECT digits FROM account_pins k WHERE k.user_id = a.user_id) AS pin_digits,
              (SELECT COUNT(*) FROM trusted_devices t WHERE t.user_id = a.user_id AND t.revoked_at IS NULL) AS devices,
              (SELECT MAX(last_used_at) FROM trusted_devices t WHERE t.user_id = a.user_id) AS last_seen,
              (SELECT expires_at FROM pin_reset_keys r WHERE r.user_id = a.user_id AND r.expires_at > ?) AS key_expires
         FROM accounts a LEFT JOIN profiles p USING (user_id)
        WHERE a.lifecycle != 'DELETED'
        ORDER BY a.created_at`,
    ).bind(now).all<Record<string, unknown>>();
    return reply({
      accounts: (results ?? []).map((r) => ({
        userId: r['user_id'],
        username: r['username'],
        displayName: r['display_name'] ?? r['username'],
        avatarKey: r['avatar_key'] ?? null,
        owner: r['badge'] === 'owner',
        lifecycle: r['lifecycle'],
        suspended: Boolean(r['suspended_at']),
        pin: r['pin_digits'] ?? null,
        devices: Number(r['devices'] ?? 0),
        lastSeen: r['last_seen'] ?? null,
        keyExpires: r['key_expires'] ?? null,
      })),
    });
  }

  if (request.method !== 'POST') return reply({ error: 'not_found' }, 404);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const t = await target(env, body, ownerId);
  if ('error' in t) return t.error;

  if (path === '/v1/admin/pin-key') {
    const key = newKey();
    await env.DB.prepare(
      `INSERT INTO pin_reset_keys (user_id, key_hash, expires_at, created_at, created_by) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET key_hash = excluded.key_hash, expires_at = excluded.expires_at,
         created_at = excluded.created_at, created_by = excluded.created_by`,
    ).bind(t.userId, await keyHash(env, t.userId, key), now + KEY_TTL_MS, now, ownerId).run();
    return reply({ key, expiresAt: now + KEY_TTL_MS });
  }
  if (path === '/v1/admin/suspend') {
    const on = body?.['on'] !== false;
    await env.DB.batch([
      env.DB.prepare('UPDATE accounts SET suspended_at = ? WHERE user_id = ?').bind(on ? now : null, t.userId),
      ...(on ? [env.DB.prepare('DELETE FROM notify_devices WHERE user_id = ?').bind(t.userId)] : []),
    ]);
    return reply({ ok: true, suspended: on });
  }
  if (path === '/v1/admin/signout') {
    await env.DB.batch([
      env.DB.prepare('UPDATE trusted_devices SET revoked_at = ?, pin_grant_hash = NULL WHERE user_id = ? AND revoked_at IS NULL').bind(now, t.userId),
      env.DB.prepare('DELETE FROM notify_devices WHERE user_id = ?').bind(t.userId),
    ]);
    return reply({ ok: true });
  }
  if (path === '/v1/admin/delete') {
    if (t.state.lifecycle !== 'ACTIVE') return reply({ error: 'not_active', state: t.state.lifecycle }, 409);
    const purgeAfter = now + DELETE_GRACE_MS + DELETE_NETWORK_ALLOWANCE_MS;
    await commitAtNextRevision(env, now, [], (rev) => [
      env.DB.prepare(
        `UPDATE accounts SET lifecycle = 'PENDING_DELETE', delete_requested_at = ?, purge_after = ?, rev = ?
          WHERE user_id = ? AND lifecycle = 'ACTIVE'`,
      ).bind(now, purgeAfter, rev, t.userId),
      env.DB.prepare('DELETE FROM notify_devices WHERE user_id = ?').bind(t.userId),
    ]);
    return reply({ ok: true, state: 'PENDING_DELETE', purgeAfter });
  }
  return reply({ error: 'not_found' }, 404);
}
