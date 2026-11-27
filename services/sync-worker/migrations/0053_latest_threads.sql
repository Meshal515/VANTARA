-- آخر التحديثات المحلي (خطة 27 نوفمبر، المرحلة 7): الخيطان الرفيعان. الخادم لا يكشف ولا يقرر.
-- 1) نسخة الحساب: ملخص صغير من جهاز صاحبه (أحداث كشفها محليًا + خطوط الأساس)، لصاحبها وحده، يُستعاد في تثبيت جديد.
CREATE TABLE IF NOT EXISTS latest_backups (
  user_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- 2) إشارات الأصحاب: ما يكتشفه جهاز يصل لبقية حسابات النسخة فلا يطرق كل جهاز المصادر نفسها. ترحيل مؤقت (30 يومًا)
-- لا نتيجة محفوظة: النتائج على أجهزتهم. بلا روابط، ولا يُعاد المرسل في الرد.
CREATE TABLE IF NOT EXISTS latest_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  work TEXT NOT NULL,
  section TEXT NOT NULL CHECK (section IN ('manga', 'anime', 'cinema')),
  kind TEXT NOT NULL CHECK (kind IN ('chapter', 'episode', 'movie')),
  season INTEGER,
  number REAL,
  title TEXT NOT NULL,
  source_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (sender_id, event_id, source_id)
);
CREATE INDEX IF NOT EXISTS latest_signals_created ON latest_signals (created_at);
