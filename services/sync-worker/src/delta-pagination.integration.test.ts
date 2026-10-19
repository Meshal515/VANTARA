import { describe, expect, it } from 'vitest';
import worker from './index.ts';
import { mintToken } from './session.ts';
import { sqliteEnv } from './test-d1.ts';
import type { Env } from './types.ts';

const SECRET = 'delta-boundary-secret-that-is-at-least-32-chars';
const USER = '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed';

function testEnv() {
  const out = sqliteEnv({
    VANTARA_SESSION_SECRET: SECRET,
    VANTARA_IDENTITY_SECRET: 'identity-secret-for-tests-only-32-chars',
    VANTARA_DEVICE_PEPPER: 'device-pepper-for-tests-only-32-chars-x',
  });
  // رقم المراجعة في هذا الاختبار للفصول فقط، والمالك مجهّز سلفًا.
  out.db.prepare("UPDATE accounts SET badge = 'owner' WHERE username = 'ngm'").run();
  return out;
}

async function pull(env: Env, since: number, afterZero = false): Promise<Response> {
  const token = await mintToken(USER, SECRET);
  return worker.fetch(
    new Request(`https://worker.test/v1/sync?since=${String(since)}${afterZero ? '&afterZero=1' : ''}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    env,
    { waitUntil: () => {} },
  );
}

describe('delta pagination revision boundaries', () => {
  it('resumes after 600 migrated rev-zero rows without replaying that batch or losing rev-one rows', async () => {
    const { env, db } = testEnv();
    try {
      db.prepare('INSERT OR IGNORE INTO accounts (user_id, username, created_at, rev) VALUES (?, ?, ?, ?)')
        .run(USER, 'mishal', 1, 0);
      const insert = db.prepare(
        `INSERT INTO activity (id, actor_id, verb, series_ref, payload, created_at, rev)
         VALUES (?, ?, 'READ', NULL, '{}', ?, ?)`,
      );
      db.exec('BEGIN');
      try {
        for (let index = 0; index < 600; index++) insert.run(`legacy-${index}`, USER, index + 1, 0);
        insert.run('recent-one', USER, 999, 1);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      db.prepare('UPDATE sync_state SET rev = 2 WHERE id = 1').run();

      const initial = await pull(env, 0);
      expect(initial.status).toBe(200);
      const first = (await initial.json()) as {
        cursor: number; more: boolean;
        changes: { activity?: Array<{ id: string }> };
      };
      expect(first.cursor).toBe(0);
      expect(first.more).toBe(true);
      expect(first.changes.activity?.filter((row) => row.id.startsWith('legacy-'))).toHaveLength(600);

      // Keep since=0 backward-compatible for old clients.
      const replay = (await (await pull(env, 0)).json()) as { changes: { activity?: Array<{ id: string }> } };
      expect(replay.changes.activity?.some((row) => row.id === 'legacy-0')).toBe(true);

      const continuation = (await (await pull(env, 0, true)).json()) as {
        cursor: number; more: boolean;
        changes: { activity?: Array<{ id: string }> };
      };
      expect(continuation.changes.activity?.map((row) => row.id)).toContain('recent-one');
      expect(continuation.changes.activity?.some((row) => row.id.startsWith('legacy-'))).toBe(false);
      expect(continuation.cursor).toBe(2);
      expect(continuation.more).toBe(false);
    } finally {
      db.close();
    }
  });

  it('does not drop rows when the page cap cuts through a shared revision', async () => {
    const { env, db } = testEnv();
    db.prepare('INSERT OR IGNORE INTO accounts (user_id, username, created_at, rev) VALUES (?, ?, ?, ?)')
      .run(USER, 'mishal', 1, 1);

    const insert = db.prepare(
      `INSERT INTO activity
         (id, actor_id, verb, series_ref, payload, created_at, rev)
       VALUES (?, ?, 'READ', NULL, '{}', ?, ?)`,
    );

    db.exec('BEGIN');
    try {
      for (let index = 0; index < 599; index++) {
        // 499 rows at rev=10, then 100 rows at rev=11. PAGE_SIZE=500 therefore
        // cuts after the first row of rev=11.
        insert.run(`event-${String(index)}`, USER, index + 1, index < 499 ? 10 : 11);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    db.prepare('UPDATE sync_state SET rev = 11 WHERE id = 1').run();

    const delivered = new Set<string>();
    let cursor = 0;
    for (let page = 0; page < 3; page++) {
      const response = await pull(env, cursor);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        cursor: number;
        more: boolean;
        changes: { activity?: Array<{ id: string }> };
      };
      for (const row of body.changes.activity ?? []) delivered.add(row.id);
      cursor = body.cursor;
      if (!body.more) break;
    }

    expect(delivered.size).toBe(599);
    expect(cursor).toBe(11);
  });
});
