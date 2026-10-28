#!/usr/bin/env bash
# Empty CI emulator only. No uninstall, clear, Debug APK, or production account login.
set -euo pipefail
out=stable-addons-evidence
mkdir -p "$out"
trap 'adb logcat -d > "$out/logcat.txt"; adb logcat -b crash -d > "$out/crash.txt"' EXIT
adb logcat -c
adb install -r "$RUNNER_TEMP/stable-baseline/VANTARA-stable.apk"
adb install -r "$STABLE_TEST_APK"
phase() {
  adb shell am instrument -w -r -e stablePhase "$1" -e class com.vantara.stableproof.StableAddonsDeviceTest \
    com.vantara.app.test/androidx.test.runner.AndroidJUnitRunner | tee "$out/$1-instrumentation.txt"
  python3 - "$out" "$1" <<'PY'
import sys,pathlib,json,re
out,phase=map(str,sys.argv[1:]);text=pathlib.Path(out,phase+'-instrumentation.txt').read_text()
if not re.search(r'OK \([1-9][0-9]* tests?\)',text) or re.search(r'FAILURES!!!|INSTRUMENTATION_FAILED|Process crashed',text):raise SystemExit('Stable Release instrumentation failed: '+phase)
rows=re.findall(r'INSTRUMENTATION_STATUS: stableAddonsProof=(\{[^\n]+\})',text)
if not rows:raise SystemExit('Missing actual Release evidence: '+phase)
p=json.loads(rows[-1])
if not p.get('passed') or p.get('buildType')!='release':raise SystemExit('Invalid Release result')
pathlib.Path(out,phase+'.json').write_text(json.dumps(p,indent=2))
PY
}
phase baseline
adb shell am force-stop com.vantara.app
adb install -r dist/VANTARA-stable.apk
phase candidate
adb shell am force-stop com.vantara.app
phase restart
adb logcat -b crash -d > "$out/crash.txt"
if grep -qE 'com\.vantara\.app|com/vantara' "$out/crash.txt"; then cat "$out/crash.txt"; exit 1; fi
adb logcat -d > "$out/logcat.txt"
if grep -qE 'ANR in com\.vantara\.app|am_anr.*com\.vantara\.app' "$out/logcat.txt"; then exit 1; fi
