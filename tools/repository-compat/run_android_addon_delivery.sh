#!/usr/bin/env bash
# Fresh emulator only; preserve the same APK and data across both processes.
set -euo pipefail
package=com.vantara.app.debug
runner="$package.test/androidx.test.runner.AndroidJUnitRunner"
export VANTARA_DELIVERY_EVIDENCE="${VANTARA_DELIVERY_EVIDENCE:-addon-delivery-evidence}"
mkdir -p "$VANTARA_DELIVERY_EVIDENCE"
if adb shell pm path "$package" 2>/dev/null | grep '^package:' >/dev/null; then
  echo 'EXISTING_APP_REFUSED: never replace an owner installation' >&2
  exit 1
fi
adb install android/app/build/outputs/apk/debug/app-debug.apk
adb install -t android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
collect() {
  adb logcat -d -s AndroidRuntime:E ExtensionEngine:W VANTARA_DELIVERY_UI:I > "$VANTARA_DELIVERY_EVIDENCE/android-logcat.txt" || true
  adb shell dumpsys meminfo "$package" > "$VANTARA_DELIVERY_EVIDENCE/memory.txt" || true
}
trap collect EXIT
for phase in fresh restart; do
  method=freshUiJourney
  if [[ "$phase" == restart ]]; then method=restartUiJourney; fi
  adb shell am instrument -r -w -e class "com.vantara.anime.LiveDeliveryUiDeviceTest#$method" \
    -e vantaraEphemeralDelivery true "$runner" > "$VANTARA_DELIVERY_EVIDENCE/$phase-instrumentation.txt" 2>&1 &
  instrumentation_pid=$!
  node tools/repository-compat/android-addon-delivery.mjs "$phase" || {
    kill "$instrumentation_pid" 2>/dev/null || true
    exit 1
  }
  wait "$instrumentation_pid"
  node tools/repository-compat/assert_instrumentation.mjs "$VANTARA_DELIVERY_EVIDENCE/$phase-instrumentation.txt" 1
  adb shell am force-stop "$package"
done
