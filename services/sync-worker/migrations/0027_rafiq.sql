-- «رفيق»: مساعد توصيات شخصي. كل ما هنا لكل مستخدم على حدة، ولا يُزامَن للأجهزة
-- (يُقرأ عبر /v1/rafiq وحده)، فلا محادثة تختلط بمحادثة أحد.

-- المحادثة: الرسائل الأخيرة تُرسل للنموذج كما هي، وما قبلها في ملخّص يتحدّث.
CREATE TABLE IF NOT EXISTS rafiq_conversations (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  summary     TEXT,
  summarized  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rafiq_conversations_user ON rafiq_conversations (user_id, updated_at);

-- رسالة المستخدم بمعرّف من الجهاز: إعادة المحاولة لا تكرر الرسالة ولا النداء.
CREATE TABLE IF NOT EXISTS rafiq_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES rafiq_conversations (id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  cards_json      TEXT,
  chips_json      TEXT,
  reply_to        TEXT UNIQUE,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rafiq_messages_conv ON rafiq_messages (conversation_id, created_at);

-- ذاكرة الذوق الصريحة والمستنتجة، بمصدرها؛ تُعرض وتُحذف من «ذاكرة رفيق».
CREATE TABLE IF NOT EXISTS rafiq_prefs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  key        TEXT NOT NULL,
  polarity   INTEGER NOT NULL CHECK (polarity IN (-1, 1)),
  source     TEXT NOT NULL CHECK (source IN ('explicit', 'behavioral', 'inferred')),
  strength   REAL NOT NULL DEFAULT 1,
  note       TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, kind, key)
);

-- كل اقتراح ظهر، وما صار بعده: فتح، بدأ، استمر، ترك، ورأي المستخدم.
CREATE TABLE IF NOT EXISTS rafiq_recs (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  message_id      TEXT NOT NULL,
  work_id         TEXT NOT NULL,
  title           TEXT,
  reason          TEXT,
  shown_at        INTEGER NOT NULL,
  opened_at       INTEGER,
  opened_ref      TEXT,
  started_at      INTEGER,
  continued_at    INTEGER,
  feedback        TEXT,
  feedback_at     INTEGER
);
CREATE INDEX IF NOT EXISTS rafiq_recs_user ON rafiq_recs (user_id, shown_at);
CREATE INDEX IF NOT EXISTS rafiq_recs_work ON rafiq_recs (user_id, work_id);

-- بيانات الأعمال من AniList (الأنواع، الوسوم، الطول، الحالة): تُجلب مرة وتُحفظ.
CREATE TABLE IF NOT EXISTS rafiq_meta (
  key        TEXT PRIMARY KEY,
  anilist_id INTEGER,
  data_json  TEXT,
  fetched_at INTEGER NOT NULL
);

-- ملف الذوق المحسوب (يُعاد حسابه حين يقدم) وإشارات الأنمي من الجهاز.
CREATE TABLE IF NOT EXISTS rafiq_profile (
  user_id     TEXT PRIMARY KEY REFERENCES accounts (user_id) ON DELETE CASCADE,
  data_json   TEXT NOT NULL,
  local_json  TEXT,
  computed_at INTEGER NOT NULL
);

-- المصروف الشهري على DeepSeek (سقف يوقف النداءات قبل أن يتجاوزه).
CREATE TABLE IF NOT EXISTS rafiq_spend (
  month      TEXT PRIMARY KEY,
  usd        REAL NOT NULL DEFAULT 0,
  calls      INTEGER NOT NULL DEFAULT 0
);
