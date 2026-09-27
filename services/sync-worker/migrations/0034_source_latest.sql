-- لقطة أحدث أعمال كل مصدر متاحة للحسابات كلها؛ جهاز واحد يجدّدها والبقية تقرؤها.
CREATE TABLE source_latest (
  source_id TEXT PRIMARY KEY,
  payload TEXT,
  fetched_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX source_latest_fetched_at ON source_latest (fetched_at);
