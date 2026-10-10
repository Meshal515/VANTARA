/**
 * دورة حياة الحساب: إضافة حساب، رمز PIN اختياري، وحذف بتراجع.
 *
 * الهوية = `user_id` وحده: يُولَّد هنا مرة (UUID عشوائي) ولا يتغير أبدًا، وكل
 * علاقة في القاعدة معلّقة عليه. الاسم الظاهر والصورة وusername والـPIN قابلة
 * للتغيير ولا تمس الهوية.
 *
 *   إضافة       avatar + displayName + username فريد ⇒ user_id جديد. السقف
 *               عشرة حسابات، يُفرض داخل عبارة الإدراج نفسها (لا سباق).
 *   PIN         4 أو 6 أرقام. لا نص صريح: HMAC(pepper، salt+pin). المحاولات
 *               الخاطئة تُقفل بتصاعد (دقيقة ← 5 ← 15 ← ساعة). الـPIN يُفحص عند
 *               إصدار الجلسة نفسها، فلا جلسة لحساب محمي بلا PIN أو إذن منه.
 *   حذف         ACTIVE → PENDING_DELETE (بعد PIN) → مهلة عشر ثوانٍ → DELETED.
 *               في المهلة لا يُمسح شيء ولا يتحرر username: الحساب يختفي من
 *               القوائم ولا تُصدر له جلسة، والتراجع يعيده ACTIVE فورًا. بعد
 *               المهلة فقط يبدأ المسح النهائي: كل بياناته، ثم username يتحرر،
 *               وصف الهوية نفسه (نفس الـUUID) يبقى شاهد قبر يصل كل جهاز.
 */

import { commitAtNextRevision } from './index.ts';
import type { D1PreparedStatement, Env } from './types.ts';

export const MAX_ACCOUNTS = 10;
/** مهلة التراجع كما يراها المستخدم. */
export const DELETE_GRACE_MS = 10_000;
/**
 * هامش الشبكة: «تراجع» ضُغط في الثانية التاسعة قد يصل بعد العاشرة. فالمسح لا
 * يبدأ قبل المهلة + هذا الهامش، والتراجع مقبول حتى نهايته — لا يُمسح شيء قبل
 * أن تنتهي المهلة التي رآها المستخدم أبدًا.
 */
export const DELETE_NETWORK_ALLOWANCE_MS = 2_000;
export type Lifecycle = 'ACTIVE' | 'PENDING_DELETE' | 'DELETED';
const USERNAME = /^[a-z0-9_.]{3,20}$/;
const PIN = /^(\d{4}|\d{6})$/;
/** بعد كل 5 محاولات خاطئة: قفل يتصاعد. */
const LOCKS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

const encoder = new TextEncoder();

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(bytes = 32): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** مقارنة بزمن ثابت بين سلسلتين hex بالطول نفسه. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const pepperOf = (env: Env) => env.VANTARA_DEVICE_PEPPER;

export function normalizeUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const u = value.trim().replace(/^@/, '').toLowerCase();
  return USERNAME.test(u) ? u : null;
}

export function validPin(value: unknown): value is string {
  return typeof value === 'string' && PIN.test(value);
}

interface PinRow {
  pin_hash: string;
  salt: string;
  digits: number;
  failed: number;
  locked_until: number;
}

export async function pinOf(env: Env, userId: string): Promise<PinRow | null> {
  return env.DB.prepare('SELECT pin_hash, salt, digits, failed, locked_until FROM account_pins WHERE user_id = ?')
    .bind(userId)
    .first<PinRow>();
}

export type PinCheck = { ok: true } | { ok: false; error: 'pin_wrong' | 'pin_locked'; retryAt?: number; digits: number };

/** يفحص الـPIN ويحدّث عدّاد المحاولات. حساب بلا PIN ⇒ ok. */
export async function checkPin(env: Env, userId: string, pin: unknown, now: number): Promise<PinCheck> {
  const row = await pinOf(env, userId);
  if (!row) return { ok: true };
  if (row.locked_until > now) return { ok: false, error: 'pin_locked', retryAt: row.locked_until, digits: row.digits };
  const given = typeof pin === 'string' ? pin : '';
  const hash = await hmacHex(pepperOf(env), `pin:${row.salt}:${given}`);
  if (validPin(given) && given.length === row.digits && sameHex(hash, row.pin_hash)) {
    if (row.failed || row.locked_until) {
      await env.DB.prepare('UPDATE account_pins SET failed = 0, locked_until = 0 WHERE user_id = ?').bind(userId).run();
    }
    return { ok: true };
  }
  const failed = row.failed + 1;
  const lockedUntil = failed % 5 === 0 ? now + LOCKS_MS[Math.min(failed / 5 - 1, LOCKS_MS.length - 1)]! : 0;
  await env.DB.prepare('UPDATE account_pins SET failed = ?, locked_until = ? WHERE user_id = ?').bind(failed, lockedUntil, userId).run();
  return lockedUntil
    ? { ok: false, error: 'pin_locked', retryAt: lockedUntil, digits: row.digits }
    : { ok: false, error: 'pin_wrong', digits: row.digits };
}

