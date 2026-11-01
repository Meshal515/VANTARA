#!/usr/bin/env bash
# android-emulator-runner executes each script line in a separate shell. Keep status and logs together here.
set -uo pipefail
adb logcat -G 16M || true
adb logcat -c || true
status=0
bash android/gradlew -p android :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.vantara.anime.AniyomiRealExtensionDeviceTest,com.vantara.anime.AniyomiVideoJourneyDeviceTest \
  "-Pandroid.testInstrumentationRunnerArguments.vantaraAniyomiPackages=${VANTARA_ANIYOMI_PACKAGES:-okanime,anime4up,witanime}" \
  -Pandroid.testInstrumentationRunnerArguments.vantaraEphemeralVideo=true \
  -Pandroid.testInstrumentationRunnerArguments.vantaraAniyomiReal=true \
  -Pandroid.testInstrumentationRunnerArguments.vantaraAniyomiRepository=https://raw.githubusercontent.com/yuzono/anime-repo/repo \
  --no-daemon --stacktrace || status=$?
adb logcat -d -v raw -s VANTARA_ANIYOMI_REAL:I > aniyomi-sweep.log || true
cat aniyomi-sweep.log
if [[ "$status" -ne 0 ]]; then exit "$status"; fi
grep -q 'PASS package=' aniyomi-sweep.log && grep -q 'JOURNEY_PASS source=' aniyomi-sweep.log
