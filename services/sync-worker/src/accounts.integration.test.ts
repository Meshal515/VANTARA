/**
 * دورة حياة الحساب على D1 حقيقية (SQLite بكل الهجرات): إضافة حساب، السقف عشرة،
 * PIN، الحذف والتراجع والمسح — وأهم شيء: الهوية لا تتغير ولا تختلط.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './secure-index.ts';
import { sqliteEnv } from './test-d1.ts';
import { checkPin, DELETE_GRACE_MS, DELETE_NETWORK_ALLOWANCE_MS, MAX_ACCOUNTS, purgeExpired } from './accounts.ts';
import { hashDeviceSecret } from './secure-index.ts';

const PEPPER = 'device-pepper-for-tests-only-32-chars-x';
const DAHMI = '07588797-a471-44d1-99ce-7fb4f188c196';
const phone = { deviceId: 'phone-0000-0001', deviceCredential: 'credential-of-the-test-phone-000001' };
const tablet = { deviceId: 'tablet-000-0002', deviceCredential: 'credential-of-the-test-tablet-00002' };
const ctx = { waitUntil: () => {} };

async function setup() {
  const { env, db } = sqliteEnv({
    VANTARA_SESSION_SECRET: 'session-secret-that-is-at-least-32-characters',
    VANTARA_IDENTITY_SECRET: 'identity-secret-for-tests-only-32-chars',
    VANTARA_DEVICE_PEPPER: PEPPER,
  });
  // الجوال والتابلت معتمدان للحسابات الثلاثة (كما يفعل الاعتماد الحالي)
  for (const device of [phone, tablet]) {
    const hash = await hashDeviceSecret(device.deviceCredential, PEPPER);
    for (const { user_id } of db.prepare('SELECT user_id FROM accounts').all() as { user_id: string }[]) {
      db.prepare('INSERT INTO trusted_devices (device_id, user_id, credential_hash, created_at, last_used_at) VALUES (?, ?, ?, 0, 0)').run(device.deviceId, user_id, hash);
    }
  }
  const call = (path: string, body?: unknown, token?: string, method = 'POST') =>
    worker.fetch(
      new Request(`https://sync.test${path}`, {
        method,
        body: body === undefined ? null : JSON.stringify(body),
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      }),
      env,
      ctx,
    );
  const session = async (userId: string, device = phone, extra: Record<string, unknown> = {}) => {
    const res = await call('/v1/session', { userId, ...device, ...extra });
    return { res, body: (await res.json()) as Record<string, any> };
  };
  const tokenFor = async (userId: string, device = phone, extra = {}) => (await session(userId, device, extra)).body.token as string;
  const list = async () => ((await (await call('/v1/accounts', undefined, undefined, 'GET')).json()) as { content: any[]; limit: number });
  return { env, db, call, session, tokenFor, list };
}

describe('add account', () => {
  it('creates a new hidden immutable id, trusts it on every approved device, and lists it', async () => {
    const { call, tokenFor, list, session, db } = await setup();
    const token = await tokenFor(DAHMI);
    const res = await call('/v1/accounts/create', { username: '@Sara_1', displayName: '  سارة  ', avatarKey: '/icons/avatars/7.webp' }, token);
    expect(res.status).toBe(200);
    const { account } = (await res.json()) as { account: { userId: string; username: string; displayName: string } };
    expect(account.userId).toMatch(/^[0-9a-f-]{36}$/);
    expect(account).toMatchObject({ username: 'sara_1', displayName: 'سارة' });

    const accounts = (await list()).content;
    expect(accounts.map((a) => a.username)).toContain('sara_1');
    expect((await list()).limit).toBe(MAX_ACCOUNTS);
    // يُفتح من الجوال والتابلت بلا اعتماد جديد
    expect((await session(account.userId, phone)).res.status).toBe(200);
    expect((await session(account.userId, tablet)).res.status).toBe(200);
    // يصل كل جهاز عبر الفروقات
    const synced = db.prepare('SELECT rev FROM accounts WHERE user_id = ?').get(account.userId) as { rev: number };
    expect(synced.rev).toBeGreaterThan(0);
  });

  it('rejects a taken or malformed username and a missing name', async () => {
    const { call, tokenFor } = await setup();
    const token = await tokenFor(DAHMI);
    expect((await call('/v1/accounts/create', { username: 'NGM', displayName: 'x' }, token)).status).toBe(409);
    expect((await call('/v1/accounts/create', { username: 'a b', displayName: 'x' }, token)).status).toBe(400);
    expect((await call('/v1/accounts/create', { username: 'okname', displayName: '   ' }, token)).status).toBe(400);
    expect((await call('/v1/accounts/create', { username: 'okname', displayName: 'x' })).status).toBe(401);
    // من شاشة «من يتابع؟» بلا جلسة: إثبات جهاز معتمد يكفي، وجهاز غريب لا
    expect((await call('/v1/accounts/create', { username: 'fromgate', displayName: 'g', ...phone })).status).toBe(200);
    expect((await call('/v1/accounts/create', { username: 'stranger', displayName: 's', deviceId: 'evil-device-01', deviceCredential: 'not-a-trusted-credential-000000' })).status).toBe(401);
  });

  it('never exceeds ten, even with concurrent requests', async () => {
    const { call, tokenFor, list } = await setup();
    const token = await tokenFor(DAHMI);
    for (let i = 0; i < 6; i += 1) expect((await call('/v1/accounts/create', { username: `user${i}`, displayName: `U${i}` }, token)).status).toBe(200);
    // 9 الآن: ثلاثة طلبات معًا، يمر واحد فقط
    const results = await Promise.all(['racea', 'raceb', 'racec'].map((u) => call('/v1/accounts/create', { username: u, displayName: u }, token)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect((await list()).content).toHaveLength(MAX_ACCOUNTS);
    const extra = await call('/v1/accounts/create', { username: 'eleven', displayName: '11' }, token);
    expect(extra.status).toBe(409);
    expect(await extra.json()).toEqual({ error: 'limit_reached' });
  });
});

describe('profile PIN', () => {
  it('is hashed, required for a session, and the grant renews without asking again on the same device only', async () => {
    const { call, tokenFor, session, db, list } = await setup();
    const token = await tokenFor(DAHMI);
    const set = await call('/v1/pin', { action: 'set', pin: '4826' }, token);
    expect(set.status).toBe(200);
    const { pinGrant } = (await set.json()) as { pinGrant: string };
    const stored = db.prepare('SELECT pin_hash, salt, digits FROM account_pins WHERE user_id = ?').get(DAHMI) as { pin_hash: string; salt: string; digits: number };
    expect(stored.digits).toBe(4);
    expect(stored.pin_hash).not.toContain('4826');
    expect(stored.pin_hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await list()).content.find((a) => a.userId === DAHMI).pinDigits).toBe(4);

    expect((await session(DAHMI)).body).toEqual({ error: 'pin_required', digits: 4 });
    expect((await session(DAHMI, phone, { pinGrant })).res.status).toBe(200);
    // إذن الجوال لا يفتح التابلت
    expect((await session(DAHMI, tablet, { pinGrant })).body.error).toBe('pin_required');
    const ok = await session(DAHMI, tablet, { pin: '4826' });
    expect(ok.res.status).toBe(200);
    expect(ok.body.user.pinDigits).toBe(4);
    expect(typeof ok.body.pinGrant).toBe('string');
  });

  it('locks after five wrong tries, escalating, and resets on success', async () => {
    const { env, call, tokenFor, session } = await setup();
    const token = await tokenFor(DAHMI);
    await call('/v1/pin', { action: 'set', pin: '135790' }, token);
    for (let i = 0; i < 4; i += 1) expect((await session(DAHMI, phone, { pin: '000000' })).body.error).toBe('pin_wrong');
    const locked = await session(DAHMI, phone, { pin: '000000' });
    expect(locked.res.status).toBe(429);
    expect(locked.body.error).toBe('pin_locked');
    // حتى الصحيح مرفوض أثناء القفل
    expect((await session(DAHMI, phone, { pin: '135790' })).body.error).toBe('pin_locked');
    // بعد دقيقة يُقبل الصحيح ويُصفّر العداد
    const later = Date.now() + 61_000;
    expect(await checkPin(env, DAHMI, '135790', later)).toEqual({ ok: true });
    // جولة ثانية من خمسة خاطئة ⇒ قفل أطول (5 دقائق)
    for (let i = 0; i < 4; i += 1) await checkPin(env, DAHMI, '111111', later);
    const second = await checkPin(env, DAHMI, '111111', later);
    expect(second).toMatchObject({ ok: false, error: 'pin_locked' });
  });

  it('change and removal need the current PIN; data stays on the same identity', async () => {
    const { call, tokenFor, session, db } = await setup();
    db.prepare("INSERT INTO library (user_id, series_ref, series_title, added_at, removed, rev) VALUES (?, 'ext:s:1', 'Solo', 1, 0, 1)").run(DAHMI);
    const token = await tokenFor(DAHMI);
    await call('/v1/pin', { action: 'set', pin: '1111' }, token);
    expect((await call('/v1/pin', { action: 'set', pin: '222222' }, token)).status).toBe(401);
    expect((await call('/v1/pin', { action: 'set', pin: '222222', currentPin: '1111' }, token)).status).toBe(200);
    expect((await session(DAHMI, phone, { pin: '222222' })).res.status).toBe(200);
    expect((await call('/v1/pin', { action: 'remove', currentPin: '9999' }, token)).status).toBe(401);
    expect((await call('/v1/pin', { action: 'remove', currentPin: '222222' }, token)).status).toBe(200);
    expect((await session(DAHMI)).res.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM library WHERE user_id = ?').get(DAHMI)).toEqual({ n: 1 });
  });
});

// ───────────────────────── الحذف ─────────────────────────

const USER_COLUMN = /^(user_id|author_id|from_id|to_id|sender_id|actor_id|target_user_id|owner_id|created_by|updated_by|deleted_by)$/;
type Db = Awaited<ReturnType<typeof setup>>['db'];

/**
 * يزرع صفًّا للحساب في **كل** عمود يشير إلى مستخدم في **كل** جدول (يُقرأ من
 * المخطط نفسه، فجدول جديد يُضاف لاحقًا يدخل الاختبار تلقائيًا)، وصفوفًا للآخرين
 * تشير إلى محتواه. ثم يتحقق أن المسح لم يترك شيئًا.
 */
