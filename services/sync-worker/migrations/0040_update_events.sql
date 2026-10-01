-- ذاكرة VANTARA للتحديثات: حدث لكل (عمل موحّد + فصل/موسم/حلقة)، والمصادر مجرد
-- مجسّات تُدمج تحته. الوقت يُثبَّت عند أول اكتشاف (أو وقت نشر موثوق) ولا يُعاد ضبطه.
-- بيانات عامة بلا حسابات: لا تدخل جداول الفروقات الشخصية.
CREATE TABLE IF NOT EXISTS update_events (
  id TEXT PRIMARY KEY,
  work TEXT NOT NULL,
  section TEXT NOT NULL CHECK (section IN ('manga', 'anime', 'cinema')),
  kind TEXT NOT NULL CHECK (kind IN ('chapter', 'episode', 'movie')),
  season INTEGER,
  number REAL,
  title TEXT NOT NULL,
  cover TEXT,
  at INTEGER NOT NULL,
  published_at INTEGER,
  first_seen_at INTEGER NOT NULL,
  sources TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS update_events_timeline ON update_events (section, at DESC, id DESC);
CREATE INDEX IF NOT EXISTS update_events_work ON update_events (work, at DESC);

-- خط الأساس لكل عمل: أول ما يراه VANTARA يُحفظ «موجودًا» بلا أحداث، وما بعده فقط
-- يصير تحديثًا. `max_season/max_number` أعلى وحدة معروفة (الموسم للمسلسلات فقط).
CREATE TABLE IF NOT EXISTS update_watermarks (
  work TEXT PRIMARY KEY,
  section TEXT NOT NULL CHECK (section IN ('manga', 'anime', 'cinema')),
  max_season INTEGER,
  max_number REAL,
  baseline_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
