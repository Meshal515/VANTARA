-- «حذف للجميع» في آخر ما صار: صاحب الفريم أو الترشيح أو النشاط يسحبه من عند
-- الكل. الحذف شاهد قبر (`removed = 1`) لا مسح: الفروقات تحمله لكل جهاز فيختفي
-- من مراياهم، والمحتوى نفسه يُفرَّغ عند السحب.
ALTER TABLE frames ADD COLUMN removed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recommendations ADD COLUMN removed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE activity ADD COLUMN removed INTEGER NOT NULL DEFAULT 0;
