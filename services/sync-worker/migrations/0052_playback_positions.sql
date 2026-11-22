-- موضع التوقف داخل الحلقة أو الفيلم بين الأجهزة (ANX1). جدول مستقل عن `progress` (تقدم المانجا) بقصد:
--   - قاعدته «الأحدث يفوز» بوقت القياس، لا «الأكبر يفوز» كالمانجا: إعادة المشاهدة من البداية تُحفظ ولا يغلبها
--     موضع قديم أبعد من جهاز آخر.
--   - لا يختلط بإحصائيات المانجا ولا بصندوق «مالك التقدم» (Uchiyomi).
-- `watched_at` وقت القياس على الجهاز (مقيّد بوقت الخادم فلا يأتي من المستقبل)، و`device_id` للتشخيص فقط.
CREATE TABLE IF NOT EXISTS playback_positions (
  user_id     TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  media_key   TEXT NOT NULL,
  series_ref  TEXT NOT NULL,
  position_ms INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  watched_at  INTEGER NOT NULL,
  rev         INTEGER NOT NULL,
  PRIMARY KEY (user_id, media_key)
);
CREATE INDEX IF NOT EXISTS playback_positions_rev ON playback_positions (rev);
CREATE INDEX IF NOT EXISTS playback_positions_series ON playback_positions (user_id, series_ref);
