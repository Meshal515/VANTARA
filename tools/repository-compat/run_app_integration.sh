#!/usr/bin/env bash
set -euo pipefail
trap 'timeout 15s adb logcat -d VantaraRuntime:V AndroidRuntime:E ActivityManager:I TestRunner:I "*:S" > runtime-app-logcat.txt 2>&1 || true' EXIT
if ! adb logcat -c; then printf '%s\n' 'Unable to clear old logs; still running the required integration test.' >&2; fi
bash android/gradlew -p android :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.vantara.runtime.RuntimeAppIntegrationTest --no-daemon --stacktrace
# Same candidate APK throughout: these phases prove bootstrap/UI/process restart,
# not an upgrade from another signed APK. No account authentication is simulated.
export DEBUG_EVIDENCE=runtime-app-webview
mkdir -p "$DEBUG_EVIDENCE"
adb shell am force-stop com.vantara.app.debug
adb shell am start -n com.vantara.app.debug/com.vantara.app.MainActivity
node tools/android-debug/webview-proof.mjs baseline
node tools/android-debug/webview-proof.mjs candidate
adb shell am force-stop com.vantara.app.debug
adb shell am start -n com.vantara.app.debug/com.vantara.app.MainActivity
node tools/android-debug/webview-proof.mjs restart
