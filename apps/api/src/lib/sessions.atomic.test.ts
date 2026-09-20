import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('reconciles an ambiguous token create by unique name instead of POSTing twice', async () => {
    const service = upstream();
    service.mintToken.mockRejectedValueOnce(new Error('response lost after upstream commit'));
    service.listTokens.mockImplementationOnce(async () => {
      const name = service.mintToken.mock.calls[0]?.[1]?.name;
      return [
        {
          id: 'orphan-token-id',
          name,
          scopes: ['read', 'write'],
          createdAt: new Date().toISOString(),
          lastSeen: null,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          expired: false,
        },
      ];
    });

    const store = new SessionStore({
      key: Buffer.alloc(32, 8),
      ttlDays: 60,
      uchiyomi: service as never,
    });

    await expect(store.login('mansour', 'password', 'ci-device')).rejects.toThrow(
      'response lost after upstream commit',
    );

    expect(service.mintToken).toHaveBeenCalledTimes(1);
    expect(service.listTokens).toHaveBeenCalledTimes(1);
    expect(service.revokeToken).toHaveBeenCalledWith('short-login-token', 'orphan-token-id');
    expect(db.transaction).not.toHaveBeenCalled();
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


describe('SessionStore identity-link renewal', () => {
  it('rotates a still-valid upstream credential before its 60-day link expires', async () => {
    const service = upstream();
    const key = Buffer.alloc(32, 17);
    db.queryOne
      .mockResolvedValueOnce({
        vantara_identity_id: 'vantara-user-1',
        uchiyomi_user_id: 'upstream-user-1',
        token_encrypted: encrypt('old-upstream-token', key),
        token_id: 'old-token-id',
        token_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        linked_at: new Date().toISOString(),
        username: 'mansour',
      })
      .mockResolvedValueOnce(undefined);
    db.query.mockResolvedValueOnce([{ token_id: 'minted-token-id' }]).mockResolvedValue([]);

    const store = new SessionStore({
      key,
      ttlDays: 60,
      uchiyomi: service as never,
    });

    const session = await store.resolveIdentity('vantara-user-1', 'device-1');

    expect(service.mintToken).toHaveBeenCalledTimes(1);
    expect(service.mintToken).toHaveBeenCalledWith(
      'old-upstream-token',
      expect.objectContaining({ scopes: ['read', 'write'], expiresInDays: 60 }),
    );
    expect(session).toMatchObject({
      token: 'minted-long-lived-token',
      tokenId: 'minted-token-id',
      username: 'mansour',
    });
    expect(service.revokeToken).toHaveBeenCalledWith(
      'minted-long-lived-token',
      'old-token-id',
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
