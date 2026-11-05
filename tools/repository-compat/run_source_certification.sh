#!/usr/bin/env bash
# اعتماد مصدر واحد على محاكي جديد: يثبّت التطبيق المبني وفحصه، ويشغّل SourceCertificationTest،
# ويحفظ سطور VANTARA_CERT. تقرير فقط: لا يمس بيانات مستخدم ولا ينشر شيئًا.
set -uo pipefail
: "${CERT_KIND:?}" "${CERT_NAME:?}" "${CERT_CONTENT:?}"
app=apks/app-debug.apk
tests=apks/app-debug-androidTest.apk
runner=com.vantara.app.debug.test/androidx.test.runner.AndroidJUnitRunner
out="cert-${CERT_KIND}-${CERT_NAME// /_}"
mkdir -p "$out"
adb logcat -G 16M || true
adb logcat -c || true
adb install -r "$app" || exit 1
adb install -r -t "$tests" || exit 1
status=0
timeout 9000 adb shell am instrument -r -w \
  -e class com.vantara.runtime.SourceCertificationTest \
  -e vantaraCertify true \
  -e vantaraCertKind "$CERT_KIND" \
  -e vantaraCertName "$CERT_NAME" \
  -e vantaraCertContent "$CERT_CONTENT" \
  -e vantaraCertPerTier "${CERT_PER_TIER:-10}" \
  -e vantaraCertServers "${CERT_SERVERS:-3}" \
  -e vantaraCertSeconds "${CERT_SECONDS:-10}" \
  "$runner" > "$out/instrumentation.txt" 2>&1 || status=$?
timeout 60s adb logcat -d -v raw -s VANTARA_CERT:I > "$out/cert.jsonl" 2>/dev/null || true
timeout 60s adb logcat -d VantaraPrepare:I VantaraRuntime:I VantaraRuntimeHttp:W AnimeEngine:W AndroidRuntime:E '*:S' > "$out/logcat.txt" 2>&1 || true
echo "certification lines: $(grep -c '^{' "$out/cert.jsonl" || true)"
tail -n 20 "$out/instrumentation.txt"
# الحكم في التقرير لا في رمز الخروج: مصدر معطّل نتيجة تُسجَّل، لا عطل في الفحص
exit 0
