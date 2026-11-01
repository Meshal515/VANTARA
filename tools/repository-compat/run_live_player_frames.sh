#!/usr/bin/env bash
# Isolated Debug-only VANTARA production PlayerActivity, real signed/pinned CloudStream
# Animewitcher DEX, real source -> episode -> resolved media -> ExoPlayer decoded frames.
# A test failure is never rewritten as a pass. Does not publish or touch stable.
set -uo pipefail
adb logcat -G 16M || true
adb logcat -c || true
bash android/gradlew -p android :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.vantara.runtime.RuntimeAppIntegrationTest#witcherLiveEpisodeRunsInTheExistingPlayerWithSustainedClockAndBothSeeks \
  --no-daemon --stacktrace
result=$?
adb logcat -d -v threadtime -s VantaraRuntime:I ExoPlayerImpl:E AndroidRuntime:E TestRunner:I > live-player-frames-logcat.txt 2>&1 || true
if [[ "$result" -ne 0 ]]; then
  printf 'REAL_PLAYER_INSTRUMENTATION_FAILED exit=%s\n' "$result" | tee live-player-frames-summary.txt
  exit "$result"
fi
if ! grep -q 'LIVE_WITCHER_PLAYER:existing Activity/transport' live-player-frames-logcat.txt; then
  printf 'MISSING_DECODED_FRAME_AND_SEEK_EVIDENCE\n' | tee live-player-frames-summary.txt
  exit 1
fi
grep 'LIVE_WITCHER_METRICS\|LIVE_WITCHER_PLAYER' live-player-frames-logcat.txt > live-player-frames-summary.txt || true
test -s live-player-frames-summary.txt
