import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(import.meta.dirname, '../migrations');

function migratedDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const name of readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(migrationsDir, name), 'utf8'));
  }
  return db;
}

describe('D1 migrations', () => {
  it('backfills translation creators once and keeps verifier cleanup on key ranges', () => {
    const db = new DatabaseSync(':memory:');
    for (const name of readdirSync(migrationsDir).filter((file) => file.endsWith('.sql') && !file.startsWith('0035_')).sort()) {
      db.exec(readFileSync(join(migrationsDir, name), 'utf8'));
    }
    const insert = db.prepare(`INSERT INTO translation_pages(page_hash,engine,width,height,regions_json,created_by,created_at)
      VALUES (?,'v1',1,1,'[]',?,?)`);
    insert.run('a', 'owner', 100);
    insert.run('b', 'owner', 20);
    db.exec(readFileSync(join(migrationsDir, '0035_d1_read_paths.sql'), 'utf8'));
    expect(db.prepare('SELECT page_count, first_at FROM translation_creator_totals WHERE created_by = ?').get('owner'))
      .toEqual({ page_count: 2, first_at: 20 });
    const plan = db.prepare("EXPLAIN QUERY PLAN DELETE FROM op_claims WHERE op_id >= '__verify__' AND op_id < '__verify_`'")
      .all().map((row) => String(row.detail)).join(' | ');
    expect(plan).toContain('SEARCH op_claims USING INDEX');
    const applied = db.prepare('EXPLAIN QUERY PLAN DELETE FROM applied_ops WHERE user_id = ?')
      .all('owner').map((row) => String(row.detail)).join(' | ');
    expect(applied).toContain('applied_ops_user');
  });
  it('persists top works without losing existing collection kinds', () => {
    const db = migratedDatabase();
    const userId = '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed';

    const insert = db.prepare(
      `INSERT INTO collections
         (user_id, kind, series_ref, member, position, updated_at, rev)
       VALUES (?, ?, ?, 1, ?, 1, 1)`,
    );
    insert.run(userId, 'favorite', 'series:fav', 0);
    insert.run(userId, 'read_later', 'series:later', 1);
    insert.run(userId, 'top', 'series:top', 2);

    const rows = db
      .prepare('SELECT kind, series_ref FROM collections ORDER BY position')
      .all() as Array<{ kind: string; series_ref: string }>;
    expect(rows).toEqual([
      { kind: 'favorite', series_ref: 'series:fav' },
      { kind: 'read_later', series_ref: 'series:later' },
      { kind: 'top', series_ref: 'series:top' },
    ]);
  });
});
