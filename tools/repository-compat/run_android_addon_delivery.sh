#!/usr/bin/env bash
# Fresh emulator only; preserve the same APK and data across both processes.
set -euo pipefail
package=com.vantara.app.debug
runner="$package.test/androidx.test.runner.AndroidJUnitRunner"
export VANTARA_DELIVERY_EVIDENCE="${VANTARA_DELIVERY_EVIDENCE:-addon-delivery-evidence}"
mkdir -p "$VANTARA_DELIVERY_EVIDENCE"
package_list="$(timeout 20s adb shell pm list packages "$package")" || {
  echo 'APP_PRESENCE_UNKNOWN: refusing installation' >&2
  exit 1
}
if printf '%s\n' "$package_list" | grep -Fxq "package:$package"; then
  echo 'EXISTING_APP_REFUSED: never replace an owner installation' >&2
  exit 1
fi
timeout 120s adb install android/app/build/outputs/apk/debug/app-debug.apk
timeout 120s adb install -t android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
timeout 50m adb logcat -v threadtime -s AndroidRuntime:E VantaraRuntime:W ExtensionEngine:W chromium:E Capacitor/Console:E \
  > "$VANTARA_DELIVERY_EVIDENCE/android-live-logcat.txt" 2>&1 &
logcat_pid=$!
(
  while kill -0 "$logcat_pid" 2>/dev/null; do
    date -u
    free -m
    ps -eo pid,comm,rss --sort=-rss | head -12 || true
    sleep 10
  done
) > "$VANTARA_DELIVERY_EVIDENCE/host-memory-timeline.txt" 2>&1 &
memory_pid=$!
collect() {
  kill "$logcat_pid" 2>/dev/null || true
  kill "$memory_pid" 2>/dev/null || true
  timeout 20s adb logcat -d -s AndroidRuntime:E ExtensionEngine:W VANTARA_DELIVERY_UI:I > "$VANTARA_DELIVERY_EVIDENCE/android-logcat.txt" || true
  timeout 20s adb shell dumpsys meminfo "$package" > "$VANTARA_DELIVERY_EVIDENCE/memory.txt" || true
  free -m > "$VANTARA_DELIVERY_EVIDENCE/host-memory.txt" || true
  ps -eo pid,comm,rss --sort=-rss | head -20 > "$VANTARA_DELIVERY_EVIDENCE/host-process-memory.txt" || true
  sudo dmesg --ctime 2>/dev/null | tail -150 > "$VANTARA_DELIVERY_EVIDENCE/host-kernel.txt" || true
}
trap collect EXIT
for phase in fresh restart; do
  method=freshUiJourney
  if [[ "$phase" == restart ]]; then method=restartUiJourney; fi
  timeout 23m adb shell am instrument -r -w -e class "com.vantara.anime.LiveDeliveryUiDeviceTest#$method" \
    -e vantaraEphemeralDelivery true "$runner" > "$VANTARA_DELIVERY_EVIDENCE/$phase-instrumentation.txt" 2>&1 &
  instrumentation_pid=$!
  timeout 25m node tools/repository-compat/android-addon-delivery.mjs "$phase" || {
    kill "$instrumentation_pid" 2>/dev/null || true
    exit 1
  }
  wait "$instrumentation_pid"
  node tools/repository-compat/assert_instrumentation.mjs "$VANTARA_DELIVERY_EVIDENCE/$phase-instrumentation.txt" 1
  timeout 20s adb shell am force-stop "$package"
done
