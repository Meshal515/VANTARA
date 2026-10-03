-- صحة المصادر كما تراها الأجهزة الحقيقية (APK وPWA)، عدّادات يومية فقط:
-- أي مصدر، أي خطوة، أي نتيجة، وسبب قصير ووقت. لا معرّف مستخدم ولا عمل ولا رابط.
-- بها يُقاس الـAPK على الهواتف فعلًا بدل التخمين من مركز بيانات.
CREATE TABLE source_reports (
  day TEXT NOT NULL,
  platform TEXT NOT NULL,
  app_version TEXT NOT NULL,
  section TEXT NOT NULL,
  source_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  outcome TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  ms_sum INTEGER NOT NULL DEFAULT 0,
  ms_max INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, platform, app_version, section, source_id, stage, outcome, reason)
);

CREATE INDEX source_reports_day ON source_reports (day);
