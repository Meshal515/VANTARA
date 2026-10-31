#!/usr/bin/env bash
# Runs LiveRepositorySweepTest on the attached emulator and keeps its per-plugin report lines.
# The test app is uninstalled by Gradle afterwards, so the report is read from logcat, not app storage.
set -uo pipefail
adb logcat -G 16M || true
adb logcat -c || true
# CloudStream ثم المانجا (MangaLiveSweepTest: من تحميل الحزمة حتى صورة صفحة فعلية) في تشغيل واحد للمحاكي
args=(-Pandroid.testInstrumentationRunnerArguments.class=com.vantara.runtime.LiveRepositorySweepTest,com.vantara.runtime.MangaLiveSweepTest
      -Pandroid.testInstrumentationRunnerArguments.vantaraLiveSweep=true
      -Pandroid.testInstrumentationRunnerArguments.vantaraMangaSweep=true)
[ -n "${SWEEP_REPOSITORY:-}" ] && args+=("-Pandroid.testInstrumentationRunnerArguments.vantaraRepo=${SWEEP_REPOSITORY}")
[ -n "${SWEEP_ONLY:-}" ] && args+=("-Pandroid.testInstrumentationRunnerArguments.vantaraOnly=${SWEEP_ONLY}")
bash android/gradlew -p android :app:connectedDebugAndroidTest "${args[@]}" --no-daemon --stacktrace
status=$?
timeout 30s adb logcat -d -v raw -s VANTARA_SWEEP:I > live-sweep.jsonl 2>/dev/null || true
timeout 30s adb logcat -d -v raw -s VANTARA_MANGA:I > manga-sweep.jsonl 2>/dev/null || true
echo "manga lines: $(grep -c '^{' manga-sweep.jsonl || true)"
timeout 30s adb logcat -d VantaraRuntime:V VantaraRuntimeHttp:D CloudflareInterceptor:I AndroidRuntime:E TestRunner:I '*:S' > live-sweep-logcat.txt 2>&1 || true
echo "sweep lines: $(grep -c '^{' live-sweep.jsonl || true)"
exit $status
