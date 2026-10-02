-- دورة حياة الحساب: إضافة حساب من داخل التطبيق، رمز PIN اختياري، وحذف بمهلة تراجع.
--
-- الهوية = user_id وحده (موجود منذ 0001، ثابت ولا يتغير). الاسم والصورة
-- وusername والـPIN كلها قابلة للتغيير ولا تمس الهوية.
--
-- الحذف ثلاث حالات على صف الحساب نفسه:
--   ACTIVE          الحالة العادية.
--   PENDING_DELETE  طُلب الحذف (بعد PIN). لا يُمسح شيء ولا يتحرر username؛
--                   الحساب يختفي من القوائم ولا تُصدر له جلسة. التراجع قبل
--                   purge_after يعيده ACTIVE فورًا، بلا استعادة لأن لا شيء مُسح.
--   DELETED         بعد purge_after فقط: تُمسح بياناته كلها، ويصير username
--                   '~' || user_id فيتحرر الاسم، ويبقى الصف شاهد قبر بنفس الـUUID
--                   ليصل الحذف كل جهاز عبر الفروقات.

-- القيم الثلاث يفرضها كود الـWorker (accounts.ts) لا CHECK: إضافة عمود بقيد
-- جديد ليست توسعة آمنة والـWorker القديم ما زال يخدم أثناء الترحيل.
ALTER TABLE accounts ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE accounts ADD COLUMN delete_requested_at INTEGER;
ALTER TABLE accounts ADD COLUMN purge_after INTEGER;
ALTER TABLE accounts ADD COLUMN deleted_at INTEGER;
CREATE INDEX IF NOT EXISTS accounts_pending_purge ON accounts (lifecycle, purge_after);

-- PIN: لا نص صريح أبدًا. HMAC(pepper الخادم، salt + pin)؛ والـpepper سرّ
-- Worker، فتسريب القاعدة وحده لا يكفي لتجربة 10,000 احتمال.
CREATE TABLE IF NOT EXISTS account_pins (
  user_id      TEXT PRIMARY KEY REFERENCES accounts (user_id) ON DELETE CASCADE,
  pin_hash     TEXT NOT NULL,
  salt         TEXT NOT NULL,
  digits       INTEGER NOT NULL CHECK (digits IN (4, 6)),
  failed       INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
);

-- إذن PIN لكل جهاز وحساب: بعد إدخال الـPIN الصحيح، الجهاز يجدد جلسته بهذا
-- الإذن بلا إعادة السؤال حتى يُغلق التطبيق (الإذن في ذاكرة العميل لا في تخزينه).
ALTER TABLE trusted_devices ADD COLUMN pin_grant_hash TEXT;
