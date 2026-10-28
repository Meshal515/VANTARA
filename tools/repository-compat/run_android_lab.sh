#!/usr/bin/env bash
set -euo pipefail
# Collect while the emulator is alive; emulator-runner tears it down on return.
trap 'timeout 15s adb logcat -d VantaraRuntimeAbi:V AndroidRuntime:E ActivityManager:I TestRunner:I "*:S" > runtime-lab-logcat.txt 2>&1 || true' EXIT
adb logcat -c
bash android/gradlew -p extensions/runtime-android :harness:connectedDebugAndroidTest --no-daemon --stacktrace
