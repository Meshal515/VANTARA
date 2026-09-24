-- حصة الترجمة: الأسبوع بالصفحات أو بالفصول (أيهما أسخى)، والشهر بالتكلفة الفعلية.
--
-- 5000 صفحة ظلمٌ لعمل فصله 300 صفحة (16 فصلًا فقط)، فيُحسب الفصل أيضًا: الحد
-- يُبلغ حين تتجاوز الصفحات حدها **و** الفصول حدها. والفصل الذي بدأته يكمل دائمًا.
CREATE TABLE IF NOT EXISTS translation_usage_chapters (
  user_id     TEXT NOT NULL,
  day         TEXT NOT NULL,
  chapter_key TEXT NOT NULL,
  PRIMARY KEY (user_id, day, chapter_key)
);

-- ما صُرف فعلًا هذا الشهر للتطبيق كله، من توكنات كل ردّ (لا تقدير): سقف يحمي
-- من فاتورة مفاجئة مهما كانت الحصص.
CREATE TABLE IF NOT EXISTS translation_spend (
  month      TEXT PRIMARY KEY,
  usd        REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
