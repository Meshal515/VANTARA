-- «فريم»: صفحات من فصل يرسلها قارئ لصديق.
--
-- مراجع لا صور: المستلم يجلب الصفحات من المصدر بمحرّكه. `work_json`
-- و`chapter_json` هما ما يحتاجه المحرّك ليطلب الفصل نفسه (ومنه `memo` الذي
-- يعيده المصدر كما خرج)، و`pages_json` مواضع الصفحات بترتيب الالتقاط.
--
-- صفٌّ لكل مستلم بقصد: الفريم خاص بين اثنين، والصديق الثالث لا يصل إليه
-- حتى في سجل الفروقات (انظر deltaScope في index.ts).
--
-- جدول جديد فقط: توسعة لا يرفض بعدها العاملُ القديم أي كتابة.

CREATE TABLE IF NOT EXISTS frames (
  id            TEXT PRIMARY KEY,
  from_id       TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  to_id         TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  source_id     TEXT NOT NULL,
  series_title  TEXT,
  chapter_label TEXT,
  cover_url     TEXT,
  work_json     TEXT NOT NULL,
  chapter_json  TEXT NOT NULL,
  pages_json    TEXT NOT NULL,
  message       TEXT,
  created_at    INTEGER NOT NULL,
  rev           INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS frames_rev ON frames (rev);
CREATE INDEX IF NOT EXISTS frames_recipient ON frames (to_id, created_at);
