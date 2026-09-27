import { describe, expect, it } from 'vitest';
import worker from './index.ts';
import { mintToken } from './session.ts';
import { sqliteEnv } from './test-d1.ts';

const SECRET = 'latest-source-secret-at-least-32-characters';
const A = '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed';
const B = 'bedcf897-a6f0-4730-b757-402b14891ca5';

describe('shared source Latest', () => {
  it('lets one device claim the first page and another read its result', async () => {
    const { env } = sqliteEnv({ VANTARA_SESSION_SECRET: SECRET });
    const send = async (as: string, path: string, body?: object) => {
      const token = await mintToken(as, SECRET);
      const res = await worker.fetch(new Request(`https://sync.test${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }), env, { waitUntil: () => {} });
      expect(res.status).toBe(200);
      return res.json() as Promise<Record<string, unknown>>;
    };
    const claim = await send(A, '/v1/source-latest/claim', { sourceId: 'ar.manga' });
    expect(claim.claimed).toBe(true);
    expect((await send(B, '/v1/source-latest/claim', { sourceId: 'ar.manga' })).claimed).toBe(false);
    expect((await send(B, '/v1/source-latest', { sourceId: 'ar.manga', leaseUntil: 1, value: { mangas: [] } })).ok).toBe(false);
    await send(A, '/v1/source-latest', { sourceId: 'ar.manga', leaseUntil: claim.leaseUntil, value: { mangas: [{ title: 'عمل', url: '/one' }] } });
    const listing = await send(B, '/v1/source-latest') as { sources: Array<{ sourceId: string; value: { mangas: Array<{ title: string }> } }> };
    expect(listing.sources).toMatchObject([{ sourceId: 'ar.manga', value: { mangas: [{ title: 'عمل' }] } }]);
    expect((await send(B, '/v1/source-latest/claim', { sourceId: 'ar.manga' })).claimed).toBe(false);
  });
});
