-- صور الملف الشخصي (الصورة والبانر) بعنوان محتواها.
--
-- base64 نصًّا لا BLOB: D1 وsqlite الاختبار يعيدان الـBLOB بشكلين مختلفين،
-- والنص واحد في الاثنين. الزيادة الثلث مقبولة لصورٍ مقصوصة على الجهاز.
-- جدول جديد فقط: توسعة لا يلمسها العامل القديم.

CREATE TABLE IF NOT EXISTS media (
  hash       TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  data       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS media_owner ON media (owner_id);
