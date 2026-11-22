import { describe, expect, it, vi } from 'vitest';
import worker from './index.ts';
import { mintToken } from './session.ts';
import { sqliteEnv } from './test-d1.ts';

const SECRET = 'latest-source-secret-at-least-32-characters';
const A = '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed';
const B = 'bedcf897-a6f0-4730-b757-402b14891ca5';

describe('shared source Latest', () => {
  it.each([
    'eu.kanade.tachiyomi.extension.ar.mangalek',
    'eu.kanade.tachiyomi.extension.all.mangamillion#8929911308540155494',
    'eu.kanade.tachiyomi.extension.all.mangadex@en',
  ])('lets one device claim the first page and another read it for %s', async (sourceId) => {
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
    const claim = await send(A, '/v1/source-latest/claim', { sourceId });
    expect(claim.claimed).toBe(true);
    expect((await send(B, '/v1/source-latest/claim', { sourceId })).claimed).toBe(false);
    expect((await send(B, '/v1/source-latest', { sourceId, leaseUntil: 1, value: { mangas: [] } })).ok).toBe(false);
    expect((await send(A, '/v1/source-latest', { sourceId, leaseUntil: claim.leaseUntil, leaseToken: claim.leaseToken, value: { mangas: [{ title: 'عمل', url: '/one' }] } })).ok).toBe(true);
    const listing = await send(B, '/v1/source-latest') as { sources: Array<{ sourceId: string; value: { mangas: Array<{ title: string }> } }> };
    expect(listing.sources).toMatchObject([{ sourceId, value: { mangas: [{ title: 'عمل' }] } }]);
    expect((await send(B, '/v1/source-latest/claim', { sourceId })).claimed).toBe(false);
  });
});

it('accepts the first page after a cold extension spends more than 45 seconds preparing and fetching', async () => {
  const { env } = sqliteEnv({ VANTARA_SESSION_SECRET: SECRET });
  const sourceId = 'eu.kanade.tachiyomi.extension.all.mangamillion#8929911308540155494';
  const token = await mintToken(A, SECRET);
  const send = async (path: string, body: object) => {
    const response = await worker.fetch(new Request(`https://sync.test${path}`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...body, sourceId }),
    }), env, { waitUntil: () => {} });
    expect(response.status).toBe(200);
    return response.json() as Promise<Record<string, unknown>>;
  };
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  try {
    const claim = await send('/v1/source-latest/claim', {});
    expect(claim.claimed).toBe(true);
    clock.mockReturnValue(now + 65_000);
    const value = { mangas: [{ title: 'Spy x Family', url: '/title/8173' }] };
    expect((await send('/v1/source-latest', { leaseUntil: claim.leaseUntil, leaseToken: claim.leaseToken, value })).ok).toBe(true);
  } finally {
    clock.mockRestore();
  }
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
