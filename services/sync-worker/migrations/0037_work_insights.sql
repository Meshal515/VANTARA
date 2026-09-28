-- وقت المتابعة يخص صاحبه. لا يدخل جدول الفروقات الاجتماعي ولا جدول الأعمال العام.
CREATE TABLE IF NOT EXISTS work_insights (
  user_id TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  series_ref TEXT NOT NULL,
  section TEXT NOT NULL CHECK (section IN ('manga', 'anime', 'cinema')),
  series_title TEXT,
  cover_url TEXT,
  active_ms INTEGER NOT NULL DEFAULT 0 CHECK (active_ms >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, series_ref)
);
CREATE INDEX IF NOT EXISTS work_insights_user_time ON work_insights (user_id, active_ms DESC);
