-- محرّك الترجمة: ما تُرجم مرة لا يُترجم مرة ثانية، ولأي واحد من العيال.
--
-- الصفحة تُعرف ببصمة صورتها (sha256 للصورة كما أُرسلت)، لا بمصدرها ولا
-- برابطها: نفس الصورة من جوالين أو بعد سنة هي نفس الترجمة. `engine` = النموذج
-- وإصدار التعليمات؛ رفعه يعني ترجمة جديدة بقرار، والقديمة تبقى.
--
-- لا صور مترجمة هنا: مناطق النص وإحداثياتها والعربي فقط (بضعة كيلوبايتات)،
-- والقارئ يرسمها فوق الصفحة الأصلية.

CREATE TABLE IF NOT EXISTS translation_pages (
  page_hash    TEXT NOT NULL,
  engine       TEXT NOT NULL,
  series_ref   TEXT,
  chapter_key  TEXT,
  page_index   INTEGER,
  source_lang  TEXT,
  width        INTEGER NOT NULL,
  height       INTEGER NOT NULL,
  regions_json TEXT NOT NULL,
  summary      TEXT,
  created_by   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (page_hash, engine)
);

CREATE INDEX IF NOT EXISTS translation_pages_chapter ON translation_pages (series_ref, chapter_key, page_index);

-- مصطلحات كل عمل: اسمٌ أو قدرة أو منظمة تُرجمت مرة تبقى كما هي في كل فصل.
-- أول قرار يثبت (INSERT OR IGNORE)، والتعديل اليدوي `origin = 'owner'`.
CREATE TABLE IF NOT EXISTS translation_terms (
  series_ref TEXT NOT NULL,
  term       TEXT NOT NULL,
  arabic     TEXT NOT NULL,
  kind       TEXT,
  note       TEXT,
  origin     TEXT NOT NULL DEFAULT 'model',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (series_ref, term)
);

-- الشخصيات: الاسم بالعربي والجنس (تذكير الفعل والضمير) وطريقة الكلام.
CREATE TABLE IF NOT EXISTS translation_characters (
  series_ref TEXT NOT NULL,
  name       TEXT NOT NULL,
  arabic     TEXT NOT NULL,
  gender     TEXT,
  voice      TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (series_ref, name)
);

-- حدّ يومي لكل حساب: صفحات تُرسل للنموذج فعلًا (ما جاء من الذاكرة لا يُحسب).
CREATE TABLE IF NOT EXISTS translation_usage (
  user_id TEXT NOT NULL,
  day     TEXT NOT NULL,
  pages   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
