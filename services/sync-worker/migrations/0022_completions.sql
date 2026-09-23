-- «المكتمل»: الأعمال التي أكملتها.
--
-- جدول مستقل لا نوعٌ رابع في `collections`: قيد CHECK هناك يحصر الأنواع في
-- ثلاثة، والهجرات توسعة فقط. صف لكل عمل، والإلغاء `member = 0` يُزامَن كغيره.

CREATE TABLE IF NOT EXISTS completions (
  user_id    TEXT NOT NULL,
  series_ref TEXT NOT NULL,
  member     INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  rev        INTEGER NOT NULL,
  PRIMARY KEY (user_id, series_ref)
);

CREATE INDEX IF NOT EXISTS completions_rev ON completions (rev);
