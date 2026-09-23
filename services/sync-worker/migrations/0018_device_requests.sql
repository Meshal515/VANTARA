-- طلب اعتماد جهاز جديد، بلا أي سرّ يمرّ بسجلٍّ عام.
--
-- الجهاز غير الموثوق يرسل device_id وcredential عبر TLS، فيُحفظ HMAC الـcredential
-- هنا مع رمز قصير يُعرض على شاشة الجهاز وحده (يُخزَّن HMAC الرمز لا الرمز).
-- المالك يعتمد الرمز من سير عمل GitHub؛ ظهور الرمز في سجل عام لا يعطي أحدًا
-- شيئًا: الاعتماد مربوط بالجهاز الذي طلبه وحده، ويُستهلك مرة واحدة.

CREATE TABLE IF NOT EXISTS device_requests (
  code_hash        TEXT PRIMARY KEY,
  device_id        TEXT NOT NULL,
  credential_hash  TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL,
  approved_at      INTEGER,
  consumed_at      INTEGER
);

CREATE INDEX IF NOT EXISTS device_requests_device
  ON device_requests(device_id, expires_at);
