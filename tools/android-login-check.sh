#!/usr/bin/env bash
set -euo pipefail
out="$RUNNER_TEMP/android-login"
mkdir -p android-login-evidence
collect_evidence() {
  curl -fsS http://127.0.0.1:8765/__fixture/proof > android-login-evidence/server-proof.json || true
  adb logcat -d -s AndroidRuntime chromium Capacitor/Console > android-login-evidence/device-logcat.txt || true
}
trap collect_evidence EXIT
adb reverse tcp:8765 tcp:8765
verify_phase() {
  local phase="$1"
  adb shell am instrument -w -r -e loginPhase "$phase" \
    -e class com.vantara.login.ReleaseLoginDeviceTest \
    com.vantara.app.test/androidx.test.runner.AndroidJUnitRunner | tee "android-login-evidence/$phase-instrumentation.txt"
  python3 - "$phase" <<'PY'
import json,pathlib,re,sys
phase=sys.argv[1]
text=pathlib.Path('android-login-evidence',phase+'-instrumentation.txt').read_text()
if not re.search(r'OK \([1-9][0-9]* tests?\)',text) or re.search(r'FAILURES!!!|INSTRUMENTATION_FAILED|Process crashed',text):
 raise SystemExit('Release instrumentation failed: '+phase)
items=re.findall(r'INSTRUMENTATION_STATUS: releaseLoginProof=(\{[^\n]+\})',text)
if not items: raise SystemExit('No actual Release device evidence: '+phase)
proof=json.loads(items[-1])
if proof.get('passed') is not True or proof.get('buildType')!='release':raise SystemExit('Invalid Release evidence')
pathlib.Path('android-login-evidence',phase+'.json').write_text(json.dumps(proof,indent=2))
print(json.dumps(proof))
PY
}
for phase in baseline candidate; do
  adb shell am force-stop com.vantara.app || true
  adb install -r "$out/$phase/app-release.apk"
  adb install -r "$out/$phase/app-release-androidTest.apk"
  cp "$out/$phase/source.json" "android-login-evidence/$phase-source.json"
  verify_phase "$phase"
done
adb shell am force-stop com.vantara.app
verify_phase restart