/** إذن الجهاز بعد PIN صحيح: يُرجع للعميل مرة، ويُخزَّن هنا مُجزّأً فقط. */
export async function grantPin(env: Env, deviceId: string, userId: string): Promise<string> {
  const grant = randomToken();
  await env.DB.prepare('UPDATE trusted_devices SET pin_grant_hash = ? WHERE device_id = ? AND user_id = ?')
    .bind(await hmacHex(pepperOf(env), `grant:${grant}`), deviceId, userId)
    .run();
  return grant;
}

export async function grantValid(env: Env, deviceId: string, userId: string, grant: unknown): Promise<boolean> {
  if (typeof grant !== 'string' || grant.length < 16) return false;
  const row = await env.DB.prepare('SELECT pin_grant_hash FROM trusted_devices WHERE device_id = ? AND user_id = ? AND revoked_at IS NULL')
    .bind(deviceId, userId)
    .first<{ pin_grant_hash: string | null }>();
  if (!row?.pin_grant_hash) return false;
  return sameHex(row.pin_grant_hash, await hmacHex(pepperOf(env), `grant:${grant}`));
}

// ───────────────────────── الإضافة ─────────────────────────

export type CreateResult =
  | { ok: true; account: { userId: string; username: string; displayName: string; avatarKey: string | null } }
  | { ok: false; status: number; error: 'bad_username' | 'bad_name' | 'username_taken' | 'limit_reached' };

export async function createAccount(env: Env, now: number, input: Record<string, unknown> | null): Promise<CreateResult> {
  const username = normalizeUsername(input?.['username']);
  if (!username) return { ok: false, status: 400, error: 'bad_username' };
  const displayName = typeof input?.['displayName'] === 'string' ? input['displayName'].trim().replace(/\s+/g, ' ') : '';
  if (!displayName || [...displayName].length > 32) return { ok: false, status: 400, error: 'bad_name' };
  const rawAvatar = input?.['avatarKey'];
  const avatarKey = typeof rawAvatar === 'string' && rawAvatar.length > 0 && rawAvatar.length <= 512 ? rawAvatar : null;
  const userId = crypto.randomUUID();
  const exists = 'EXISTS (SELECT 1 FROM accounts WHERE user_id = ?)';

  await commitAtNextRevision(env, now, [], (rev) => [
    // السقف والتفرّد داخل العبارة نفسها: D1 تنفّذ الدفعة معاملة واحدة متسلسلة،
    // فلا يستطيع طلبان متزامنان أن يتجاوزا العشرة معًا
    env.DB.prepare(
      `INSERT INTO accounts (user_id, username, created_at, rev)
       SELECT ?, ?, ?, ?
        WHERE (SELECT COUNT(*) FROM accounts WHERE lifecycle != 'DELETED') < ?
          AND NOT EXISTS (SELECT 1 FROM accounts WHERE username = ?)`,
    ).bind(userId, username, now, rev, MAX_ACCOUNTS, username),
    env.DB.prepare(
      `INSERT INTO profiles (user_id, display_name, avatar_key, field_revs, rev)
       SELECT ?, ?, ?, '{}', ? WHERE ${exists}`,
    ).bind(userId, displayName, avatarKey, rev, userId),
    env.DB.prepare(`INSERT INTO presence (user_id, status, beat_at) SELECT ?, 'OFFLINE', 0 WHERE ${exists}`).bind(userId, userId),
    env.DB.prepare(`INSERT INTO settings (user_id, data, field_revs, rev) SELECT ?, '{}', '{}', ? WHERE ${exists}`).bind(userId, rev, userId),
    // نفس نموذج الاعتماد الحالي: الجهاز المعتمد يثق بكل حسابات المجموعة، فالحساب
    // الجديد يُفتح من كل جهاز معتمد الآن بلا اعتماد جديد
    env.DB.prepare(
      `INSERT OR IGNORE INTO trusted_devices (device_id, user_id, credential_hash, created_at, last_used_at, revoked_at)
       SELECT device_id, ?, MAX(credential_hash), ?, ?, NULL
         FROM trusted_devices
        WHERE revoked_at IS NULL AND ${exists}
        GROUP BY device_id`,
    ).bind(userId, now, now, userId),
  ]);

  const created = await env.DB.prepare('SELECT 1 AS ok FROM accounts WHERE user_id = ?').bind(userId).first<{ ok: number }>();
  if (!created) {
    const taken = await env.DB.prepare('SELECT 1 AS ok FROM accounts WHERE username = ?').bind(username).first<{ ok: number }>();
    return taken ? { ok: false, status: 409, error: 'username_taken' } : { ok: false, status: 409, error: 'limit_reached' };
  }
  return { ok: true, account: { userId, username, displayName, avatarKey } };
}

