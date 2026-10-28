#!/usr/bin/env bash
set -euo pipefail
trap 'timeout 15s adb logcat -d VantaraRuntime:V AndroidRuntime:E ActivityManager:I TestRunner:I "*:S" > runtime-app-logcat.txt 2>&1 || true' EXIT
if ! adb logcat -c; then printf '%s\n' 'Unable to clear old logs; still running the required integration test.' >&2; fi
bash android/gradlew -p android :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.vantara.runtime.RuntimeAppIntegrationTest --no-daemon --stacktrace
