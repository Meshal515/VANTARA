-- الترجمة: ما تعلّمته Luna من الفصول العربية الموجودة لنفس العمل.
--
-- كثير من الأعمال لها مصدر عربي يتوقف عند فصل، وتكملة إنجليزية بعده. الفريق
-- العربي الذي ترجم الفصول الأولى ثبّت أسماء الشخصيات والمصطلحات والأسلوب.
-- `POST /v1/translate/learn` يعطي Luna صفحات متقابلة (إنجليزي/عربي) من فصل
-- موجود في المصدرين فتستخرج القاموس (إلى translation_terms/characters) وتكتب
-- هنا ملاحظات الأسلوب: السجل اللغوي، معاملة الألقاب، عبارات الشخصيات — فتكمل
-- الفصول الجديدة بنفس الصوت الذي اعتاده القارئ.

CREATE TABLE IF NOT EXISTS translation_style (
  series_ref   TEXT PRIMARY KEY,
  notes        TEXT NOT NULL,
  learned_from TEXT,
  pairs        INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
);
