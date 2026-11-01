#!/usr/bin/env bash
set -euo pipefail
package=com.vantara.app.debug
runner="$package.test/androidx.test.runner.AndroidJUnitRunner"
if adb shell pm path "$package" | grep -q 'package:'; then
  echo 'Fresh emulator required; refusing to touch existing application data.' >&2
  exit 1
fi
adb install android/app/build/outputs/apk/debug/app-debug.apk
adb install android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
trap 'adb logcat -d -s VANTARA_REPOSITORY_QA:I > optional-manga-logcat.txt' EXIT
for method in addRemoveAndDismiss dismissalSurvivesProcessRestart; do
  # Raw output retains Android's terminal result code for the strict proof parser.
  adb shell am instrument -r -w -e class "com.vantara.plugins.OptionalMangaRepositoriesDeviceTest#$method" \
    -e vantaraEphemeralRepositories true "$runner" > "optional-manga-$method.txt" 2>&1
  cat "optional-manga-$method.txt"
  node tools/repository-compat/assert_instrumentation.mjs "optional-manga-$method.txt" 1
  adb shell am force-stop "$package"
done
