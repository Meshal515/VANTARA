-- سجل المالك خاص؛ هذه نسخة اجتماعية مستقلة يمكن سحبها بالكامل.
CREATE TABLE public_work_views (
  user_id TEXT NOT NULL,
  series_ref TEXT NOT NULL,
  series_title TEXT,
  cover_url TEXT,
  chapter_label TEXT,
  chapter_number REAL,
  viewed_at INTEGER NOT NULL,
  removed INTEGER NOT NULL DEFAULT 0,
  rev INTEGER NOT NULL,
  social_at INTEGER,
  published INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, series_ref)
);
CREATE INDEX public_work_views_rev ON public_work_views (rev);
CREATE INDEX public_work_views_social_at ON public_work_views (social_at);

-- النقل القديم يُنفّذه Worker مرة بعد نشره، لأن الهجرات تُطبّق قبله وتبقى توسعية فقط.
CREATE TABLE view_projection_meta (id INTEGER PRIMARY KEY, migrated INTEGER NOT NULL DEFAULT 0);

-- حدث عام بلا عنوان عمل: الجهاز الذي كان قد استلم السجل يمسحه عند إطفاء الخيار.
CREATE TABLE view_privacy (
  user_id TEXT PRIMARY KEY,
  visible INTEGER NOT NULL,
  rev INTEGER NOT NULL
);
CREATE INDEX view_privacy_rev ON view_privacy (rev);
