import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UchiyomiError } from '@vantara/uchiyomi';
import { encrypt } from './crypto.ts';

const db = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@vantara/db', () => ({
  query: db.query,
  queryOne: db.queryOne,
  transaction: db.transaction,
}));

const { SessionStore } = await import('./sessions.ts');

function upstream() {
  return {
    login: vi.fn(async () => ({
      accessToken: 'short-login-token',
      user: {
        id: 'upstream-user-1',
        username: 'mansour',
        displayName: 'Mansour',
        role: 'user',
      },
    })),
    mintToken: vi.fn(async () => ({
      id: 'minted-token-id',
      token: 'minted-long-lived-token',
    })),
    listTokens: vi.fn(async () => []),
    revokeToken: vi.fn(async () => undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SessionStore.login atomicity', () => {
  it('reconciles and revokes a token whose mint response was lost', async () => {
    const service = upstream();
    service.mintToken.mockRejectedValueOnce(
      new UchiyomiError('upstream unavailable', 502, 'upstream_unavailable', '/api/tokens'),
    );
    service.listTokens.mockImplementationOnce(async () => {
      const options = service.mintToken.mock.calls[0]?.[1] as { name: string };
      return [{
        id: 'ghost-token-id',
        name: options.name,
        scopes: ['read', 'write'],
        createdAt: new Date().toISOString(),
        lastSeen: null,
        expiresAt: new Date(Date.now() + 60 * 86400000).toISOString(),
        expired: false,
      }];
    });

    const store = new SessionStore({
      key: Buffer.alloc(32, 5),
      ttlDays: 60,
      uchiyomi: service as never,
    });

    await expect(store.login('mansour', 'password', 'ci-device')).rejects.toMatchObject({
      status: 502,
      code: 'upstream_unavailable',
    });

    expect(service.listTokens).toHaveBeenCalledWith('short-login-token');
    expect(service.revokeToken).toHaveBeenCalledWith('short-login-token', 'ghost-token-id');
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('revokes the freshly minted upstream credential when database persistence fails', async () => {
    const service = upstream();
    db.transaction.mockRejectedValueOnce(new Error('database unavailable'));

    const store = new SessionStore({
      key: Buffer.alloc(32, 7),
      ttlDays: 60,
      uchiyomi: service as never,
    });

    await expect(store.login('mansour', 'password', 'ci-device')).rejects.toThrow(
      'database unavailable',
    );

    expect(service.mintToken).toHaveBeenCalledTimes(1);
    expect(service.revokeToken).toHaveBeenCalledTimes(1);
    expect(service.revokeToken).toHaveBeenCalledWith(
      'minted-long-lived-token',
      'minted-token-id',
    );
    expect(db.query).not.toHaveBeenCalled();
  });

  it('persists user, identity link, and session inside one transaction', async () => {
    const service = upstream();
    const client = { query: vi.fn(async () => ({ rows: [] })) };
    db.transaction.mockImplementationOnce(async (fn: (client: typeof client) => Promise<unknown>) =>
      fn(client),
    );

    const store = new SessionStore({
      key: Buffer.alloc(32, 9),
      ttlDays: 60,
      uchiyomi: service as never,
    });

    const session = await store.login('mansour', 'password', 'ci-device');

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledTimes(3);
    expect(service.revokeToken).not.toHaveBeenCalled();
    expect(session).toMatchObject({
      userId: 'upstream-user-1',
      username: 'mansour',
      token: 'minted-long-lived-token',
      tokenId: 'minted-token-id',
    });
  });
});


describe('SessionStore identity credential rotation', () => {
  it('rotates a near-expiry identity token and revokes its predecessor after commit', async () => {
    const service = upstream();
    const key = Buffer.alloc(32, 17);
    const row = {
      vantara_identity_id: 'identity-1',
      uchiyomi_user_id: 'upstream-user-1',
      token_encrypted: encrypt('old-identity-token', key),
      token_id: 'old-token-id',
      token_expires_at: new Date(Date.now() + 86400000).toISOString(),
      username: 'mansour',
    };
    db.queryOne.mockResolvedValueOnce(row);

    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [row] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    db.transaction.mockImplementationOnce(async (fn: (client: typeof client) => Promise<unknown>) =>
      fn(client),
    );

    const store = new SessionStore({
      key,
      ttlDays: 60,
      uchiyomi: service as never,
    });

    const session = await store.resolveIdentity('identity-1', 'device-1');

    expect(service.mintToken).toHaveBeenCalledTimes(1);
    expect(service.mintToken).toHaveBeenCalledWith(
      'old-identity-token',
      expect.objectContaining({ scopes: ['read', 'write'], expiresInDays: 60 }),
    );
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(String(client.query.mock.calls[1]?.[0])).toContain('token_expires_at');
    expect(service.revokeToken).toHaveBeenCalledWith(
      'minted-long-lived-token',
      'old-token-id',
    );
    expect(session).toMatchObject({
      identityId: 'identity-1',
      token: 'minted-long-lived-token',
      tokenId: 'minted-token-id',
    });
  });

  it('turns an upstream-rejected expired identity into an explicit relink requirement', async () => {
    const service = upstream();
    service.mintToken.mockRejectedValueOnce(
      new UchiyomiError('unauthorized', 401, 'unauthorized', '/api/tokens'),
    );
    const key = Buffer.alloc(32, 19);
    const row = {
      vantara_identity_id: 'identity-expired',
      uchiyomi_user_id: 'upstream-user-1',
      token_encrypted: encrypt('expired-identity-token', key),
      token_id: 'expired-token-id',
      token_expires_at: new Date(Date.now() - 86400000).toISOString(),
      username: 'mansour',
    };
    db.queryOne.mockResolvedValueOnce(row);
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [row] }) };
    db.transaction.mockImplementationOnce(async (fn: (client: typeof client) => Promise<unknown>) =>
      fn(client),
    );
    db.query.mockResolvedValueOnce([{ vantara_identity_id: 'identity-expired' }]);

    const store = new SessionStore({
      key,
      ttlDays: 60,
      uchiyomi: service as never,
    });

    await expect(store.resolveIdentity('identity-expired', 'device-1')).rejects.toMatchObject({
      name: 'IdentityRelinkRequiredError',
    });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('SET revoked_at = now()'),
      ['identity-expired'],
    );
  });
});

