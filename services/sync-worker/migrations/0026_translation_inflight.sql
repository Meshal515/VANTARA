-- الترجمة المدفوعة بحجز ذرّي قبل النداء (لا فحص ثم صرف):
--
-- ١. `translation_spend.reserved`: مبلغ محجوز لكل نداء جارٍ. يُسمح بالنداء بشرط
--    واحد في جملة واحدة (المصروف + المحجوز < السقف)، فطلبات متزامنة لا تتجاوز
--    السقف معًا. بعد الرد يُستبدل المحجوز بالتكلفة الفعلية.
-- ٢. `translation_inflight`: صفحة واحدة لا تُدفع مرتين. أول طلب يحجزها؛ الطلب
--    المتزامن لنفس البصمة والمحرّك ينتظر المحفوظ بدل نداء ثانٍ. حجز يتيم (عامل
--    مات في المنتصف) يسقط بعد ثلاث دقائق.
ALTER TABLE translation_spend ADD COLUMN reserved REAL NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS translation_inflight (
  page_hash  TEXT NOT NULL,
  engine     TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  PRIMARY KEY (page_hash, engine)
);
