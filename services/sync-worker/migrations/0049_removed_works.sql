-- «حذف العمل» من التطبيق كله (قرار المالك، 16 نوفمبر 2026): المالك وحده يحذف ويعيد.
-- removed_works: أرشيف المالك (الاسم والغلاف والمفاتيح) — لا يصل غيره أبدًا.
-- removed_work_tokens: بصمات مفاتيح العمل فقط (بلا اسم ولا غلاف) تصل كل جهاز ليخفي العمل
-- من كل القوائم والبحث ويمنع فتحه؛ لا تكشف أي عمل حُذف.
CREATE TABLE IF NOT EXISTS removed_works (
  key         TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('anime', 'cinema', 'manga')),
  title       TEXT,
  cover       TEXT,
  keys_json   TEXT NOT NULL,
  tokens_json TEXT NOT NULL,
  removed_by  TEXT NOT NULL,
  removed_at  INTEGER NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  rev         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS removed_works_rev ON removed_works (rev);

CREATE TABLE IF NOT EXISTS removed_work_tokens (
  token     TEXT PRIMARY KEY,
  work_key  TEXT NOT NULL,
  active    INTEGER NOT NULL DEFAULT 1,
  rev       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS removed_work_tokens_rev ON removed_work_tokens (rev);
