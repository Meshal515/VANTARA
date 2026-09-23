-- تفاعلات المجلس (❤️ 🔥 …) على الفريم والترشيح والنشاط، وترشيح فصلٍ بعينه.
--
-- صف لكل شخص على كل هدف: التفاعل الجديد يستبدل القديم، و`emoji` فارغٌ يعني
-- «سحبت تفاعلي» (شاهد قبر لا حذف، فالسحب يُزامَن). ومن يرى التفاعل هو من
-- يرى هدفه — النطاق في deltaScope يكرّر شرط الهدف نفسه.
-- توسعة فقط: جدول جديد وعمودان بلا قيد.

CREATE TABLE IF NOT EXISTS majlis_reactions (
  target_kind TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  emoji       TEXT,
  updated_at  INTEGER NOT NULL,
  rev         INTEGER NOT NULL,
  PRIMARY KEY (target_kind, target_id, user_id)
);

CREATE INDEX IF NOT EXISTS majlis_reactions_rev ON majlis_reactions (rev);

ALTER TABLE recommendations ADD COLUMN chapter_label TEXT;
ALTER TABLE recommendations ADD COLUMN chapter_number REAL;