// ───────────────────────── PIN ─────────────────────────

export type PinResult = { ok: true; pinGrant?: string; enabled: boolean; digits?: number } | ({ ok: false; status: number } & Record<string, unknown>);

/** set (أول مرة أو تغيير بالقديم) أو remove (بالحالي). */
export async function updatePin(env: Env, now: number, userId: string, deviceId: string, input: Record<string, unknown> | null): Promise<PinResult> {
  const action = input?.['action'];
  const existing = await pinOf(env, userId);
  if (existing) {
    const check = await checkPin(env, userId, input?.['currentPin'], now);
    if (!check.ok) return { ...check, ok: false, status: check.error === 'pin_locked' ? 429 : 401 };
  }
  if (action === 'remove') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM account_pins WHERE user_id = ?').bind(userId),
      env.DB.prepare('UPDATE trusted_devices SET pin_grant_hash = NULL WHERE user_id = ?').bind(userId),
    ]);
    return { ok: true, enabled: false };
  }
  if (action !== 'set') return { ok: false, status: 400, error: 'bad_request' };
  const pin = input?.['pin'];
  if (!validPin(pin)) return { ok: false, status: 400, error: 'bad_pin' };
  const salt = randomToken(16);
  const hash = await hmacHex(pepperOf(env), `pin:${salt}:${pin}`);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO account_pins (user_id, pin_hash, salt, digits, failed, locked_until, updated_at)
       VALUES (?, ?, ?, ?, 0, 0, ?)
       ON CONFLICT (user_id) DO UPDATE SET pin_hash = excluded.pin_hash, salt = excluded.salt,
         digits = excluded.digits, failed = 0, locked_until = 0, updated_at = excluded.updated_at`,
    ).bind(userId, hash, salt, pin.length, now),
    // PIN جديد ⇒ كل جهاز آخر يُسأل من جديد
    env.DB.prepare('UPDATE trusted_devices SET pin_grant_hash = NULL WHERE user_id = ?').bind(userId),
  ]);
  return { ok: true, enabled: true, digits: pin.length, pinGrant: await grantPin(env, deviceId, userId) };
}

// ───────────────────────── الحذف ─────────────────────────

export type DeleteResult =
  | { ok: true; state: 'PENDING_DELETE'; graceMs: number; purgeAfter: number }
  | ({ ok: false; status: number } & Record<string, unknown>);

/** PIN صحيح ⇒ PENDING_DELETE. لا يُمسح شيء ولا تُلغى الأجهزة: التراجع قلب حالة لا استعادة. */
export async function requestDeletion(env: Env, now: number, userId: string, pin: unknown): Promise<DeleteResult> {
  const check = await checkPin(env, userId, pin, now);
  if (!check.ok) return { ...check, ok: false, status: check.error === 'pin_locked' ? 429 : 401 };
  const purgeAfter = now + DELETE_GRACE_MS + DELETE_NETWORK_ALLOWANCE_MS;
  await commitAtNextRevision(env, now, [], (rev) => [
    env.DB.prepare(
      `UPDATE accounts SET lifecycle = 'PENDING_DELETE', delete_requested_at = ?, purge_after = ?, rev = ?
        WHERE user_id = ? AND lifecycle = 'ACTIVE'`,
    ).bind(now, purgeAfter, rev, userId),
  ]);
  const row = await lifecycleOf(env, userId);
  if (row?.lifecycle !== 'PENDING_DELETE') return { ok: false, status: 409, error: 'not_active', state: row?.lifecycle ?? null };
  return { ok: true, state: 'PENDING_DELETE', graceMs: Math.max(0, (row.purge_after ?? purgeAfter) - DELETE_NETWORK_ALLOWANCE_MS - now), purgeAfter: row.purge_after ?? purgeAfter };
}

/** «تراجع»: يعيده ACTIVE فورًا ما دامت المهلة قائمة. الشرط داخل UPDATE نفسه فلا سباق مع المسح. */
export async function cancelDeletion(env: Env, now: number, userId: string): Promise<boolean> {
  await commitAtNextRevision(env, now, [], (rev) => [
    env.DB.prepare(
      `UPDATE accounts SET lifecycle = 'ACTIVE', delete_requested_at = NULL, purge_after = NULL, rev = ?
        WHERE user_id = ? AND lifecycle = 'PENDING_DELETE' AND purge_after > ?`,
    ).bind(rev, userId, now),
  ]);
  return (await lifecycleOf(env, userId))?.lifecycle === 'ACTIVE';
}

export async function lifecycleOf(env: Env, userId: string) {
  return env.DB.prepare('SELECT lifecycle, purge_after, username FROM accounts WHERE user_id = ?')
    .bind(userId)
    .first<{ lifecycle: Lifecycle; purge_after: number | null; username: string }>();
}

/** كل جدول يحمل بيانات شخص، بعموده. اختبار «لا بيانات يتيمة» يمسح القاعدة كلها بحثًا عن الـUUID. */
const PERSONAL: ReadonlyArray<readonly [string, string]> = [
  ['profiles', 'user_id'], ['presence', 'user_id'], ['library', 'user_id'], ['progress', 'user_id'],
  ['chapter_reads', 'user_id'], ['usage_daily', 'user_id'], ['collections', 'user_id'],
  ['ratings', 'user_id'], ['reactions', 'user_id'], ['comments', 'author_id'],
  ['recommendation_recipients', 'user_id'], ['recommendations', 'from_id'], ['recommendations', 'to_id'],
  ['notifications', 'user_id'], ['activity_receipts', 'user_id'], ['activity', 'actor_id'], ['activity', 'target_user_id'],
  ['settings', 'user_id'],
  ['pairing_tokens', 'user_id'], ['frames', 'from_id'], ['frames', 'to_id'], ['chapter_marks', 'user_id'],
  ['media', 'owner_id'], ['majlis_reactions', 'user_id'], ['majlis_receipts', 'user_id'], ['work_views', 'user_id'],
  ['public_work_views', 'user_id'], ['completions', 'user_id'], ['translation_usage', 'user_id'],
  ['translation_usage_chapters', 'user_id'], ['translation_creator_totals', 'created_by'],
  ['rafiq_messages', 'user_id'], ['rafiq_conversations', 'user_id'],
  ['rafiq_prefs', 'user_id'], ['rafiq_recs', 'user_id'], ['rafiq_profile', 'user_id'], ['rafiq_usage', 'user_id'],
  ['rafiq_external', 'user_id'], ['majlis_message_receipts', 'user_id'], ['majlis_messages', 'sender_id'],
  ['majlis_hidden', 'user_id'], ['majlis_reads', 'user_id'], ['usage_sections', 'user_id'], ['work_insights', 'user_id'],
  ['view_privacy', 'user_id'], ['together_invites', 'host_id'], ['account_pins', 'user_id'], ['trusted_devices', 'user_id'], ['applied_ops', 'user_id'],
];

/**
 * ما يخص الآخرين ويشير إلى محتوى الحساب (تفاعل على رسالته، إيصال لتوصيته):
 * يُمسح قبل المحتوى نفسه، وإلا بقي يتيمًا يشير إلى لا شيء.
 */
const DEPENDENT: ReadonlyArray<string> = [
  "DELETE FROM reactions WHERE comment_id IN (SELECT id FROM comments WHERE author_id = ?)",
  "DELETE FROM recommendation_recipients WHERE recommendation_id IN (SELECT id FROM recommendations WHERE from_id = ?)",
  "DELETE FROM activity_receipts WHERE event_id IN (SELECT id FROM activity WHERE actor_id = ?)",
  "DELETE FROM majlis_reactions WHERE target_kind = 'frame' AND target_id IN (SELECT id FROM frames WHERE from_id = ?)",
  "DELETE FROM majlis_reactions WHERE target_kind = 'rec' AND target_id IN (SELECT id FROM recommendations WHERE from_id = ?)",
  "DELETE FROM majlis_reactions WHERE target_kind = 'activity' AND target_id IN (SELECT id FROM activity WHERE actor_id = ?)",
  "DELETE FROM majlis_reactions WHERE target_kind = 'message' AND target_id IN (SELECT id FROM majlis_messages WHERE sender_id = ?)",
  "DELETE FROM majlis_receipts WHERE target_kind = 'frame' AND target_id IN (SELECT id FROM frames WHERE from_id = ?)",
  "DELETE FROM majlis_receipts WHERE target_kind = 'rec' AND target_id IN (SELECT id FROM recommendations WHERE from_id = ?)",
  "DELETE FROM majlis_receipts WHERE target_kind = 'activity' AND target_id IN (SELECT id FROM activity WHERE actor_id = ?)",
  "DELETE FROM majlis_message_receipts WHERE message_id IN (SELECT id FROM majlis_messages WHERE sender_id = ?)",
];

/** إشارات بلا ملكية: تُفرّغ ولا يُمسح صاحبها (رسالة غيره حذفها هو، اسم المجلس، صفحة ترجمة مشتركة). */
const DETACH: ReadonlyArray<string> = [
  'UPDATE notifications SET actor_id = NULL WHERE actor_id = ?',
  'UPDATE majlis_messages SET deleted_by = NULL WHERE deleted_by = ?',
  'UPDATE majlis_meta SET updated_by = NULL WHERE updated_by = ?',
  "UPDATE translation_pages SET created_by = '~deleted' WHERE created_by = ?",
  "UPDATE cinema_overviews SET created_by = '~deleted' WHERE created_by = ?",
];

/**
 * المسح النهائي، بعد المهلة فقط. أول عبارة تقلب الحالة إلى DELETED بشرط أن
 * المهلة انتهت والحساب ما زال PENDING_DELETE؛ وكل ما بعدها مشروط بأنها نجحت.
 * الدفعة معاملة واحدة، فالتراجع والمسح لا يتداخلان: أحدهما يسبق ويُبطل الآخر.
 */
export async function purgeAccount(env: Env, now: number, userId: string): Promise<boolean> {
  const row = await lifecycleOf(env, userId);
  if (row?.lifecycle !== 'PENDING_DELETE' || (row.purge_after ?? Infinity) > now) return false;
  const gone = "EXISTS (SELECT 1 FROM accounts WHERE user_id = ? AND lifecycle = 'DELETED')";
  await commitAtNextRevision(env, now, [], (rev) => [
    env.DB.prepare(
      `UPDATE accounts SET lifecycle = 'DELETED', deleted_at = ?, username = '~' || user_id, badge = NULL,
              delete_requested_at = NULL, purge_after = NULL, rev = ?
        WHERE user_id = ? AND lifecycle = 'PENDING_DELETE' AND purge_after <= ?`,
    ).bind(now, rev, userId, now),
    ...wipeStatements(env, userId, gone),
  ]);
  return (await lifecycleOf(env, userId))?.lifecycle === 'DELETED';
}

function wipeStatements(env: Env, userId: string, guard: string): D1PreparedStatement[] {
  return [
    ...DEPENDENT.map((sql) => env.DB.prepare(`${sql} AND ${guard}`).bind(userId, userId)),
    ...DETACH.map((sql) => env.DB.prepare(`${sql} AND ${guard}`).bind(userId, userId)),
    ...PERSONAL.map(([table, column]) => env.DB.prepare(`DELETE FROM ${table} WHERE ${column} = ? AND ${guard}`).bind(userId, userId)),
  ];
}

/**
 * ما انتهت مهلته يُمسح (المؤقت كل دقيقة، وقائمة «من يتابع؟»، وطلب الجهاز
 * نفسه). وتُعاد كنسُ شواهد القبر الحديثة: كتابة بتوكن قديم سبقت المسح بلحظة
 * لا تبقى يتيمة.
 */
export async function purgeExpired(env: Env, now: number): Promise<number> {
  const { results } = await env.DB.prepare(
    "SELECT user_id FROM accounts WHERE lifecycle = 'PENDING_DELETE' AND purge_after <= ?",
  )
    .bind(now)
    .all<{ user_id: string }>();
  for (const { user_id } of results) await purgeAccount(env, now, user_id);
  const recent = await env.DB.prepare("SELECT user_id FROM accounts WHERE lifecycle = 'DELETED' AND deleted_at > ?")
    .bind(now - 60 * 60_000)
    .all<{ user_id: string }>();
  for (const { user_id } of recent.results) {
    await env.DB.batch(wipeStatements(env, user_id, "EXISTS (SELECT 1 FROM accounts WHERE user_id = ? AND lifecycle = 'DELETED')"));
  }
  return results.length;
}

export async function activeCount(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts WHERE lifecycle = 'ACTIVE'").first<{ n: number }>();
  return Number(row?.n ?? 0);
}
