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
# Right after boot the emulator's user may not be running yet: «Error: Invalid userId -2» (round 11, two jobs).
for i in $(seq 1 30); do
  [[ "$(adb shell am get-current-user 2>/dev/null | tr -d '\r')" == "0" ]] && adb shell pm path android >/dev/null 2>&1 && break
  sleep 2
done
if [[ "$CERT_KIND" == "manga" ]]; then
  # مانجا: رحلة MangaLiveSweepTest لكل حزمة (المدمجة وعربية Keiyoushi) حتى صورة صفحة فعلية.
  # CERT_NAME «all» = كل الحزم، وإلا أسماء مفصولة بفواصل.
  only=()
  [[ "$CERT_NAME" != "all" ]] && only=(-e vantaraOnly "$CERT_NAME")
  timeout 9000 adb shell am instrument --user 0 -r -w \
    -e class com.vantara.runtime.MangaLiveSweepTest \
    -e vantaraMangaSweep true "${only[@]}" \
    "$runner" > "$out/instrumentation.txt" 2>&1 || status=$?
  timeout 60s adb logcat -d -v raw -s VANTARA_MANGA:I > "$out/manga.jsonl" 2>/dev/null || true
  timeout 60s adb logcat -d VantaraExtension:I VantaraRuntime:I AndroidRuntime:E '*:S' > "$out/logcat.txt" 2>&1 || true
  echo "manga lines: $(grep -c '^{' "$out/manga.jsonl" || true)"
  tail -n 20 "$out/instrumentation.txt"
  exit 0
fi
timeout 9000 adb shell am instrument --user 0 -r -w \
  -e class com.vantara.runtime.SourceCertificationTest \
  -e vantaraCertify true \
  -e vantaraCertKind "$CERT_KIND" \
  -e vantaraCertName "$CERT_NAME" \
  -e vantaraCertContent "$CERT_CONTENT" \
  -e vantaraCertPerTier "${CERT_PER_TIER:-10}" \
  -e vantaraCertServers "${CERT_SERVERS:-3}" \
  -e vantaraCertSeconds "${CERT_SECONDS:-10}" \
  "$runner" > "$out/instrumentation.txt" 2>&1 || status=$?
if grep -q "Invalid userId" "$out/instrumentation.txt"; then
  sleep 15
  timeout 9000 adb shell am instrument --user 0 -r -w \
    -e class com.vantara.runtime.SourceCertificationTest \
    -e vantaraCertify true \
    -e vantaraCertKind "$CERT_KIND" \
    -e vantaraCertName "$CERT_NAME" \
    -e vantaraCertContent "$CERT_CONTENT" \
    -e vantaraCertPerTier "${CERT_PER_TIER:-10}" \
    -e vantaraCertServers "${CERT_SERVERS:-3}" \
    -e vantaraCertSeconds "${CERT_SECONDS:-10}" \
    "$runner" > "$out/instrumentation.txt" 2>&1 || status=$?
fi
timeout 60s adb logcat -d -v raw -s VANTARA_CERT:I > "$out/cert.jsonl" 2>/dev/null || true
timeout 60s adb logcat -d VantaraPrepare:I VantaraRuntime:I VantaraRuntimeHttp:W AnimeEngine:W AndroidRuntime:E '*:S' > "$out/logcat.txt" 2>&1 || true
echo "certification lines: $(grep -c '^{' "$out/cert.jsonl" || true)"
tail -n 20 "$out/instrumentation.txt"
# الحكم في التقرير لا في رمز الخروج: مصدر معطّل نتيجة تُسجَّل، لا عطل في الفحص
exit 0
