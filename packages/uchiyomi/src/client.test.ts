import { describe, expect, it, vi } from 'vitest';
import { UchiyomiClient } from './client.ts';

describe('UchiyomiClient retry safety', () => {
  it('does not retry token minting after an ambiguous network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      // Simulates the dangerous case: upstream may have committed the POST,
      // then the response connection disappeared before VANTARA received it.
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
    ).rejects.toMatchObject({ status: 502, code: 'upstream_unavailable' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('lists token metadata without expecting token secrets back', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          content: [
            {
              id: 'tok-1',
              name: 'vantara-link:abc',
              scopes: ['read', 'write'],
              createdAt: '2026-09-01T00:00:00.000Z',
              lastSeen: null,
              expiresAt: '2026-11-01T00:00:00.000Z',
              expired: false,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    const client = new UchiyomiClient({ baseUrl: 'http://uchiyomi.test', fetchImpl });
    await expect(client.listTokens('current-token')).resolves.toEqual([
      expect.objectContaining({ id: 'tok-1', name: 'vantara-link:abc', expired: false }),
    ]);
  });
});
