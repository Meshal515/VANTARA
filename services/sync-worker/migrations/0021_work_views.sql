-- «آخر المشاهدات»: سجلّ واحد في الحساب.
--
-- السجل كان في الجهاز وحده (`vantara.v35.history`)، فجوالك وجوال صديقك
-- وملفك الشخصي ثلاث نسخ لا تتفق، وحذف عمل من واحدة يبقيه في البقية. هنا صف
-- لكل عمل فتحته: آخر فصل وآخر وقت، والحذف شاهد قبر يُزامَن كغيره.

CREATE TABLE IF NOT EXISTS work_views (
  user_id        TEXT NOT NULL,
  series_ref     TEXT NOT NULL,
  series_title   TEXT,
  cover_url      TEXT,
  chapter_label  TEXT,
  chapter_number REAL,
  viewed_at      INTEGER NOT NULL,
  removed        INTEGER NOT NULL DEFAULT 0,
  rev            INTEGER NOT NULL,
  PRIMARY KEY (user_id, series_ref)
);

CREATE INDEX IF NOT EXISTS work_views_rev ON work_views (rev);
