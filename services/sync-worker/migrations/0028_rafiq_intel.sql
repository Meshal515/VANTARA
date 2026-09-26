-- «رفيق» — أساس الذكاء: محاسبة كل نداء، كاش نتائج الأدوات، وما قرأته برا التطبيق.

-- كل نداء للنموذج: من أي مهارة، بأي نموذج وتفكير، كم كلّف وكم أخذ وقت.
-- لا يُحفظ هنا أي نص ولا تفكير داخلي: أرقام فقط.
CREATE TABLE IF NOT EXISTS rafiq_usage (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  request_id    TEXT,
  skill         TEXT,
  purpose       TEXT NOT NULL,
  model         TEXT NOT NULL,
  effort        TEXT NOT NULL,
  input_hit     INTEGER NOT NULL DEFAULT 0,
  input_miss    INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  usd           REAL NOT NULL DEFAULT 0,
  latency_ms    INTEGER NOT NULL DEFAULT 0,
  ok            INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rafiq_usage_time ON rafiq_usage (created_at);
CREATE INDEX IF NOT EXISTS rafiq_usage_user ON rafiq_usage (user_id, created_at);

-- نتائج الأدوات (ملف عمل، ترتيب، آراء القرّاء): تُجلب مرة وتُخدم حتى تقدم.
CREATE TABLE IF NOT EXISTS rafiq_tool_cache (
  key        TEXT PRIMARY KEY,
  tool       TEXT NOT NULL,
  data_json  TEXT NOT NULL,
  source     TEXT,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- قرأه أو شاهده برا التطبيق: لا يُقترح ثانية، ويدخل في الذوق بمصدره.
CREATE TABLE IF NOT EXISTS rafiq_external (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  work_id     TEXT NOT NULL,
  title       TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('manga', 'anime')),
  status      TEXT NOT NULL CHECK (status IN ('completed', 'reading', 'dropped', 'planning')),
  progress    INTEGER,
  rating      INTEGER,
  note        TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE (user_id, work_id)
);

-- ما يرافق رد رفيق غير البطاقات: قائمة ترتيب، جدول مقارنة، بطاقة ذوق.
ALTER TABLE rafiq_messages ADD COLUMN extra_json TEXT;
