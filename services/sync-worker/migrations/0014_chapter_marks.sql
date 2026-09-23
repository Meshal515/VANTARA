-- عين الفصل: «قرأته» أو «ما قرأته» لكل فصل، يضعها القارئ بيده أو يضعها
-- القارئ الذكي عند ٢٠٪ من الفصل.
--
-- منفصلة عن chapter_reads بقصد: تلك إحصاء قراءةٍ كاملة يراه الأصدقاء ولا
-- يُلغى، وهذه علامة شخصية تُلغى بلمسة. خلطهما يجعل «ألغيت العلامة» تمحو
-- قراءةً حقيقية من الإحصاء، أو يجعل لمسة العين تُعلن للأصدقاء فصلًا لم يُقرأ.
--
-- آخر كتابة تفوز، وللمالك وحده (انظر deltaScope). جدول جديد فقط: توسعة.

CREATE TABLE IF NOT EXISTS chapter_marks (
  user_id     TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  chapter_key TEXT NOT NULL,
  series_ref  TEXT NOT NULL,
  read        INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  rev         INTEGER NOT NULL,
  PRIMARY KEY (user_id, chapter_key)
);

CREATE INDEX IF NOT EXISTS chapter_marks_rev ON chapter_marks (rev);
CREATE INDEX IF NOT EXISTS chapter_marks_series ON chapter_marks (user_id, series_ref);
