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

  it('withdraws only the audited misattributed anime batch and synchronizes tombstones', () => {
    const friend = '07588797-a471-44d1-99ce-7fb4f188c196';
    const owner = 'bedcf897-a6f0-4730-b757-402b14891ca5';
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    for (const name of readdirSync(migrationsDir).filter((file) => file.endsWith('.sql') && !file.startsWith('0037_')).sort()) {
      db.exec(readFileSync(join(migrationsDir, name), 'utf8'));
    }
    db.prepare('UPDATE sync_state SET rev = ? WHERE id = 1').run(5500);

    const views = [
      ['anime:151970', 1, 1790478706783], ['anime:178789', 1, 1790372461855],
      ['anime:196187', 1, 1790459238250], ['anime:20981', 1, 1790420835363],
      ['anime:9253', 17, 1790450825861],
    ] as const;
    for (const [ref, episode, at] of views) {
      db.prepare('INSERT INTO work_views (user_id, series_ref, chapter_number, viewed_at, rev) VALUES (?, ?, ?, ?, ?)')
        .run(friend, ref, episode, at, 5407);
      db.prepare('INSERT INTO public_work_views (user_id, series_ref, chapter_number, viewed_at, rev) VALUES (?, ?, ?, ?, ?)')
        .run(friend, ref, episode, at, 5407);
      db.prepare('INSERT INTO work_views (user_id, series_ref, chapter_number, viewed_at, rev) VALUES (?, ?, ?, ?, ?)')
        .run(owner, ref, episode, at + 1, 5408);
    }
    db.prepare('UPDATE public_work_views SET rev = ? WHERE user_id = ? AND series_ref = ?')
      .run(5490, friend, 'anime:178789');
    db.prepare('INSERT INTO work_views (user_id, series_ref, viewed_at, rev) VALUES (?, ?, ?, ?)')
      .run(friend, 'ext:genuine-manga', 1790247147900, 984);
    for (const ref of ['anime:189046', 'anime:5114']) {
      db.prepare('INSERT INTO library (user_id, series_ref, added_at, rev) VALUES (?, ?, ?, ?)')
        .run(friend, ref, 1790517087585, 5407);
      db.prepare('INSERT INTO library (user_id, series_ref, added_at, rev) VALUES (?, ?, ?, ?)')
        .run(owner, ref, 1790436240678, 3654);
    }
    for (const ep of [1, 14, 15, 16]) {
      const key = `anime:9253#ep:${ep}`;
      db.prepare('INSERT INTO chapter_marks (user_id, chapter_key, series_ref, read, updated_at, rev) VALUES (?, ?, ?, 1, ?, ?)')
        .run(friend, key, 'anime:9253', 1790517087585, 5407);
      db.prepare('INSERT INTO chapter_marks (user_id, chapter_key, series_ref, read, updated_at, rev) VALUES (?, ?, ?, 1, ?, ?)')
        .run(owner, key, 'anime:9253', 1790450050913, 3771);
    }
    const repair = readFileSync(join(migrationsDir, '0037_repair_dahmi_anime_attribution.sql'), 'utf8');
    db.exec('BEGIN');
    db.exec(repair);
    db.exec('COMMIT');

    expect(db.prepare('SELECT rev FROM sync_state WHERE id = 1').get()).toEqual({ rev: 5501 });
    for (const table of ['work_views', 'public_work_views', 'library']) {
      const rows = db.prepare(`SELECT removed, rev FROM ${table} WHERE user_id = ? AND series_ref LIKE 'anime:%'`).all(friend);
      expect(rows.length).toBe(table === 'library' ? 2 : 5);
      expect(rows.every((row) => row.removed === 1 && row.rev === 5501)).toBe(true);
    }
    expect(db.prepare('SELECT read, rev FROM chapter_marks WHERE user_id = ?').all(friend))
      .toEqual(Array.from({ length: 4 }, () => ({ read: 0, rev: 5501 })));
    expect(db.prepare('SELECT removed, rev FROM work_views WHERE user_id = ? AND series_ref = ?').get(friend, 'ext:genuine-manga'))
      .toEqual({ removed: 0, rev: 984 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM work_views WHERE user_id = ? AND removed = 0').get(owner))
      .toEqual({ count: 5 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM sync_tx_guard').get()).toEqual({ count: 0 });

    // If a row changes between audit and deployment, the guard rejects the batch.
    const altered = new DatabaseSync(':memory:');
    altered.exec('PRAGMA foreign_keys = ON');
    for (const name of readdirSync(migrationsDir).filter((file) => file.endsWith('.sql') && !file.startsWith('0037_')).sort()) {
      altered.exec(readFileSync(join(migrationsDir, name), 'utf8'));
    }
    altered.prepare('INSERT INTO work_views (user_id, series_ref, viewed_at, rev) VALUES (?, ?, ?, ?)')
      .run(friend, 'anime:151970', 1790478706783, 5407);
    altered.exec('BEGIN');
    expect(() => altered.exec(repair)).toThrow();
    altered.exec('ROLLBACK');
    expect(altered.prepare('SELECT removed, rev FROM work_views WHERE user_id = ?').get(friend))
      .toEqual({ removed: 0, rev: 5407 });
  });
});
