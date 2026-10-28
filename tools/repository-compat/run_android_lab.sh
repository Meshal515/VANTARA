#!/usr/bin/env bash
set -euo pipefail
# Collect while the emulator is alive; emulator-runner tears it down on return.
trap 'timeout 15s adb logcat -d VantaraRuntimeAbi:V AndroidRuntime:E ActivityManager:I TestRunner:I "*:S" > runtime-lab-logcat.txt 2>&1 || true' EXIT
# Android8 emulators can reject clearing the main buffer. Clearing old logs is
# housekeeping, never the acceptance gate: retain logs and still RUN the tests.
if ! adb logcat -c; then
  printf '%s\n' 'Log buffer could not be cleared; retaining timestamps and running required tests.' >&2
fi
args=()
case "${RUNTIME_LAB_PROFILE:-full-execution}" in
  full-execution) ;;
  unsupported-platform-guard)
    # Deliberately only a compatibility/denial probe on API26/28. Never count
    # these jobs as successful source/DEX execution on an unsupported platform.
    args+=("-Pandroid.testInstrumentationRunnerArguments.class=dev.vantara.runtime.android.PlatformAvailabilityTest")
    ;;
  *) printf '%s\n' 'Unknown runtime acceptance profile' >&2; exit 2 ;;
esac
bash android/gradlew -p extensions/runtime-android :harness:connectedDebugAndroidTest "${args[@]}" --no-daemon --stacktrace
