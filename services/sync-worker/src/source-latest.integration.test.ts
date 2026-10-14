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
    await send(A, '/v1/source-latest', { sourceId: 'ar.manga', leaseUntil: claim.leaseUntil, leaseToken: claim.leaseToken, value: { mangas: [{ title: 'عمل', url: '/one' }] } });
    const listing = await send(B, '/v1/source-latest') as { sources: Array<{ sourceId: string; value: { mangas: Array<{ title: string }> } }> };
    expect(listing.sources).toMatchObject([{ sourceId: 'ar.manga', value: { mangas: [{ title: 'عمل' }] } }]);
    expect((await send(B, '/v1/source-latest/claim', { sourceId: 'ar.manga' })).claimed).toBe(false);
  });
});

it('binds publication to an unexpired claim capability, including another device of the same account', async () => {
  const { env, db } = sqliteEnv({ VANTARA_SESSION_SECRET: SECRET });
  const send = async (body: object, path = '/v1/source-latest') => {
    const token = await mintToken(A, SECRET);
    const res = await worker.fetch(new Request(`https://sync.test${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }), env, { waitUntil: () => {} });
    return res.json() as Promise<Record<string, unknown>>;
  };
  const claim = await send({ sourceId: 'ar.secure' }, '/v1/source-latest/claim');
  expect(typeof claim.leaseToken).toBe('string');
  const value = { mangas: [{ title: 'Real' }] };
  expect((await send({ sourceId: 'ar.secure', leaseUntil: claim.leaseUntil, value })).ok).toBe(false);
  expect((await send({ sourceId: 'ar.secure', leaseUntil: claim.leaseUntil, leaseToken: 'wrong', value })).ok).toBe(false);
  const expired = Date.now() - 1;
  db.prepare('UPDATE source_latest SET lease_until = ? WHERE source_id = ?').run(expired, 'ar.secure');
  expect((await send({ sourceId: 'ar.secure', leaseUntil: expired, leaseToken: claim.leaseToken, value })).ok).toBe(false);
});