function seedEverywhere(db: Db, id: string, other: string) {
  db.exec('PRAGMA foreign_keys = OFF');
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT IN ('accounts', 'account_pins')").all() as { name: string }[]).map((t) => t.name);
  const seeded: string[] = [];
  let n = 0;
  for (const table of tables) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string }[];
    for (const target of cols.filter((c) => USER_COLUMN.test(c.name))) {
      // قيود CHECK (حالة من قائمة، نوع محدد): أول قيمة مسموحة تكفي للزرع
      const allowed: Record<string, unknown> = {};
      const value = (c: { name: string; type: string }) => {
        if (c.name in allowed) return allowed[c.name];
        if (c.name === target.name) return id;
        if (USER_COLUMN.test(c.name)) return other;
        if (table === 'recommendation_recipients' && c.name === 'state') return 'PENDING';
        if (table === 'recommendation_recipients' && (c.name === 'intent' || c.name === 'responded_at')) return null;
        if (c.name === 'target_kind') return 'frame';
        const type = c.type.toUpperCase();
        if (type.includes('INT') || type.includes('REAL')) return /removed|deleted|failed|locked/.test(c.name) ? 0 : 1;
        if (type.includes('BLOB')) return new Uint8Array([1]);
        if (/json|payload|data$|meta|^data$/.test(c.name)) return '{}';
        return `seed-${table}-${c.name}-${(n += 1)}`;
      };
      const insert = db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.map((c) => c.name).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
      for (let attempt = 0; ; attempt += 1) {
        try {
          insert.run(...(cols.map(value) as never[]));
          break;
        } catch (error) {
          const check = /CHECK constraint failed: (?:\w+\.)?(\w+) IN \(\s*'?([^',)]+)/.exec(String((error as Error).message));
          const nullable = /CHECK constraint failed: (?:\w+\.)?(\w+) IS NULL/.exec(String((error as Error).message));
          if (nullable && !check) {
            allowed[nullable[1]!] = null;
            continue;
          }
          if (!check || attempt > 8) throw new Error(`${table}: ${(error as Error).message}`);
          allowed[check[1]!] = /^\d+$/.test(check[2]!) ? Number(check[2]) : check[2];
        }
      }
      seeded.push(`${table}.${target.name}`);
    }
  }
  // للآخرين، يشير إلى محتوى الحساب: تفاعل على تعليقه، إيصال لتوصيته، رد في مجلسه
  const first = (sql: string) => (db.prepare(sql).get(id) as { id: string }).id;
  const comment = first('SELECT id FROM comments WHERE author_id = ?');
  const rec = first('SELECT id FROM recommendations WHERE from_id = ?');
  const frame = first('SELECT id FROM frames WHERE from_id = ?');
  const message = first('SELECT id FROM majlis_messages WHERE sender_id = ?');
  const event = first('SELECT id FROM activity WHERE actor_id = ?');
  db.prepare("INSERT INTO reactions (comment_id, user_id, emoji, active, rev) VALUES (?, ?, '🔥', 1, 1)").run(comment, other);
  db.prepare("INSERT INTO recommendation_recipients (recommendation_id, user_id, state, rev) VALUES (?, ?, 'PENDING', 1)").run(rec, other);
  db.prepare('INSERT INTO activity_receipts (event_id, user_id, delivered_at, rev) VALUES (?, ?, 1, 1)').run(event, other);
  db.prepare("INSERT INTO majlis_reactions (target_kind, target_id, user_id, emoji, updated_at, rev) VALUES ('frame', ?, ?, '❤️', 1, 1)").run(frame, other);
  db.prepare("INSERT INTO majlis_receipts (target_kind, target_id, user_id, delivered_at, rev) VALUES ('rec', ?, ?, 1, 1)").run(rec, other);
  db.prepare('INSERT INTO majlis_message_receipts (message_id, user_id, seen_at, rev) VALUES (?, ?, 1, 1)').run(message, other);
  db.exec('PRAGMA foreign_keys = ON');
  return { seeded, contentIds: [comment, rec, frame, message, event] };
}

