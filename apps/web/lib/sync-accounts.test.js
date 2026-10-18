/**
 * دورة حياة الحساب في عميل المزامنة: PIN، والإضافة، والحذف.
 *
 * الخادم يحرس القواعد (`accounts.integration.test.ts`). هنا ما يخص الجهاز:
 * إذن الـPIN يبقى على الجهاز للحساب نفسه بعد إعادة الفتح، ولا
 * ينتقل لحساب آخر، والحساب المحذوف يختفي من كل شاشة.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

function fakeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

function jsonResponse(body, status = 200) {
  const res = {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  };
  res.clone = () => res;
  return res;
}

const ME = { userId: 'u1', username: 'dahmi', displayName: 'دحمي' };

let local;
let session;

async function loadSync(fetchImpl) {
  globalThis.localStorage = local;
  globalThis.sessionStorage = session;
  globalThis.fetch = fetchImpl;
  const { createSync } = await import('./sync.js');
  return createSync({ baseUrl: 'https://sync.test' });
}

beforeEach(() => {
  vi.resetModules();
  local = fakeStorage();
  session = fakeStorage();
  local.setItem('vantara.public-views.v1', '1');
});

describe('PIN', () => {
  it('sends the PIN once, then renews with the grant it received', async () => {
    const bodies = [];
    const sync = await loadSync(vi.fn(async (url, options) => {
      if (String(url).endsWith('/v1/session')) {
        const body = JSON.parse(options.body);
        bodies.push(body);
        return jsonResponse({ token: `t${bodies.length}`, user: { ...ME, pinDigits: 4 }, ...(body.pin ? { pinGrant: 'grant-0123456789abcdef' } : {}) });
      }
      return jsonResponse({ reset: false, cursor: 0, changes: {} });
    }));

    await sync.signIn('u1', { pin: '2580' });
    expect(bodies[0].pin).toBe('2580');
    expect(sync.locked).toBe(false);
    expect(JSON.parse(local.getItem('vantara.pin.grant')).grant).toBe('grant-0123456789abcdef');
    // إعادة فتح التطبيق تحفظ إذن نفس الحساب والجهاز.
    expect((await loadSync(globalThis.fetch)).locked).toBe(false);

    await sync.refreshSession();
    expect(bodies[1].pin).toBeUndefined();
    expect(bodies[1].pinGrant).toBe('grant-0123456789abcdef');
  });

  it('locks a reopened app without a PIN grant', async () => {
    local.setItem('vantara.token', 'old');
    local.setItem('vantara.user', JSON.stringify({ ...ME, pinDigits: 6 }));
    const sync = await loadSync(vi.fn(async () => jsonResponse({})));
    expect(sync.signedIn).toBe(true);
    expect(sync.locked).toBe(true);
  });

  it('discards a persisted grant after device proof changes', async () => {
    local.setItem('vantara.token', 'old');
    local.setItem('vantara.user', JSON.stringify({ ...ME, pinDigits: 4 }));
    local.setItem('vantara.device.id', 'new-device');
    local.setItem('vantara.device.credential', 'new-secret');
    local.setItem('vantara.pin.grant', JSON.stringify({ userId: 'u1', deviceId: 'old-device', deviceCredential: 'old-secret', grant: 'old-grant' }));
    const sync = await loadSync(vi.fn());
    expect(sync.locked).toBe(true);
    expect(local.getItem('vantara.pin.grant')).toBeNull();
  });

  it('surfaces a wrong PIN and a lockout with their codes', async () => {
    let answer = { error: 'pin_wrong', digits: 4 };
    let status = 401;
    const sync = await loadSync(vi.fn(async () => jsonResponse(answer, status)));
    await expect(sync.signIn('u1', { pin: '1111' })).rejects.toMatchObject({ code: 'pin_wrong', digits: 4 });
    answer = { error: 'pin_locked', retryAt: 99_000, digits: 4 };
    status = 429;
    await expect(sync.signIn('u1', { pin: '1111' })).rejects.toMatchObject({ code: 'pin_locked', retryAt: 99_000 });
    expect(sync.signedIn).toBe(false);
  });

  it('locks instead of signing out when another device added a PIN', async () => {
    local.setItem('vantara.token', 'old');
    local.setItem('vantara.user', JSON.stringify(ME));
    const sync = await loadSync(vi.fn(async () => jsonResponse({ error: 'pin_required', digits: 6 }, 401)));
    await expect(sync.refreshSession()).rejects.toMatchObject({ code: 'pin_required' });
    expect(sync.user?.userId).toBe('u1');
    expect(sync.locked).toBe(true);
    expect(sync.user.pinDigits).toBe(6);
  });

  it('never carries a grant into another account', async () => {
    local.setItem('vantara.device.id', 'phone-device');
    local.setItem('vantara.device.credential', 'phone-credential');
    local.setItem('vantara.pin.grant', JSON.stringify({ userId: 'u1', deviceId: 'phone-device', deviceCredential: 'phone-credential', grant: 'grant-of-u1-000000' }));
    local.setItem('vantara.token', 't');
    local.setItem('vantara.user', JSON.stringify({ ...ME, pinDigits: 4 }));
    const bodies = [];
    const sync = await loadSync(vi.fn(async (url, options) => {
      if (String(url).endsWith('/v1/session')) {
        bodies.push(JSON.parse(options.body));
        return jsonResponse({ token: 't2', user: { userId: 'u2', username: 'sara', displayName: 'سارة', pinDigits: null } });
      }
      return jsonResponse({ reset: false, cursor: 0, changes: {} });
    }));
    await sync.signIn('u2');
    expect(bodies[0].pinGrant).toBeUndefined();
    expect(local.getItem('vantara.pin.grant')).toBeNull();
  });

  it('forgets the grant on sign out', async () => {
    local.setItem('vantara.device.id', 'phone-device');
    local.setItem('vantara.device.credential', 'phone-credential');
    local.setItem('vantara.pin.grant', JSON.stringify({ userId: 'u1', deviceId: 'phone-device', deviceCredential: 'phone-credential', grant: 'grant-of-u1-000000' }));
    local.setItem('vantara.token', 't');
    local.setItem('vantara.user', JSON.stringify({ ...ME, pinDigits: 4 }));
    const sync = await loadSync(vi.fn(async () => jsonResponse({})));
    expect(sync.locked).toBe(false);
    sync.signOut();
    expect(local.getItem('vantara.pin.grant')).toBeNull();
  });
});

describe('accounts', () => {
  it('reads the limit the server enforces', async () => {
    const sync = await loadSync(vi.fn(async () => jsonResponse({ content: [{ userId: 'u1', displayName: 'دحمي' }], limit: 10 })));
    expect(await sync.accounts()).toHaveLength(1);
    expect(sync.accountsLimit).toBe(10);
  });

  it('creates from the gate with device proof, without a session', async () => {
    let seen = null;
    const sync = await loadSync(vi.fn(async (url, options) => {
      seen = { url: String(url), headers: options.headers, body: JSON.parse(options.body) };
      return jsonResponse({ error: 'username_taken' }, 409);
    }));
    const out = await sync.createAccount({ username: 'sara', displayName: 'سارة' });
    expect(out).toMatchObject({ ok: false, status: 409, data: { error: 'username_taken' } });
    expect(seen.url).toBe('https://sync.test/v1/accounts/create');
    expect(seen.headers.authorization).toBeUndefined();
    expect(typeof seen.body.deviceId).toBe('string');
    expect(typeof seen.body.deviceCredential).toBe('string');
  });

  it('keeps creation pending until device approval, then completes with the same request id', async () => {
    const seen = [];
    let trusted = false;
    const sync = await loadSync(vi.fn(async (url, options) => {
      const path = new URL(url).pathname;
      const body = JSON.parse(options.body);
      seen.push({ path, body });
      if (path === '/v1/device/request') return jsonResponse({ code: 'ABCD-2345', expiresAt: Date.now() + 60000 });
      if (path === '/v1/device/claim') return jsonResponse({ paired: trusted, pending: !trusted });
      return trusted ? jsonResponse({ account: { ...ME, userId: 'fresh' } }) : jsonResponse({ error: 'unauthorized' }, 401);
    }));
    const pending = await sync.createAccount({ username: 'سارة_1', displayName: 'سارة' });
    expect(pending).toMatchObject({ ok: false, pending: true, approval: { code: 'ABCD-2345' } });
    expect(await sync.completePendingAccount()).toMatchObject({ pending: true });
    expect(seen.filter((r) => r.path.endsWith('/create'))).toHaveLength(1);
    trusted = true;
    expect(await sync.completePendingAccount()).toMatchObject({ ok: true, data: { account: { userId: 'fresh' } } });
    const creates = seen.filter((r) => r.path.endsWith('/create'));
    expect(creates[0].body.requestId).toBeTruthy();
    expect(creates[1].body.requestId).toBe(creates[0].body.requestId);
  });

  it('retries completion after the one-use device claim was consumed and the creation response was lost', async () => {
    let approved = false;
    let creates = 0;
    const sync = await loadSync(vi.fn(async (url) => {
      const path = new URL(url).pathname;
      if (path === '/v1/device/request') return jsonResponse({ code: 'ABCD-2345', expiresAt: Date.now() + 60000 });
      if (path === '/v1/device/claim') { approved = true; return jsonResponse({ paired: true }); }
      if (!approved) return jsonResponse({ error: 'unauthorized' }, 401);
      if (++creates === 1) throw new Error('network');
      return jsonResponse({ account: { userId: 'fresh' } });
    }));
    await sync.createAccount({ username: 'fresh', displayName: 'جديد' });
    await expect(sync.completePendingAccount()).rejects.toThrow('network');
    expect(await sync.completePendingAccount()).toMatchObject({ ok: true, data: { account: { userId: 'fresh' } } });
    expect(sync.pendingAccountCreation.approval).toBeUndefined();
  });

  it('drops another account’s retained social mirror even when the old session user was lost', async () => {
    local.setItem('vantara.mirror', JSON.stringify({
      majlis_messages: { old: { id: 'old', sender_id: 'other', body: 'old secret' } },
      recommendations: { old: { id: 'old', from_id: 'other' } },
      notifications: { old: { id: 'old', user_id: 'other' } },
      frames: { old: { id: 'old', from_id: 'other' } },
    }));
    const sync = await loadSync(vi.fn(async () => jsonResponse({ token: 'new', user: { ...ME, userId: 'fresh' } })));
    await sync.signIn('fresh');
    for (const table of ['majlis_messages', 'recommendations', 'notifications', 'frames']) expect(sync.rows(table)).toEqual([]);
  });

  it('hides a deleted account and its profile everywhere', async () => {
    local.setItem('vantara.token', 't');
    local.setItem('vantara.user', JSON.stringify(ME));
    local.setItem('vantara.mirror', JSON.stringify({
      accounts: { u1: { user_id: 'u1' }, gone: { user_id: 'gone', deleted_at: 5 } },
      profiles: { u1: { user_id: 'u1', display_name: 'دحمي' }, gone: { user_id: 'gone', display_name: 'محذوف' } },
    }));
    const sync = await loadSync(vi.fn(async () => jsonResponse({})));
    expect(sync.rows('accounts').map((r) => r.user_id)).toEqual(['u1']);
    expect(sync.rows('profiles').map((r) => r.user_id)).toEqual(['u1']);
  });

  it('hides an account in PENDING_DELETE but keeps its data until the tombstone arrives', async () => {
    local.setItem('vantara.token', 't');
    local.setItem('vantara.user', JSON.stringify(ME));
    local.setItem('vantara.mirror', JSON.stringify({
      accounts: { u1: { user_id: 'u1' }, f: { user_id: 'f', lifecycle: 'PENDING_DELETE' } },
      profiles: { u1: { user_id: 'u1' }, f: { user_id: 'f' } },
      library: { 'f/a': { user_id: 'f', series_ref: 'a' } },
    }));
    const sync = await loadSync(vi.fn(async () => jsonResponse({})));
    expect(sync.rows('accounts').map((r) => r.user_id)).toEqual(['u1']);
    expect(sync.rows('profiles').map((r) => r.user_id)).toEqual(['u1']);
    // في المهلة لا شيء يُمسح: التراجع يُظهره كما كان
    expect(sync.rows('library')).toHaveLength(1);
  });

  it('a tombstone from the sync revision wipes that UUID from this device, and only that UUID', async () => {
    local.setItem('vantara.token', 't');
    local.setItem('vantara.user', JSON.stringify(ME));
    local.setItem('vantara.cursor', '5');
    local.setItem('vantara.mirror', JSON.stringify({
      accounts: { u1: { user_id: 'u1' }, f: { user_id: 'f', lifecycle: 'PENDING_DELETE' } },
      profiles: { u1: { user_id: 'u1' }, f: { user_id: 'f' } },
      library: { 'f/a': { user_id: 'f', series_ref: 'a' }, 'u1/a': { user_id: 'u1', series_ref: 'a' } },
      comments: { c1: { id: 'c1', author_id: 'f' }, c2: { id: 'c2', author_id: 'u1' } },
      majlis_messages: { m1: { id: 'm1', sender_id: 'f' } },
      notifications: { n1: { id: 'n1', user_id: 'u1', actor_id: 'f' } },
    }));
    const sync = await loadSync(vi.fn(async (url) => String(url).includes('/v1/sync')
      ? jsonResponse({ cursor: 6, more: false, changes: { accounts: [{ user_id: 'f', username: '~f', lifecycle: 'DELETED', rev: 6 }] } })
      : jsonResponse({})));
    await sync.pull();
    expect(sync.rows('library').map((r) => r.user_id)).toEqual(['u1']);
    expect(sync.rows('comments').map((r) => r.id)).toEqual(['c2']);
    expect(sync.rows('majlis_messages')).toEqual([]);
    expect(sync.rows('notifications')[0]).toMatchObject({ id: 'n1', actor_id: null });
    expect(sync.rows('accounts').map((r) => r.user_id)).toEqual(['u1']);
  });

  it('reports its own account state, and a 410 from a stale token marks it DELETED', async () => {
    local.setItem('vantara.token', 't');
    local.setItem('vantara.user', JSON.stringify(ME));
    local.setItem('vantara.mirror', JSON.stringify({ accounts: { u1: { user_id: 'u1', lifecycle: 'PENDING_DELETE' } } }));
    const sync = await loadSync(vi.fn(async () => jsonResponse({ error: 'account_deleted', state: 'DELETED' }, 410)));
    expect(sync.accountState).toBe('PENDING_DELETE');
    const seen = [];
    sync.onChange((tables) => seen.push(...tables));
    await sync.pull();
    expect(sync.accountState).toBe('DELETED');
    expect(seen).toContain('accounts');
  });

  it('waits for the server deadline before signing out', async () => {
    local.setItem('vantara.token', 't');
    local.setItem('vantara.user', JSON.stringify(ME));
    const answers = [{ state: 'PENDING_DELETE', retryInMs: 20 }, { state: 'DELETED' }];
    const fetchImpl = vi.fn(async () => jsonResponse(answers.shift() ?? {}));
    const sync = await loadSync(fetchImpl);
    const out = await sync.commitDeletion();
    expect(out.data).toEqual({ state: 'DELETED' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sync.signedIn).toBe(false);
  });

  it('signs out after the deletion is committed', async () => {
    local.setItem('vantara.token', 't');
    local.setItem('vantara.user', JSON.stringify(ME));
    const sync = await loadSync(vi.fn(async () => jsonResponse({ state: 'DELETED' })));
    const out = await sync.commitDeletion();
    expect(out.ok).toBe(true);
    expect(sync.signedIn).toBe(false);
    expect(sync.user).toBeNull();
  });
});
