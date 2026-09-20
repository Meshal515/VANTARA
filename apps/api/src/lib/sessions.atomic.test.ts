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
    revokeToken: vi.fn(async () => undefined),
    listTokens: vi.fn(async () => [
      {
        id: 'minted-token-id',
        name: 'vantara-test-token',
        expiresAt: '2026-12-01T00:00:00.000Z',
        expired: false,
      },
    ]),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.query.mockResolvedValue([]);
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
    expect(
      db.query.mock.calls.some(([sql]) =>
        String(sql).includes('vantara_token_mint_attempts'),
      ),
    ).toBe(true);
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
    expect(client.query).toHaveBeenCalledTimes(4);
    expect(service.revokeToken).not.toHaveBeenCalled();
    expect(session).toMatchObject({
      userId: 'upstream-user-1',
      username: 'mansour',
      token: 'minted-long-lived-token',
      tokenId: 'minted-token-id',
    });
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


describe('SessionStore identity credential renewal', () => {
  it('renews a content credential before it expires while the VANTARA device stays trusted', async () => {
    const service = upstream();
    const key = Buffer.alloc(32, 17);
    const oldToken = 'old-identity-upstream-token';
    db.queryOne
      .mockResolvedValueOnce({
        vantara_identity_id: '11111111-1111-1111-1111-111111111111',
        uchiyomi_user_id: 'upstream-user-1',
        token_encrypted: encrypt(oldToken, key),
        token_id: 'old-token-id',
        token_expires_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        token_expiry_authoritative: true,
        username: 'mansour',
      });

    const rotationClient = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ token_id: 'minted-token-id' }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    db.transaction.mockImplementationOnce(
      async (fn: (client: typeof rotationClient) => Promise<unknown>) => fn(rotationClient),
    );

    const store = new SessionStore({
      key,
      ttlDays: 60,
      uchiyomi: service as never,
    });

    const resolved = await store.resolveIdentity(
      '11111111-1111-1111-1111-111111111111',
      'device-1',
    );

    expect(service.mintToken).toHaveBeenCalledTimes(1);
    expect(service.mintToken).toHaveBeenCalledWith(
      oldToken,
      expect.objectContaining({
        scopes: ['read', 'write'],
        expiresInDays: 60,
        reconcileAmbiguousFailure: true,
      }),
    );
    expect(db.queryOne).toHaveBeenCalledTimes(1);
    expect(resolved).toMatchObject({
      token: 'minted-long-lived-token',
      tokenId: 'minted-token-id',
      username: 'mansour',
    });
  });

  it('fails closed when the stored content credential is already expired', async () => {
    const service = upstream();
    const key = Buffer.alloc(32, 19);
    db.queryOne.mockResolvedValueOnce({
      vantara_identity_id: '11111111-1111-1111-1111-111111111111',
      uchiyomi_user_id: 'upstream-user-1',
      token_encrypted: encrypt('expired-token', key),
      token_id: 'expired-token-id',
      token_expires_at: new Date(Date.now() - 1_000).toISOString(),
      token_expiry_authoritative: true,
      username: 'mansour',
    });
    db.query.mockResolvedValueOnce([]);

    const store = new SessionStore({
      key,
      ttlDays: 60,
      uchiyomi: service as never,
    });

    await expect(
      store.resolveIdentity('11111111-1111-1111-1111-111111111111', 'device-1'),
    ).rejects.toMatchObject({ name: 'IdentityRelinkRequiredError' });
    expect(service.mintToken).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('SET revoked_at = now()'),
      ['11111111-1111-1111-1111-111111111111'],
    );
  });
});


describe('SessionStore upstream credential authority', () => {
  it('persists the exact expiry reported by Uchiyomi token metadata', async () => {
    const service = upstream();
    const exactExpiry = '2026-10-31T12:34:56.789Z';
    service.listTokens.mockResolvedValue([
      {
        id: 'minted-token-id',
        name: 'vantara-authoritative-expiry',
        expiresAt: exactExpiry,
        expired: false,
      },
    ]);
    const client = { query: vi.fn(async () => ({ rows: [] })) };
    db.transaction.mockImplementationOnce(async (fn: (client: typeof client) => Promise<unknown>) =>
      fn(client),
    );

    const store = new SessionStore({
      key: Buffer.alloc(32, 23),
      ttlDays: 60,
      uchiyomi: service as never,
    });

    await store.login('mansour', 'password', 'expiry-device');

    expect(service.listTokens).toHaveBeenCalled();
    const identityWrite = client.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO vantara_identity_links'),
    );
    expect(identityWrite).toBeDefined();
    expect(identityWrite?.[1]).toContain(exactExpiry);
  });

  it('durably records an ambiguous token mint before the upstream POST', async () => {
    const service = upstream();
    service.mintToken.mockRejectedValueOnce(
      new UchiyomiError('upstream unavailable', 502, 'upstream_unavailable', '/api/tokens'),
    );
    service.listTokens.mockRejectedValueOnce(new Error('reconciliation unavailable'));

    const store = new SessionStore({
      key: Buffer.alloc(32, 29),
      ttlDays: 60,
      uchiyomi: service as never,
    });

    await expect(store.login('mansour', 'password', 'ambiguous-device')).rejects.toBeInstanceOf(
      AggregateError,
    );

    expect(
      db.query.mock.calls.some(([sql]) =>
        String(sql).includes('INSERT INTO vantara_token_mint_attempts'),
      ),
    ).toBe(true);
    expect(
      db.query.mock.calls.some(([sql]) =>
        String(sql).includes('resolved_at = now()'),
      ),
    ).toBe(false);
  });

  it('keeps an ambiguous mint attempt pending when immediate reconciliation sees no token yet', async () => {
    const service = upstream();
    service.mintToken.mockRejectedValueOnce(
      new UchiyomiError('upstream unavailable', 502, 'upstream_unavailable', '/api/tokens'),
    );
    service.listTokens.mockResolvedValueOnce([]);

    const store = new SessionStore({
      key: Buffer.alloc(32, 31),
      ttlDays: 60,
      uchiyomi: service as never,
    });

    await expect(store.login('mansour', 'password', 'late-commit-device')).rejects.toThrow(
      'upstream unavailable',
    );

    expect(
      db.query.mock.calls.some(([sql]) =>
        String(sql).includes('INSERT INTO vantara_token_mint_attempts'),
      ),
    ).toBe(true);
    expect(
      db.query.mock.calls.some(([sql]) =>
        String(sql).includes('resolved_at = now()'),
      ),
    ).toBe(false);
  });
});