/** كل صف في القاعدة يذكر المعرّف (أو يشير لمحتواه)، إلا صف الحساب نفسه. */
function mentions(db: Db, needles: string[]) {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all() as { name: string }[]).map((t) => t.name);
  const hits: Record<string, unknown[]> = {};
  for (const table of tables) {
    for (const row of db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]) {
      const text = JSON.stringify(row, (_k, v) => (v instanceof Uint8Array ? null : v));
      if (table === 'accounts' && row['user_id'] === needles[0]) continue;
      if (needles.some((needle) => text.includes(needle))) (hits[table] ??= []).push(row);
    }
  }
  return hits;
}

async function tempAccount(ctx: Awaited<ReturnType<typeof setup>>, username = 'temp') {
  const owner = await ctx.tokenFor(DAHMI);
  const res = await ctx.call('/v1/accounts/create', { username, displayName: 'مؤقت' }, owner);
  const { account } = (await res.json()) as { account: { userId: string } };
  const token = await ctx.tokenFor(account.userId);
  return { id: account.userId, token, owner };
}

const pull = async (ctx: Awaited<ReturnType<typeof setup>>, token: string, since = 0) =>
  (await (await ctx.call(`/v1/sync?since=${since}`, undefined, token, 'GET')).json()) as { cursor: number; changes: Record<string, Record<string, unknown>[]> };

