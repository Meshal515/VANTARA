import { describe, expect, it, vi } from 'vitest';
import { UchiyomiClient } from './client.ts';
import { UchiyomiError } from './types.ts';

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

    const promise = client.mintToken('session-token', {
      name: 'vantara test',
      scopes: ['read', 'write'],
      expiresInDays: 1,
    });
    await expect(promise).rejects.toMatchObject({
      name: 'UchiyomiError',
      status: 502,
      code: 'upstream_unavailable',
    });
    await expect(promise).rejects.toBeInstanceOf(UchiyomiError);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
