-- قصص أعمال السينما بالعربية: تُترجم مرة واحدة لكل نص وتُخدم للجميع من هنا.
-- ليست بيانات حساب ولا تدخل جداول الفروقات.
CREATE TABLE IF NOT EXISTS cinema_overviews (
  key TEXT PRIMARY KEY,
  source_hash TEXT NOT NULL,
  text_ar TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cinema_overviews_by_user ON cinema_overviews (created_by, created_at);
