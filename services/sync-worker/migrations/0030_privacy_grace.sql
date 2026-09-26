-- الخصوصية: «عرض ماذا أشاهد الآن» مطفأ = العمل الحالي لا يصل الأصدقاء.
--
-- آخر المشاهدات ونشاط الإنهاء لمن أخفى عمله الحالي يُنشران بعد ساعة، لا فورًا:
--   social_at NULL  منشور (يراه الأصدقاء)
--   social_at > 0   معلّق حتى هذا الوقت (يراه صاحبه وحده)
--   social_at = -1  لن يُنشر أبدًا (حذفه صاحبه قبل انتهاء المهلة)
-- والنشر يرفع rev عند حلول وقته (عند أول سحب أو نبضة بعده)، فيصل كل جهاز
-- حتى بعد إعادة تشغيل الخادم أو غياب الجهاز. لا مؤقت في العميل.
--
-- `published`: هل رآه الأصدقاء مرة؟ حذفُ ما لم يُنشر قط لا يرسل لهم شيئًا.
ALTER TABLE work_views ADD COLUMN social_at INTEGER;
ALTER TABLE work_views ADD COLUMN published INTEGER NOT NULL DEFAULT 1;
ALTER TABLE activity ADD COLUMN social_at INTEGER;
CREATE INDEX IF NOT EXISTS work_views_social_at ON work_views (social_at);
CREATE INDEX IF NOT EXISTS activity_social_at ON activity (social_at);
