import { describe, expect, it, vi } from 'vitest';
import { UchiyomiClient } from './client.ts';

describe('UchiyomiClient token mint safety', () => {
  it('does not retry the non-idempotent POST after an ambiguous network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('socket closed after write');
    }) as unknown as typeof fetch;

    const client = new UchiyomiClient({
      baseUrl: 'http://uchiyomi.test',
      retries: 2,
      fetchImpl,
    });

    await expect(
      client.mintToken('session-token', {
        name: 'vantara test',
        scopes: ['read', 'write'],
        expiresInDays: 1,
      }),
    ).rejects.toThrow('upstream unavailable');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reconciles an ambiguous create by finding and revoking the uniquely named token', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.endsWith('/api/tokens') && method === 'POST') {
        // Uchiyomi may have committed this token before the response vanished.
        throw new TypeError('connection lost after commit');
      }
      if (url.endsWith('/api/tokens') && method === 'GET') {
        return new Response(
          JSON.stringify({
            content: [
              {
                id: 'ghost-token-id',
                name: 'vantara-unique-attempt',
                expiresAt: '2026-11-19T00:00:00.000Z',
                expired: false,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith('/api/tokens/ghost-token-id') && method === 'DELETE') {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    }) as unknown as typeof fetch;

    const client = new UchiyomiClient({
      baseUrl: 'http://uchiyomi.test',
      retries: 0,
      fetchImpl,
    });

    await expect(
      client.mintToken('session-token', {
        name: 'vantara-unique-attempt',
        scopes: ['read', 'write'],
        expiresInDays: 60,
        reconcileAmbiguousFailure: true,
      }),
    ).rejects.toThrow('upstream unavailable');

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1);
    expect(
      fetchImpl.mock.calls.some(
        (call) =>
          String(call[0]).endsWith('/api/tokens/ghost-token-id') &&
          call[1]?.method === 'DELETE',
      ),
    ).toBe(true);
  });
});
