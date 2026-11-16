#!/usr/bin/env bash
# Execute on an otherwise empty emulator. Never uninstall or clear app data.
set -euo pipefail
previous="$1"
candidate="$2"
out="${DEBUG_EVIDENCE:-android-debug-evidence}"
export DEBUG_EVIDENCE="$out"
package=com.vantara.app.debug
mkdir -p "$out"
adb wait-for-device
adb shell getprop > "$out/device-properties.txt"
adb shell dumpsys webviewupdate > "$out/webview-provider.txt"
# The shipped APK is arm64-only. Do not silently replace it with an x86 build.
adb shell getprop ro.product.cpu.abilist | tr -d '\r' | grep -q arm64-v8a || {
  echo 'Emulator lacks arm64-v8a support/translation required by the exact signed APK'; exit 1;
}
adb logcat -c
adb logcat -b all -v threadtime > "$out/logcat-all.txt" &
logcat_pid=$!
collect() {
  adb logcat -b crash -d -v threadtime > "$out/logcat-crash.txt" || true
  adb shell dumpsys activity exit-info "$package" > "$out/process-exit-info.txt" || true
  adb shell dumpsys activity processes > "$out/activity-processes.txt" || true
  adb shell dumpsys meminfo "$package" > "$out/memory.txt" || true
  kill "$logcat_pid" 2>/dev/null || true
  wait "$logcat_pid" 2>/dev/null || true
}
trap collect EXIT
launch() {
  adb shell am start -W -n "$package/com.vantara.app.MainActivity"
  # pidof may lag behind am start on cold boot.
  for attempt in $(seq 1 30); do
    if adb shell pidof "$package" >/dev/null; then return; fi
    sleep 1
  done
  echo 'App process did not start'; return 1
}
adb install -r "$previous" | tee "$out/install-previous.txt"
launch
node tools/android-debug/webview-proof.mjs baseline
adb shell run-as "$package" mkdir -p files
adb shell run-as "$package" sh -c "'echo debug-native-data-20261027 > files/debug-upgrade-proof'"
# Background the app normally so Chromium can flush LocalStorage/IndexedDB.
# The subsequent force-stop and in-place install still enforce persistence.
adb shell input keyevent KEYCODE_HOME
sleep 2
adb shell am force-stop "$package"
adb install -r "$candidate" | tee "$out/install-upgrade.txt"
adb shell run-as "$package" cat files/debug-upgrade-proof | tr -d '\r' | grep -qx debug-native-data-20261027
launch
node tools/android-debug/webview-proof.mjs candidate
adb shell am force-stop "$package"
launch
node tools/android-debug/webview-proof.mjs restart
collect
python3 - "$out" <<'PY'
import json,re,sys
from pathlib import Path
p=Path(sys.argv[1])
crashes=(p/'logcat-crash.txt').read_text(errors='replace')
logs=(p/'logcat-all.txt').read_text(errors='replace')
if ('com.vantara.app.debug' in crashes and re.search(r'FATAL EXCEPTION|Fatal signal|Abort message',crashes)) or re.search(r'ANR in com\.vantara\.app\.debug|am_anr.*com\.vantara\.app\.debug',logs):
    raise SystemExit('Debug APK crashed or produced an ANR; inspect captured Logcat')
if re.search(r'START .*cmp=com\.vantara\.app\.debug/com\.vantara\.verification\.VerificationActivity|Start proc .*com\.vantara\.app\.debug:verification',logs):
    raise SystemExit('Home/Addons opened verification without a user source request')
for phase in ['baseline','candidate','restart']:
    proof=json.loads((p/(phase+'.json')).read_text())
    if proof.get('passed') is not True:raise SystemExit('Missing passing device proof: '+phase)
if json.loads((p/'candidate.json').read_text()).get('cycles')!=30:raise SystemExit('Missing 30 navigation cycles')
(p/'upgrade-result.json').write_text(json.dumps({'passed':True,'inPlaceUpgrade':True,'nativeFileRetained':True,'homeAddonsCycles':30,'authenticationTest':False,'sourcePlaybackTest':False},indent=2)+'\n')
PY
