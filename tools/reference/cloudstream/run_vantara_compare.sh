#!/usr/bin/env bash
# VANTARA's side of the reference comparison, inside the emulator step of reference-cloudstream.yml.
# Installs the actual Debug app + its instrumentation, hands it the reference episodes, runs ReferenceCompareTest,
# and decode-checks each episode's links the moment its file appears (links expire). Output: vantara-out/.
set -euo pipefail
out=vantara-out
mkdir -p "$out"
adb install -r -g vantara-apks/app-debug.apk
adb install -r -t vantara-apks/app-debug-androidTest.apk
app=com.vantara.app.debug
remote="/sdcard/Android/data/$app/files"
# Readable by the test through its shell permission; the app creates its own output folder (never the shell).
adb push ref-episodes.json /data/local/tmp/ref-episodes.json
set +e
timeout 5400 adb shell am instrument --user 0 -r -w \
  -e class com.vantara.runtime.ReferenceCompareTest -e vantaraRefCompare true \
  "$app.test/androidx.test.runner.AndroidJUnitRunner" > "$out/instrument.txt" 2>&1 &
runner=$!
while kill -0 "$runner" 2>/dev/null; do
  for f in $(adb shell ls "$remote/reference-vantara" 2>/dev/null | tr -d '\r' | grep '\.vep[0-9]*\.json$'); do
    [ -f "$out/$f" ] && continue
    adb pull "$remote/reference-vantara/$f" "$out/$f" >/dev/null 2>&1 && python3 -I tools/reference/cloudstream/probe_links.py --episode "$out/$f" &
  done
  sleep 3
done
wait "$runner"; echo "instrument_exit=$?" >> "$out/instrument.txt"
wait # every live decode check finishes before the comparison reads them
set -e
adb pull "$remote/reference-vantara/." "$out/" || true
adb logcat -d -s VantaraRuntime:* VantaraPrepare:* TestRunner:* AndroidRuntime:E > "$out/logcat.txt" || true
tail -n 20 "$out/instrument.txt"
# am instrument exits 0 even when the test fails: the result line decides, so a broken comparison is never green.
if ! grep -q '^OK (1 test)' "$out/instrument.txt"; then echo "::error::VANTARA comparison test did not pass (see instrument.txt)"; exit 1; fi
