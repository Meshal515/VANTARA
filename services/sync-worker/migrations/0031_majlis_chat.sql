-- المجلس محادثة حقيقية: رسائل منظّمة لا نص يُحلَّل.
--
-- kind: text | voice (والمستقبل: clip). الترشيحات والفريمات تبقى في جداولها
-- (مرجع العمل الحقيقي)، والمجلس يعرضها في نفس الخط الزمني.
-- reply_to: "msg:<id>" | "rec:<id>" | "frame:<id>" — الرد يشير لمعرّف لا لنص.
-- id = opId من العميل: إعادة الإرسال بعد انقطاع لا تكرّر الرسالة.
-- deleted: 0 باقية، 1 حذفها صاحبها للجميع، 2 حذفها المالك للجميع. المحتوى
-- يُفرَّغ عند الحذف، والصف يبقى شاهد قبر يصل كل جهاز.
CREATE TABLE IF NOT EXISTS majlis_messages (
  id          TEXT PRIMARY KEY,
  sender_id   TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  body        TEXT,
  reply_to    TEXT,
  ref         TEXT,
  media_key   TEXT,
  meta_json   TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0,
  deleted_by  TEXT,
  rev         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS majlis_messages_rev ON majlis_messages (rev);
CREATE INDEX IF NOT EXISTS majlis_messages_created ON majlis_messages (created_at);

-- «إخفاء لدي»: لصاحبه وحده، ولا يمسّ ما يراه غيره.
-- target: "msg:<id>" | "rec:<id>" | "frame:<id>" | "activity:<id>"
CREATE TABLE IF NOT EXISTS majlis_hidden (
  user_id    TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  target     TEXT NOT NULL,
  hidden_at  INTEGER NOT NULL,
  rev        INTEGER NOT NULL,
  PRIMARY KEY (user_id, target)
);
CREATE INDEX IF NOT EXISTS majlis_hidden_rev ON majlis_hidden (rev);

-- اسم المجلس وصورته: صفّ واحد (id = 'main')، يعدّله المالك من الخادم.
CREATE TABLE IF NOT EXISTS majlis_meta (
  id          TEXT PRIMARY KEY,
  name        TEXT,
  avatar_key  TEXT,
  updated_by  TEXT,
  updated_at  INTEGER NOT NULL,
  rev         INTEGER NOT NULL
);

-- آخر ما قرأه كل عضو في المجلس: عدد غير المقروء، ولا شيء أكثر.
CREATE TABLE IF NOT EXISTS majlis_reads (
  user_id  TEXT PRIMARY KEY REFERENCES accounts (user_id) ON DELETE CASCADE,
  read_at  INTEGER NOT NULL,
  rev      INTEGER NOT NULL
);

-- شارة المالك: يكتبها الخادم وحده من إعداده (VANTARA_OWNERS)، لا عميل.
ALTER TABLE accounts ADD COLUMN badge TEXT;

-- كل سحب يقرأ هذه الجداول بـ rev: فهرس لكلٍّ منها
CREATE INDEX IF NOT EXISTS majlis_meta_rev ON majlis_meta (rev);
CREATE INDEX IF NOT EXISTS majlis_reads_rev ON majlis_reads (rev);
