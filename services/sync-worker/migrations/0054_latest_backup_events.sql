-- نسخة «آخر التحديثات» حدثًا حدثًا (28 نوفمبر): كانت صفًا واحدًا لكل حساب يستبدله كل جهاز (ON CONFLICT … SET payload)
-- فيمحو جهازٌ ما كشفه الآخر، وتُقلَّم بصمت إلى 1500 حدث. الآن صف لكل حدث: الأجهزة تُدمج بالمعرّف ولا يحل أحد محل أحد،
-- والرفع تفاضلي (الجديد فقط). الصف القديم يبقى ويُقرأ مع الأحداث (لا ترحيل يمحو شيئًا).
CREATE TABLE IF NOT EXISTS latest_backup_events (
  user_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, event_id)
);
CREATE INDEX IF NOT EXISTS latest_backup_events_page ON latest_backup_events (user_id, at, event_id);
