#!/usr/bin/env bash
# Runs inside the emulator step of reference-cloudstream.yml. Installs the pinned CloudStream reference build,
# runs ReferenceRunTest for the planned plugins, and pulls one JSON per plugin into reference-out/.
# Inputs (env): REF_PLUGINS (name=url,…), REF_WORKS, REF_EPISODES. Clean emulator, clean network.
set -euo pipefail
out=reference-out
mkdir -p "$out"
adb install -r -g ref-apks/app.apk
adb install -r -g ref-apks/test.apk
target=$(adb shell pm list instrumentation | tr -d '\r' | grep -o 'instrumentation:[^ ]*cloudstream3[^ ]*' | head -1 | cut -d: -f2)
[ -n "$target" ] || { echo "reference instrumentation not installed"; adb shell pm list instrumentation; exit 1; }
app=$(adb shell pm list packages | tr -d '\r' | grep -o 'com\.lagradost\.cloudstream3[a-z.]*' | grep -v '\.test$' | head -1)
echo "instrumentation=$target app=$app"
# The test writes its files even when a plugin fails; the instrumentation result itself is recorded, not trusted.
set +e
timeout 5400 adb shell am instrument -w -r \
  -e class com.lagradost.cloudstream3.ReferenceRunTest \
  -e plugins "$REF_PLUGINS" -e works "$REF_WORKS" -e episodes "$REF_EPISODES" \
  "$target" > "$out/instrument.txt" 2>&1 &
runner=$!
# Links expire: each episode file is pulled and decode-checked as soon as it appears (plan: within 20 s).
remote="/sdcard/Android/data/$app/files/reference"
while kill -0 "$runner" 2>/dev/null; do
  for f in $(adb shell ls "$remote" 2>/dev/null | tr -d '\r' | grep '\.ep[0-9]*\.json$'); do
    [ -f "$out/$f" ] && continue
    adb pull "$remote/$f" "$out/$f" >/dev/null 2>&1 && python3 -I tools/reference/cloudstream/probe_links.py --episode "$out/$f" &
  done
  sleep 3
done
wait "$runner"; echo "instrument_exit=$?" >> "$out/instrument.txt"
cat "$out/instrument.txt"
wait # every live decode check finishes before the summary reads them
set -e
adb pull "/sdcard/Android/data/$app/files/reference/." "$out/" || echo "nothing to pull (no plugin finished)"
adb logcat -d -s VANTARA_REF:* PluginManager:* System.out:* > "$out/logcat.txt" || true
ls -la "$out"
