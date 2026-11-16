-- إشعارات الجوال والتطبيق مغلق: الفحص الدوري في الجهاز لا يملك الجلسة (عمرها 15 دقيقة
-- وتجديدها بمفتاح الجهاز داخل الواجهة)، فيأخذ رمزًا ضيقًا لا يفعل إلا قراءة إشعارات
-- صاحبه غير المعروضة وتعليمها معروضة. يُحفظ HMAC الرمز لا الرمز، ويُلغى بالخروج أو من
-- لوحة المالك أو بحذف الحساب.
CREATE TABLE IF NOT EXISTS notify_devices (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS notify_devices_user ON notify_devices (user_id, created_at);

-- بيانات الإشعار المنظمة (عدد الرسائل، مدى الفصول، الغلاف) في عمود مستقل، و`body` يبقى جملة
-- مقروءة دائمًا: نسخ Stable القديمة (وويندوز الذي لا يتحدث) تعرض body كما هو، فلا ترى JSON.
ALTER TABLE notifications ADD COLUMN meta TEXT;
