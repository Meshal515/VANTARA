import { describe, expect, it } from 'vitest';
import worker from './index.ts';
import { mintToken } from './session.ts';
import { sqliteEnv } from './test-d1.ts';
import { rafiqAllowed } from './rafiq.ts';
import { translationAllowed } from './translate.ts';

const A = '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed';
const B = 'bedcf897-a6f0-4730-b757-402b14891ca5';
const SECRET = 'd1-paths-secret-at-least-32-characters';

describe('bounded D1 reads', () => {
  it('uses user-scoped delta paths and preserves the sender/recipient visibility', async () => {
    const { env, db } = sqliteEnv({
      VANTARA_SESSION_SECRET: SECRET,
      VANTARA_IDENTITY_SECRET: 'identity-secret-for-tests-only-32-chars',
      VANTARA_DEVICE_PEPPER: 'device-pepper-for-tests-only-32-chars-x',
    });
    db.prepare("INSERT INTO activity(id,actor_id,verb,created_at,rev) VALUES ('event',?,'READ',0,3)").run(A);
    db.prepare("INSERT INTO activity_receipts(event_id,user_id,rev) VALUES ('event',?,3)").run(B);
    db.prepare("INSERT INTO chapter_marks(user_id,chapter_key,series_ref,read,updated_at,rev) VALUES (?,'chapter','work',1,0,3)").run(B);
    const observed: Array<{ sql: string; values: unknown[] }> = [];
    const prepare = env.DB.prepare.bind(env.DB);
    env.DB.prepare = (sql: string) => {
      const statement = prepare(sql);
      if (/^SELECT .* FROM (chapter_marks|activity_receipts|majlis_reactions) WHERE/.test(sql)) {
        const bind = statement.bind;
        statement.bind = (...values: unknown[]) => {
          observed.push({ sql, values });
          return bind(...values);
        };
      }
      return statement;
    };
    for (const userId of [A, B]) {
      const token = await mintToken(userId, SECRET);
      const response = await worker.fetch(new Request('https://sync.test/v1/sync?since=1', {
        headers: { authorization: `Bearer ${token}` },
      }), env, { waitUntil() {} });
      expect(response.status).toBe(200);
      const body = await response.json() as { changes: Record<string, Array<Record<string, unknown>>> };
      expect(body.changes.activity_receipts?.map((x) => x.user_id)).toEqual([B]);
      expect(body.changes.chapter_marks?.length ?? 0).toBe(userId === B ? 1 : 0);
    }
    const planFor = (name: string) => {
      const call = observed.find((x) => x.sql.includes(`FROM ${name} WHERE`));
      expect(call).toBeDefined();
      return db.prepare(`EXPLAIN QUERY PLAN ${call!.sql}`).all(...call!.values as Array<string | number>)
        .map((row) => String(row.detail)).join(' | ');
    };
    expect(planFor('chapter_marks')).toContain('chapter_marks_user_rev');
    expect(planFor('activity_receipts')).toContain('activity_receipts_user_rev');
    expect(planFor('activity_receipts')).not.toContain('SCAN activity_receipts USING INDEX activity_receipts_rev');
    expect(planFor('majlis_reactions')).not.toContain('SCAN majlis_reactions USING INDEX majlis_reactions_rev');
  });

  it('maintains the translation-owner ranking on inserts and ignores duplicate pages', async () => {
    const { env, db } = sqliteEnv();
    const add = db.prepare(`INSERT INTO translation_pages(page_hash,engine,width,height,regions_json,created_by,created_at)
      VALUES (?,'v1',1,1,'[]',?,?) ON CONFLICT DO NOTHING`);
    add.run('a', A, 10);
    add.run('b', B, 1);
    add.run('c', B, 2);
    add.run('c', A, 0);
    expect(db.prepare('SELECT page_count FROM translation_creator_totals WHERE created_by = ?').get(B)).toEqual({ page_count: 2 });
    expect(await translationAllowed(env, B)).toBe(true);
    expect(await translationAllowed(env, A)).toBe(false);
    expect(await rafiqAllowed(env, B)).toBe(true);
    const plan = db.prepare('EXPLAIN QUERY PLAN SELECT created_by FROM translation_creator_totals ORDER BY page_count DESC, first_at LIMIT 1')
      .all().map((row) => String(row.detail)).join(' | ');
    expect(plan).toContain('translation_creator_rank');
  });
});
