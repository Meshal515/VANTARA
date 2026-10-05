#!/usr/bin/env bash
set -euo pipefail
models="$1"
evidence="$2"
mkdir -p "$evidence"
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb install -r android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell rm -rf /data/local/tmp/vantara-translation-models
adb push "$models" /data/local/tmp/vantara-translation-models
adb shell run-as com.vantara.app.debug mkdir -p files/translation-models
adb shell run-as com.vantara.app.debug sh -c '"cp /data/local/tmp/vantara-translation-models/* files/translation-models/"'
# am instrument can exit zero even when JUnit fails: inspect the runner's report.
adb shell am instrument -w -r -e package com.vantara.plugins.translation \
  com.vantara.app.debug.test/androidx.test.runner.AndroidJUnitRunner | tee "$evidence/instrumentation.txt"
adb logcat -d > "$evidence/logcat.txt"
for filename in rendered-flat.png rendered-real-magician.png evidence.json; do
  adb exec-out run-as com.vantara.app.debug cat "files/translation-runtime-evidence/$filename" > "$evidence/$filename"
done
cp android/app/src/androidTest/assets/source-flat.png "$evidence/"
cp android/app/src/androidTest/assets/source-real-magician.jpg "$evidence/"
if ! grep -Eq '^OK \([0-9]+ tests?\)' "$evidence/instrumentation.txt" || grep -Eq 'FAILURES|INSTRUMENTATION_FAILED|Process crashed' "$evidence/instrumentation.txt"; then
  echo 'Android runtime verification failed'
  exit 1
fi
