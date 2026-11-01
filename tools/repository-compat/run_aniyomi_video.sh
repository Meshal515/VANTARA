#!/usr/bin/env bash
# One APK installation, two real instrumentation processes; never clear/uninstall owner data.
set -uo pipefail
package=com.vantara.app.debug
app=android/app/build/outputs/apk/debug/app-debug.apk
tests=android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
runner=com.vantara.app.debug.test/androidx.test.runner.AndroidJUnitRunner
aapt="${ANDROID_HOME:?}/build-tools/35.0.0/aapt"
# Drain the producer before matching: grep -q can SIGPIPE aapt under pipefail.
"$aapt" dump badging "$app" > aniyomi-app-badging.txt || exit 1
"$aapt" dump badging "$tests" > aniyomi-test-badging.txt || exit 1
grep -q "^package: name='$package' " aniyomi-app-badging.txt || exit 1
grep -q "^package: name='$package.test' " aniyomi-test-badging.txt || exit 1
if adb shell pm path "$package" 2>/dev/null | grep -q '^package:'; then
  echo 'EXISTING_APP_REFUSED: use a fresh ephemeral emulator; no owner app is replaced' >&2
  exit 1
fi
adb logcat -G 16M || true
adb logcat -c || true
collect() { adb logcat -d -v raw -s VANTARA_ANIYOMI_REAL:I VantaraRuntime:I > aniyomi-sweep.log || true; }
trap collect EXIT
adb install "$app" || exit 1
adb install -t "$tests" || exit 1
first=0
adb shell am instrument -r -w \
  -e class 'com.vantara.anime.AniyomiRealExtensionDeviceTest,com.vantara.anime.AniyomiVideoJourneyDeviceTest#repositoryInstallMetadataNativePlaybackAndQualities' \
  -e vantaraAniyomiPackages "${VANTARA_ANIYOMI_PACKAGES:-okanime,anime4up,witanime,asia2tv}" \
  -e vantaraEphemeralVideo true -e vantaraAniyomiReal true \
  -e vantaraAniyomiRepository https://raw.githubusercontent.com/yuzono/anime-repo/repo \
  "$runner" > aniyomi-install-instrumentation.txt 2>&1 || first=$?
cat aniyomi-install-instrumentation.txt
node tools/repository-compat/assert_instrumentation.mjs aniyomi-install-instrumentation.txt 2 || first=1
# No reinstall, pm clear, or fabricated in-memory restoration between phases.
adb shell am force-stop "$package" || exit 1
second=0
adb shell am instrument -r -w \
  -e class com.vantara.anime.InstalledVideoRestartDeviceTest \
  -e vantaraEphemeralVideo true "$runner" > aniyomi-restart-instrumentation.txt 2>&1 || second=$?
cat aniyomi-restart-instrumentation.txt
node tools/repository-compat/assert_instrumentation.mjs aniyomi-restart-instrumentation.txt 1 || second=1
collect
cat aniyomi-sweep.log
if [[ "$first" -ne 0 || "$second" -ne 0 ]]; then exit 1; fi
grep -q 'PASS package=' aniyomi-sweep.log && grep -q 'JOURNEY_PASS source=' aniyomi-sweep.log && \
  grep -q 'RESTART_METADATA_PASS' aniyomi-sweep.log && grep -q 'RESTART_NATIVE_PASS' aniyomi-sweep.log
