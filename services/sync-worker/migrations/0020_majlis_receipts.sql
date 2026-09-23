-- إيصالات المجلس: وصله، ثم شافه.
--
-- المرسل كان يرى «وصله» إلى الأبد: الترشيح يحمل حالة قبول/رفض لا يغيّرها
-- إلا زرّ لم يعد في الواجهة، والفريم بلا حالة أصلًا. هنا صف لكل شخص على كل
-- رسالة، يُكتب حين تصل جهازه وحين تظهر أمامه، ولا يرجع للخلف.

CREATE TABLE IF NOT EXISTS majlis_receipts (
  target_kind  TEXT NOT NULL,
  target_id    TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  delivered_at INTEGER,
  seen_at      INTEGER,
  rev          INTEGER NOT NULL,
  PRIMARY KEY (target_kind, target_id, user_id)
);

CREATE INDEX IF NOT EXISTS majlis_receipts_rev ON majlis_receipts (rev);