describe('SessionStore.purgeExpired credential lifecycle', () => {
  it('revokes unprotected upstream credentials before deleting expired local rows', async () => {
    const service = upstream();
    const key = Buffer.alloc(32, 11);
    db.query
      .mockResolvedValueOnce([
        {
          id: 'old-session',
          token_encrypted: encrypt('old-upstream-token', key),
          token_id: 'old-token-id',
        },
        {
          id: 'identity-backed-session',
          token_encrypted: encrypt('protected-upstream-token', key),
          token_id: 'protected-token-id',
        },
      ])
      .mockResolvedValueOnce([{ token_id: 'protected-token-id' }])
      .mockResolvedValueOnce([{ id: 'old-session' }, { id: 'identity-backed-session' }]);

    const store = new SessionStore({
      key,
      ttlDays: 60,
      uchiyomi: service as never,
    });

    await expect(store.purgeExpired()).resolves.toBe(2);
    expect(service.revokeToken).toHaveBeenCalledTimes(1);
    expect(service.revokeToken).toHaveBeenCalledWith('old-upstream-token', 'old-token-id');
    expect(db.query).toHaveBeenCalledTimes(3);
  });

  it('keeps local rows when upstream revocation fails so cleanup can retry', async () => {
    const service = upstream();
    service.revokeToken.mockRejectedValueOnce(new Error('upstream unavailable'));
    const key = Buffer.alloc(32, 13);
    db.query
      .mockResolvedValueOnce([
        {
          id: 'old-session',
          token_encrypted: encrypt('old-upstream-token', key),
          token_id: 'old-token-id',
        },
      ])
      .mockResolvedValueOnce([]);

    const store = new SessionStore({
      key,
      ttlDays: 60,
      uchiyomi: service as never,
    });

    await expect(store.purgeExpired()).rejects.toThrow('upstream unavailable');
    expect(db.query).toHaveBeenCalledTimes(2);
  });
});
