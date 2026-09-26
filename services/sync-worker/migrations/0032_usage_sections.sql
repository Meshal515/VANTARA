-- وقتك في كل قسم: المانجا تبقى في usage_daily (وقت القارئ كما كان)، وهذا
-- لما سواها — الأنمي من المشغّل، والسينما لاحقًا. «VANTARA» = مجموعها.
CREATE TABLE IF NOT EXISTS usage_sections (
  user_id    TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  section    TEXT NOT NULL,
  active_ms  INTEGER NOT NULL DEFAULT 0,
  rev        INTEGER NOT NULL,
  PRIMARY KEY (user_id, day, section)
);
