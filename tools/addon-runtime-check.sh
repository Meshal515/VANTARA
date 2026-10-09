#!/usr/bin/env bash
set -euo pipefail
evidence="${1:-addon-runtime-evidence}"
mkdir -p "$evidence"
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb install -r android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb logcat -c
adb shell am instrument -w -r -e addonHttpFixtureUrl "https://raw.githubusercontent.com/Meshal515/VANTARA/${GITHUB_SHA:-HEAD}/android/app/src/androidTest/assets/addon-torrent-proof.mp4" \
  -e addonSubtitleFixtureUrl "https://raw.githubusercontent.com/Meshal515/VANTARA/${GITHUB_SHA:-HEAD}/android/app/src/androidTest/assets/addon-http-proof.vtt" \
  -e class com.vantara.addons.torrent.TorrentPlaybackDeviceTest,com.vantara.addons.NativeAddonHttpPlaybackDeviceTest \
  com.vantara.app.debug.test/androidx.test.runner.AndroidJUnitRunner > "$evidence/instrumentation.txt" 2>&1
adb logcat -d > "$evidence/logcat.txt"
adb shell run-as com.vantara.app.debug cat files/addon-proof/native-torrent.json > "$evidence/native-torrent.json" 2>/dev/null
adb shell run-as com.vantara.app.debug cat files/addon-proof/native-http.json > "$evidence/native-http.json" 2>/dev/null
python3 - "$evidence" <<'PY'
import json, pathlib, re, sys
evidence = pathlib.Path(sys.argv[1])
result = (evidence / "instrumentation.txt").read_text()
print(result)
if not re.search(r'OK \([1-9][0-9]* tests?\)', result) or re.search(r'FAILURES!!!|INSTRUMENTATION_FAILED|Process crashed', result):
    raise SystemExit('Native addon playback gate failed')
for filename in ['native-torrent.json', 'native-http.json']:
    proof = json.loads((evidence / filename).read_text())
    for key in ['passed', 'firstFrame', 'decodedAfterSeek', 'continuedPastSixSeconds']:
        if proof.get(key) is not True:
            raise SystemExit(f'{filename}: missing actual playback evidence for {key}')
    if not (proof.get('videoWidth', 0) > 0 and proof.get('videoHeight', 0) > 0):
        raise SystemExit(f'{filename}: no decoded video dimensions')
    if filename == 'native-http.json' and proof.get('externalSubtitleCue') is not True:
        raise SystemExit('No real external subtitle cue')
    if filename == 'native-torrent.json' and not re.fullmatch('[0-9a-f]{64}', proof.get('verifiedRangeSha256', '')):
        raise SystemExit('No verified torrent byte hash')
    print(f'{filename}: real first frame, seek and continuing playback verified')
    print(json.dumps({'file': filename, 'proof': proof}, sort_keys=True))
PY
