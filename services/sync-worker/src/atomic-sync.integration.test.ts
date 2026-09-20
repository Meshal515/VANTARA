import { describe, expect, it } from 'vitest';
import worker from './index.ts';
import { mintToken } from './session.ts';
import { sqliteEnv } from './test-d1.ts';
import type { D1PreparedStatement, Env } from './types.ts';

const SECRET = 'atomic-sync-secret-that-is-at-least-32-chars';
const USER = '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed';
const ctx: ExecutionContext = { waitUntil() {} };

function testEnv() {
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

async function token() {
  return mintToken(USER, SECRET);
}

async function postOps(env: Env, ops: unknown[]) {
  return worker.fetch(
    new Request('https://worker.test/v1/ops', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await token()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ops }),
    }),
    env,
    ctx,
  );
}

async function pull(env: Env, since: number) {
  return worker.fetch(
    new Request(`https://worker.test/v1/sync?since=${String(since)}`, {
      headers: { authorization: `Bearer ${await token()}` },
    }),
    env,
    ctx,
  );
}

describe('atomic sync revision + op claims', () => {
  it('never exposes a cursor revision before the rows carrying it commit', async () => {
    const { env, db } = testEnv();
    const originalBatch = env.DB.batch.bind(env.DB);
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const paused = new Promise<void>((resolve) => { reached = resolve; });
    let held = false;

    const guardedEnv = {
      ...env,
      DB: {
        ...env.DB,
        batch: async (statements: D1PreparedStatement[]) => {
          const isCommitBatch = statements.some((statement) =>
            String((statement as unknown as { sql?: string }).sql ?? '').includes(
              'INSERT INTO sync_revision_claims',
            ),
          );
          if (isCommitBatch && !held) {
            held = true;
            reached();
            await gate;
          }
          return originalBatch(statements);
        },
      },
    } as Env;

    const write = postOps(guardedEnv, [
      { opId: 'favorite-x', kind: 'favorite.set', payload: { seriesRef: 'series-1', member: true } },
    ]);
    await paused;

    const during = await pull(guardedEnv, 0);
    expect(during.status).toBe(200);
    const duringBody = (await during.json()) as {
      cursor: number;
      changes: { collections?: unknown[] };
    };
    expect(duringBody.cursor).toBe(0);
    expect(duringBody.changes.collections ?? []).toHaveLength(0);

    release();
    const written = await write;
    expect(written.status).toBe(200);

    const after = await pull(guardedEnv, 0);
    const afterBody = (await after.json()) as {
      cursor: number;
      changes: { collections?: Array<{ series_ref: string; member: number }> };
    };
    expect(afterBody.cursor).toBe(1);
    expect(afterBody.changes.collections).toEqual(
      expect.arrayContaining([expect.objectContaining({ series_ref: 'series-1', member: 1 })]),
    );
    expect(db.prepare('SELECT rev FROM sync_state WHERE id = 1').get()).toMatchObject({ rev: 1 });
  });

  it('does not let a replayed old setter overwrite a newer state', async () => {
    const { env, db } = testEnv();
    const oldOp = {
      opId: 'favorite-old',
      kind: 'favorite.set',
      payload: { seriesRef: 'series-1', member: true },
    };
    const newOp = {
      opId: 'favorite-new',
      kind: 'favorite.set',
      payload: { seriesRef: 'series-1', member: false },
    };

    expect((await postOps(env, [oldOp])).status).toBe(200);
    expect((await postOps(env, [newOp])).status).toBe(200);
    const before = db
      .prepare("SELECT member, rev FROM collections WHERE user_id = ? AND kind = 'favorite' AND series_ref = ?")
      .get(USER, 'series-1') as { member: number; rev: number };
    expect(before.member).toBe(0);

    const replay = await postOps(env, [oldOp]);
    expect(replay.status).toBe(200);
    const replayBody = (await replay.json()) as { applied: string[]; skipped: string[]; cursor: number };
    expect(replayBody.applied).not.toContain('favorite-old');
    expect(replayBody.skipped).toContain('favorite-old');

    const after = db
      .prepare("SELECT member, rev FROM collections WHERE user_id = ? AND kind = 'favorite' AND series_ref = ?")
      .get(USER, 'series-1') as { member: number; rev: number };
    expect(after).toEqual(before);
  });

  it('isolates an invalid recommendation response while applying a valid op beside it', async () => {
    const { env, db } = testEnv();
    const response = await postOps(env, [
      {
        opId: 'stale-recommendation',
        kind: 'recommendation.respond',
        payload: { recommendationId: 'missing', state: 'REJECTED' },
      },
      { opId: 'usage-good', kind: 'usage.add', payload: { activeMs: 5000 } },
    ]);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { applied: string[] };
    expect(body.applied).toContain('usage-good');
    expect(body.applied).not.toContain('stale-recommendation');
    expect(
      db.prepare('SELECT active_ms FROM usage_daily WHERE user_id = ?').get(USER),
    ).toMatchObject({ active_ms: 5000 });
  });

  it('isolates a stale reply FK instead of rolling back a valid write in the same request', async () => {
    const { env, db } = testEnv();
    const response = await postOps(env, [
      {
        opId: 'stale-reply',
        kind: 'comment.add',
        payload: { seriesRef: 'series-1', parentId: 'missing-parent', body: 'رد قديم' },
      },
      {
        opId: 'favorite-good',
        kind: 'favorite.set',
        payload: { seriesRef: 'series-1', member: true },
      },
    ]);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { applied: string[] };
    expect(body.applied).toContain('favorite-good');
    expect(body.applied).not.toContain('stale-reply');
    expect(db.prepare('SELECT id FROM comments WHERE id = ?').get('stale-reply')).toBeUndefined();
    expect(
      db
        .prepare("SELECT member FROM collections WHERE user_id = ? AND kind = 'favorite' AND series_ref = ?")
        .get(USER, 'series-1'),
    ).toMatchObject({ member: 1 });
  });
});
