-- المجلس: ما يُرسَل لشخص يظهر لبقية الأصدقاء، إلا من أخفاه المرسل عنه.
--
-- `audience`:
--   PRIVATE — ما أُرسل قبل هذه الهجرة. أُرسل على وعد «بين اثنين»، فيبقى كذلك:
--             لا يُكشف لطرفٍ ثالث بأثر رجعي.
--   MAJLIS  — ما يُرسل بعدها: للمرسل والمستلم، ولكل صديق ليس في `hidden_json`.
-- `hidden_json` مصفوفة معرّفات مرتّبة (`["a","b"]`)، ويُطابَق فيها بـ`instr`
-- على المعرّف مقتبسًا — فمعرّفٌ جزءٌ من آخر لا يطابقه.
--
-- توسعة فقط (expand): العامل القديم يبقى يكتب بلا هذه الأعمدة فتأخذ
-- افتراضها الخاص، ويقرأ بنطاقه القديم الأضيق. والفريم «للجميع» لا يُسقط قيد
-- `to_id NOT NULL` (إعادة بناء الجدول ليست آمنة والعامل القديم يخدم):
-- يُخزَّن `to_id` = المرسل و`broadcast = 1`.

ALTER TABLE frames ADD COLUMN audience TEXT NOT NULL DEFAULT 'PRIVATE';
ALTER TABLE frames ADD COLUMN hidden_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE frames ADD COLUMN broadcast INTEGER NOT NULL DEFAULT 0;

-- التوصيات: البثّ القديم (to_id IS NULL) كان للجميع ويبقى، والموجّهة القديمة
-- خاصة وتبقى.
ALTER TABLE recommendations ADD COLUMN audience TEXT NOT NULL DEFAULT 'PRIVATE';
ALTER TABLE recommendations ADD COLUMN hidden_json TEXT NOT NULL DEFAULT '[]';
