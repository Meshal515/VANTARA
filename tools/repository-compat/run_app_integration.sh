#!/usr/bin/env bash
set -euo pipefail
trap 'timeout 15s adb logcat -d VantaraRuntime:V AndroidRuntime:E ActivityManager:I TestRunner:I "*:S" > runtime-app-logcat.txt 2>&1 || true' EXIT
if ! adb logcat -c; then printf '%s\n' 'Unable to clear old logs; still running the required integration test.' >&2; fi
# Render a realistic phone-size surface (360dp x 640dp) on the 2-vCPU hosted runner.
# This changes only the disposable emulator display; never player quality,
# clock budgets, seek requirements or any installed-device behavior.
adb shell wm size 540x960
adb shell wm density 240
adb shell wm size
adb shell wm density
# The VANTARA repository is private: raw.githubusercontent.com/Meshal515/VANTARA
# is NOT a public HTTPS fixture, even when the test job can check out the repo.
# Use public, independently hosted samples to exercise the real HTTPS transport.
video_fixture="https://media.w3.org/2010/05/sintel/trailer.mp4"
subtitle_fixture="https://raw.githubusercontent.com/code100x/cms/957546d2e4e3afd0946d5314ebe4fc5e5db53145/public/subs.vtt"
bash android/gradlew -p android :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.vantara.runtime.RuntimeAppIntegrationTest,com.vantara.addons.PreparedHttpPlaybackDeviceTest,com.vantara.addons.NativeAddonHttpPlaybackDeviceTest,com.vantara.anime.player.CandidateExternalAudioDeviceTest,com.vantara.anime.player.PlayerStartupDeviceTest \
  "-Pandroid.testInstrumentationRunnerArguments.addonHttpFixtureUrl=$video_fixture" \
  "-Pandroid.testInstrumentationRunnerArguments.addonSubtitleFixtureUrl=$subtitle_fixture" --no-daemon --stacktrace
# Same candidate APK throughout: these phases prove bootstrap/UI/process restart,
# not an upgrade from another signed APK. No account authentication is simulated.
export DEBUG_EVIDENCE=runtime-app-webview
mkdir -p "$DEBUG_EVIDENCE"
# Gradle UTP removes its test installation during teardown. Install the exact
# candidate APK again before starting the separate real-WebView acceptance phase.
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
# The emulator starts with animations disabled (stable instrumentation). WebView reports that as the system
# «reduce motion» setting, under which section switches are instant, so the WebView phase restores the animation
# scales a real phone has before measuring the animated transitions. The instant path keeps its own proof.
for scale in window_animation_scale transition_animation_scale animator_duration_scale; do adb shell settings put global "$scale" 1; done
adb shell am force-stop com.vantara.app.debug
adb shell am start -W -n com.vantara.app.debug/com.vantara.app.MainActivity
node tools/android-debug/webview-proof.mjs baseline
node tools/android-debug/webview-proof.mjs candidate
adb shell am force-stop com.vantara.app.debug
adb shell am start -W -n com.vantara.app.debug/com.vantara.app.MainActivity
node tools/android-debug/webview-proof.mjs restart
