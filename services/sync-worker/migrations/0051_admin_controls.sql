-- لوحة المالك (قرار المالك، 16 نوفمبر 2026):
-- إيقاف حساب: لا جلسة جديدة ولا إشعارات جوال حتى يعيده المالك. البيانات باقية.
ALTER TABLE accounts ADD COLUMN suspended_at INTEGER;

-- مفتاح استعادة الـPIN: يولّده المالك لحساب بعينه ولا يرى الـPIN نفسه. يُحفظ HMAC المفتاح فقط،
-- مرة واحدة، 24 ساعة. صاحب الحساب يدخله من جهاز معتمد له بدل الرقم: يُزال الـPIN فيضع رقمًا جديدًا.
CREATE TABLE IF NOT EXISTS pin_reset_keys (
  user_id    TEXT PRIMARY KEY REFERENCES accounts (user_id) ON DELETE CASCADE,
  key_hash   TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL
);
