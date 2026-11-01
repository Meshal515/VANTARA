#!/usr/bin/env bash
# Real CloudStream source-site probe on an ephemeral emulator, never the owner profile.
# Must be invoked via bash: android-emulator-runner's script shell is /bin/sh.
set -uo pipefail
adb logcat -G 16M || true
adb logcat -c || true
args=(
  -Pandroid.testInstrumentationRunnerArguments.class=com.vantara.runtime.LiveRepositorySweepTest
  -Pandroid.testInstrumentationRunnerArguments.vantaraLiveSweep=true
  ${VANTARA_NATIVE_VIDEO:+-Pandroid.testInstrumentationRunnerArguments.vantaraNativePlayback=true}
  "-Pandroid.testInstrumentationRunnerArguments.vantaraOnly=${VANTARA_LIVE_ONLY:-Anime4up,AnimeRift,Animewitcher,Witanime}"
  "-Pandroid.testInstrumentationRunnerArguments.vantaraMaxPackages=${VANTARA_LIVE_LIMIT:-4}"
  ${VANTARA_LIVE_CONTENT:+-Pandroid.testInstrumentationRunnerArguments.vantaraContent=${VANTARA_LIVE_CONTENT}}
)
bash android/gradlew -p android :app:connectedDebugAndroidTest "${args[@]}" --no-daemon --stacktrace
status=$?
adb logcat -d -v raw -s VANTARA_SWEEP:I > live-video-sweep.jsonl 2>/dev/null || true
adb logcat -d VantaraRuntime:V VantaraRuntimeHttp:D AndroidRuntime:E TestRunner:I '*:S' > live-video-sweep-logcat.txt 2>&1 || true
if [[ -s live-video-sweep.jsonl ]]; then
  node tools/repository-compat/summarize_live_sweep.mjs live-video-sweep.jsonl --strict ${VANTARA_NATIVE_VIDEO:+--require-native-any} "--require-plugins=${VANTARA_LIVE_REQUIRED:-Anime4up,AnimeRift,Animewitcher,Witanime}" "--require-healthy=${VANTARA_LIVE_HEALTHY-AnimeRift}" "--require-native=${VANTARA_NATIVE_REQUIRED-}" > live-video-summary.md
  proof_status=$?
  cat live-video-summary.md
  if [[ "$proof_status" -ne 0 ]]; then
    echo "REAL_REPOSITORY_PROOF_FAILED: report is available above; green Gradle alone is not source success" >&2
    status=1
  fi
else
  printf '%s\n' 'ERROR: no real CloudStream plugin journeys recorded' >&2
  exit 1
fi
exit "$status"
