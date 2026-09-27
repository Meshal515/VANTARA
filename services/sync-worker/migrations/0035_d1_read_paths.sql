-- Scope frequent per-user deltas before walking global revision history.
CREATE INDEX chapter_marks_user_rev ON chapter_marks (user_id, rev);
CREATE INDEX activity_receipts_user_rev ON activity_receipts (user_id, rev);
CREATE INDEX activity_actor_id ON activity (actor_id, id);
CREATE INDEX progress_user_rev ON progress (user_id, rev);
CREATE INDEX chapter_reads_user_rev ON chapter_reads (user_id, rev);
CREATE INDEX applied_ops_user ON applied_ops (user_id);

-- The translation owner is chosen by page count and earliest translation.
-- Keep that exact rule without regrouping the entire growing page table on
-- every Rafiq/translation availability request. Backfill once at migration.
CREATE TABLE translation_creator_totals (
  created_by TEXT PRIMARY KEY,
  page_count INTEGER NOT NULL,
  first_at INTEGER NOT NULL
);
INSERT INTO translation_creator_totals (created_by, page_count, first_at)
SELECT created_by, COUNT(*), MIN(created_at) FROM translation_pages GROUP BY created_by;
CREATE TRIGGER translation_creator_totals_insert AFTER INSERT ON translation_pages
BEGIN
  INSERT INTO translation_creator_totals (created_by, page_count, first_at)
  VALUES (NEW.created_by, 1, NEW.created_at)
  ON CONFLICT (created_by) DO UPDATE SET
    page_count = page_count + 1,
    first_at = MIN(first_at, excluded.first_at);
END;
CREATE INDEX translation_creator_rank ON translation_creator_totals (page_count DESC, first_at, created_by);