afterEach(() => {
  vi.useRealTimers();
});

describe('delete account', () => {
  it('PENDING_DELETE touches no data and keeps the username; undo is an instant flip back to ACTIVE', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const T = Date.parse('2026-10-02T12:00:00Z');
    vi.setSystemTime(T);
    const ctx = await setup();
    const { db, call, session, list } = ctx;
    const { id, token, owner } = await tempAccount(ctx);
    await call('/v1/pin', { action: 'set', pin: '5555' }, token);
    seedEverywhere(db, id, DAHMI);
    const before = mentions(db, [id]);

    expect((await call('/v1/accounts/delete', { pin: '0000' }, token)).status).toBe(401);
    const del = await call('/v1/accounts/delete', { pin: '5555' }, token);
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true, state: 'PENDING_DELETE', graceMs: DELETE_GRACE_MS, purgeAfter: T + DELETE_GRACE_MS + DELETE_NETWORK_ALLOWANCE_MS });

    // في المهلة: صفر بايت مُسح، الأجهزة لم تُلغَ، الاسم ما زال محجوزًا
    expect(mentions(db, [id])).toEqual(before);
    expect((db.prepare('SELECT COUNT(*) AS n FROM trusted_devices WHERE user_id = ? AND revoked_at IS NULL').get(id) as { n: number }).n).toBe(2);
    expect((await call('/v1/accounts/create', { username: 'temp', displayName: 'x' }, owner)).status).toBe(409);
    // مخفي، بلا جلسة جديدة، ولا يغيّر شيئًا
    expect((await list()).content.some((a) => a.userId === id)).toBe(false);
    expect((await session(id, phone, { pin: '5555' })).res.status).toBe(404);
    expect((await call('/v1/pin', { action: 'remove', currentPin: '5555' }, token)).status).toBe(410);
    // الإتمام قبل المهلة لا يمسح
    vi.setSystemTime(T + 5_000);
    expect(await (await call('/v1/accounts/delete/commit', {}, token)).json()).toEqual({ state: 'PENDING_DELETE', retryInMs: DELETE_GRACE_MS + DELETE_NETWORK_ALLOWANCE_MS - 5_000 });
    expect(await purgeExpired(ctx.env, T + 9_999)).toBe(0);
    expect(mentions(db, [id])).toEqual(before);

    // «تراجع» في الثانية التاسعة: ACTIVE فورًا، والبيانات هي هي (لم تُستعد، لم تُمس)
    vi.setSystemTime(T + 9_000);
    const undo = await call('/v1/accounts/restore', {}, token);
    expect(undo.status).toBe(200);
    expect(await undo.json()).toEqual({ restored: true, state: 'ACTIVE' });
    expect(mentions(db, [id])).toEqual(before);
    expect((db.prepare('SELECT lifecycle, purge_after, deleted_at FROM accounts WHERE user_id = ?').get(id))).toEqual({ lifecycle: 'ACTIVE', purge_after: null, deleted_at: null });
    expect((await list()).content.some((a) => a.userId === id)).toBe(true);
    expect((await session(id, phone, { pin: '5555' })).res.status).toBe(200);
    // ولا يُمسح لاحقًا من المؤقت
    expect(await purgeExpired(ctx.env, T + 60_000)).toBe(0);
  });

  it('final purge only after the deadline: wipes everything, frees the username, leaves one tombstone on the same UUID', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const T = Date.parse('2026-10-02T12:00:00Z');
    vi.setSystemTime(T);
    const ctx = await setup();
    const { db, call, list } = ctx;
    const { id, token, owner } = await tempAccount(ctx);
    await call('/v1/pin', { action: 'set', pin: '246810' }, token);
    const { seeded, contentIds } = seedEverywhere(db, id, DAHMI);
    expect(seeded.length).toBeGreaterThan(45);
    const detachedBefore = (db.prepare('SELECT COUNT(*) AS n FROM translation_pages').get() as { n: number }).n;

    await call('/v1/accounts/delete', { pin: '246810' }, token);
    // التراجع بعد المهلة والهامش مرفوض، والمسح يبدأ
    vi.setSystemTime(T + DELETE_GRACE_MS + DELETE_NETWORK_ALLOWANCE_MS);
    expect(await (await call('/v1/accounts/delete/commit', {}, token)).json()).toEqual({ state: 'DELETED' });
    const late = await call('/v1/accounts/restore', {}, token);
    expect(late.status).toBe(409);
    expect(await late.json()).toEqual({ restored: false, state: 'DELETED' });

    // لا بيانات يتيمة في أي جدول، ولا مفتاح أجنبي معلّق، ولا تفاعل على محتوى مُسح
    expect(mentions(db, [id, ...contentIds])).toEqual({});
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    // صفحة الترجمة المشتركة تبقى للبقية، بلا نسبة إليه
    expect((db.prepare('SELECT COUNT(*) AS n FROM translation_pages').get() as { n: number }).n).toBe(detachedBefore);
    // شاهد القبر: نفس الـUUID، حالة DELETED، اسم محرر — ولا شيء آخر
    expect(db.prepare('SELECT user_id, username, lifecycle, badge, purge_after, deleted_at FROM accounts WHERE user_id = ?').get(id)).toEqual({
      user_id: id, username: `~${id}`, lifecycle: 'DELETED', badge: null, purge_after: null, deleted_at: T + DELETE_GRACE_MS + DELETE_NETWORK_ALLOWANCE_MS,
    });

    // الاسم يُستعمل من جديد بهوية جديدة تمامًا، والعشرة تحسب الأحياء والمعلّقين فقط
    const again = await call('/v1/accounts/create', { username: 'temp', displayName: 'جديد' }, owner);
    expect(again.status).toBe(200);
    const fresh = ((await again.json()) as { account: { userId: string } }).account.userId;
    expect(fresh).not.toBe(id);
    expect(mentions(db, [fresh]).library).toBeUndefined();
    expect((await list()).content.some((a) => a.userId === id)).toBe(false);

    // توكن الحساب المحذوف (ما زال ضمن عمره) لا يقرأ ولا يكتب: لا بيانات تولد بعد المسح
    const write = await call('/v1/ops', { ops: [{ opId: 'after-purge-1', kind: 'library.add', payload: { seriesRef: 'ext:x:1', seriesTitle: 'X' }, at: Date.now() }] }, token);
    expect(write.status).toBe(410);
    expect((await call('/v1/sync?since=0', undefined, token, 'GET')).status).toBe(410);
    expect(mentions(db, [id])).toEqual({});
  });

  it('app closed during the countdown: the server purges on its own after the deadline, never before', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const T = Date.parse('2026-10-02T12:00:00Z');
    vi.setSystemTime(T);
    const ctx = await setup();
    const { id, token } = await tempAccount(ctx, 'closed');
    seedEverywhere(ctx.db, id, DAHMI);
    await ctx.call('/v1/accounts/delete', {}, token);
    // التطبيق أُغلق: لا commit. المؤقت (كل دقيقة) وقائمة «من يتابع؟» يكملان
    expect(await purgeExpired(ctx.env, T + DELETE_GRACE_MS)).toBe(0);
    expect(Object.keys(mentions(ctx.db, [id])).length).toBeGreaterThan(40);
    expect(await purgeExpired(ctx.env, T + 60_000)).toBe(1);
    expect(mentions(ctx.db, [id])).toEqual({});
    vi.setSystemTime(T + 60_000);
    expect((await (await ctx.call('/v1/accounts/create', { username: 'closed', displayName: 'c' }, await ctx.tokenFor(DAHMI))).status)).toBe(200);
  });

  it('other devices learn PENDING_DELETE, ACTIVE again, then DELETED from the sync revision, on the same UUID', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const T = Date.parse('2026-10-02T12:00:00Z');
    vi.setSystemTime(T);
    const ctx = await setup();
    const { id, token, owner } = await tempAccount(ctx, 'synced');
    const watcher = await ctx.tokenFor(DAHMI, tablet);
    let cursor = (await pull(ctx, watcher)).cursor;
    const accountRow = async () => {
      const page = await pull(ctx, watcher, cursor);
      cursor = page.cursor;
      return (page.changes['accounts'] ?? []).filter((r) => r['user_id'] === id);
    };

    await ctx.call('/v1/accounts/delete', {}, token);
    expect(await accountRow()).toEqual([expect.objectContaining({ user_id: id, username: 'synced', lifecycle: 'PENDING_DELETE', purge_after: T + DELETE_GRACE_MS + DELETE_NETWORK_ALLOWANCE_MS })]);
    await ctx.call('/v1/accounts/restore', {}, token);
    expect(await accountRow()).toEqual([expect.objectContaining({ user_id: id, lifecycle: 'ACTIVE', purge_after: null })]);
    await ctx.call('/v1/accounts/delete', {}, token);
    await accountRow();
    vi.setSystemTime(T + 30_000);
    await purgeExpired(ctx.env, T + 30_000);
    expect(await accountRow()).toEqual([expect.objectContaining({ user_id: id, username: `~${id}`, lifecycle: 'DELETED' })]);
    // جهاز جديد يسحب من الصفر: يرى شاهد القبر وحده، بلا ملف ولا بيانات
    const full = await pull(ctx, owner);
    expect((full.changes['accounts'] ?? []).find((r) => r['user_id'] === id)).toMatchObject({ lifecycle: 'DELETED' });
    expect((full.changes['profiles'] ?? []).some((r) => r['user_id'] === id)).toBe(false);
  });

  it('a pending account still counts toward ten, so undo can never make eleven', async () => {
    const ctx = await setup();
    const owner = await ctx.tokenFor(DAHMI);
    const { token } = await tempAccount(ctx, 'pending');
    for (let i = 0; i < 6; i += 1) expect((await ctx.call('/v1/accounts/create', { username: `fill${i}`, displayName: 'f' }, owner)).status).toBe(200);
    await ctx.call('/v1/accounts/delete', {}, token);
    expect((await ctx.call('/v1/accounts/create', { username: 'eleventh', displayName: 'x' }, owner)).status).toBe(409);
    await ctx.call('/v1/accounts/restore', {}, token);
    expect((await ctx.list()).content).toHaveLength(MAX_ACCOUNTS);
  });
});
