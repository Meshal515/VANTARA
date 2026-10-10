#!/usr/bin/env bash
# تورنت حي من سرب عام حقيقي على المحاكي: magnet فقط، فلتر الشبكة نفسه في الإنتاج.
# يكتب الجدول الزمني (مشاركون، سرعة، أول صورة، القفز) في ملخص التشغيل.
set -uo pipefail
evidence="${1:-addon-live-evidence}"
mkdir -p "$evidence"
adb logcat -c
adb shell am instrument -w -r -e liveTorrent 1 -e class com.vantara.addons.torrent.TorrentLiveSwarmDeviceTest \
  com.vantara.app.debug.test/androidx.test.runner.AndroidJUnitRunner > "$evidence/instrumentation.txt" 2>&1
adb logcat -d > "$evidence/logcat.txt"
adb shell run-as com.vantara.app.debug cat files/addon-proof/live-torrent.json > "$evidence/live-torrent.json" 2>/dev/null
python3 - "$evidence" <<'PY'
import json, pathlib, sys, os
ev = pathlib.Path(sys.argv[1])
out = ["## تورنت حي (أسراب حقيقية، أفلام Blender المفتوحة)"]
try:
    p = json.loads((ev / "live-torrent.json").read_text())
except Exception as e:
    out.append(f"لا دليل: {e}"); p = None
if p:
    out.append(f"- النتيجة العامة: {'✅ نجح (' + p.get('winner','') + ')' if p.get('passed') else '❌ لم ينجح أي فيلم'}")
    for r in p.get('results', []):
        out.append(f"\n### {r.get('name')} — {'✅' if r.get('passed') else '❌'} · أول صورة: {r.get('firstFrameMs')} ms · بعد القفز: {r.get('seekMs')} ms · {r.get('videoWidth')}x{r.get('videoHeight')}")
        if r.get('failure'): out.append(f"- السبب: `{r['failure']}`")
        out.append("\n| t (ms) | الحدث | DHT | مشاركون | زارعون | سرعة KB/s | محمّل MB |\n|---|---|---|---|---|---|---|")
        tl = r.get('timeline', [])
        keep = [e for i, e in enumerate(tl) if e['event'] != 'sample' or i % 3 == 0]
        for e in keep:
            rate = e.get('rate'); d = e.get('done')
            out.append(f"| {e['t']} | {e['event']} | {e.get('dht')} | {e.get('peers')} | {e.get('seeds')} | {round(rate/1024) if rate is not None else ''} | {round(d/1048576,1) if d is not None else ''} |")
text = "\n".join(out)
print(text)
s = os.environ.get("GITHUB_STEP_SUMMARY")
if s: open(s, "a").write(text + "\n")
PY
tail -5 "$evidence/instrumentation.txt"
