-- دورة حياة الحساب: إضافة حساب من داخل التطبيق، رمز PIN اختياري، وحذف بتراجع.
--
-- الهوية = user_id وحده (موجود منذ 0001، ثابت ولا يتغير). الاسم والصورة
-- وusername والـPIN كلها قابلة للتغيير ولا تمس الهوية.
--
-- الحذف «شاهد قبر»: صف الحساب يبقى بمعرّفه وdeleted_at (فتصل كل جهاز عبر
-- الفروقات ويخفيه)، وبياناته تُمسح، وusername يتحرر لغيره.

ALTER TABLE accounts ADD COLUMN deleted_at INTEGER;

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
