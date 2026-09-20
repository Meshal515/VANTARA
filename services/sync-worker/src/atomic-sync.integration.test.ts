import { describe, expect, it } from 'vitest';
import worker from './index.ts';
import { mintToken } from './session.ts';
import { sqliteEnv } from './test-d1.ts';
import type { D1PreparedStatement, Env } from './types.ts';

const SECRET = 'atomic-sync-secret-that-is-at-least-32-chars';
const USER = '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed';

function atomicEnv() {
  const out = sqliteEnv({
    VANTARA_SESSION_SECRET: SECRET,
    VANTARA_IDENTITY_SECRET: 'identity-secret-for-tests-only-32-chars',
    VANTARA_DEVICE_PEPPER: 'device-pepper-for-tests-only-32-chars-x',
  });
  out.db
    .prepare('INSERT OR IGNORE INTO accounts (user_id, username, created_at, rev) VALUES (?, ?, ?, 0)')
    .run(USER, 'mishal', 1);
  return out;
}

async function postOps(
  env: Env,
  ops: Array<{ opId: string; kind: string; payload: Record<string, unknown> }>,
): Promise<Response> {
  const token = await mintToken(USER, SECRET);
  return worker.fetch(
    new Request('https://worker.test/v1/ops', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ops }),
    }),
    env,
    { waitUntil: () => {} },
  );
}

async function pull(env: Env, since = 0): Promise<Response> {
  const token = await mintToken(USER, SECRET);
  return worker.fetch(
    new Request(`https://worker.test/v1/sync?since=${String(since)}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    env,
    { waitUntil: () => {} },
  );
}

describe('atomic sync write invariants', () => {
  it('does not expose a revision to pull before the row carrying it commits', async () => {
    const { env, db } = atomicEnv();
    const originalBatch = env.DB.batch.bind(env.DB);

    let enteredResolve!: () => void;
    const entered = new Promise<void>((resolve) => { enteredResolve = resolve; });
    let releaseResolve!: () => void;
    const release = new Promise<void>((resolve) => { releaseResolve = resolve; });
    let held = false;

    (env.DB as unknown as { batch(statements: D1PreparedStatement[]): Promise<unknown[]> }).batch =
      async (statements) => {
        if (!held) {
          held = true;
          enteredResolve();
          await release;
        }
        return originalBatch(statements);
      };

    const write = postOps(env, [
      {
        opId: 'cursor-race-op',
        kind: 'favorite.set',
        payload: { seriesRef: 'src:test:atomic', member: true },
      },
    ]);

    await entered;

    const during = await pull(env, 0);
    expect(during.status).toBe(200);
    const duringBody = (await during.json()) as {
      cursor: number;
      changes: { collections?: unknown[] };
    };
    expect(duringBody.cursor).toBe(0);
    expect(duringBody.changes.collections ?? []).toEqual([]);

    releaseResolve();
    const writeResponse = await write;
    expect(writeResponse.status).toBe(200);

    const row = db
      .prepare(
        "SELECT member, rev FROM collections WHERE user_id = ? AND kind = 'favorite' AND series_ref = ?",
      )
      .get(USER, 'src:test:atomic') as { member: number; rev: number };
    expect(row.member).toBe(1);
    expect(row.rev).toBeGreaterThan(0);

    const after = await pull(env, 0);
    const afterBody = (await after.json()) as {
      cursor: number;
      changes: { collections?: Array<{ series_ref: string; member: number }> };
    };
    expect(afterBody.cursor).toBeGreaterThanOrEqual(row.rev);
    expect(afterBody.changes.collections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ series_ref: 'src:test:atomic', member: 1 }),
      ]),
    );
  });

  it('never lets a stale retry of the same op_id overwrite a newer setter', async () => {
    const { env, db } = atomicEnv();

    const old = {
      opId: 'favorite-old',
      kind: 'favorite.set',
      payload: { seriesRef: 'src:test:stale', member: true },
    };
    await postOps(env, [old]);
    await postOps(env, [
      {
        opId: 'favorite-new',
        kind: 'favorite.set',
        payload: { seriesRef: 'src:test:stale', member: false },
      },
    ]);

    const before = db
      .prepare(
        "SELECT member, rev FROM collections WHERE user_id = ? AND kind = 'favorite' AND series_ref = ?",
      )
      .get(USER, 'src:test:stale') as { member: number; rev: number };
    const cursorBefore = (
      db.prepare('SELECT rev FROM sync_state WHERE id = 1').get() as { rev: number }
    ).rev;

    const replay = await postOps(env, [old]);
    expect(replay.status).toBe(200);

    const after = db
      .prepare(
        "SELECT member, rev FROM collections WHERE user_id = ? AND kind = 'favorite' AND series_ref = ?",
      )
      .get(USER, 'src:test:stale') as { member: number; rev: number };
    const cursorAfter = (
      db.prepare('SELECT rev FROM sync_state WHERE id = 1').get() as { rev: number }
    ).rev;

    expect(before.member).toBe(0);
    expect(after).toEqual(before);
    expect(cursorAfter).toBe(cursorBefore);
  });

  it('isolates an invalid recommendation response without poisoning a valid write beside it', async () => {
    const { env, db } = atomicEnv();

    const response = await postOps(env, [
      {
        opId: 'stale-recommendation',
        kind: 'recommendation.respond',
        payload: { recommendationId: 'missing-recommendation', state: 'ACCEPTED' },
      },
      {
        opId: 'good-favorite',
        kind: 'favorite.set',
        payload: { seriesRef: 'src:test:good', member: true },
      },
    ]);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { applied: string[]; skipped: string[] };
    expect(body.applied).toContain('good-favorite');
    expect(body.applied).not.toContain('stale-recommendation');

    const row = db
      .prepare(
        "SELECT member FROM collections WHERE user_id = ? AND kind = 'favorite' AND series_ref = ?",
      )
      .get(USER, 'src:test:good') as { member: number };
    expect(row.member).toBe(1);
  });
});
