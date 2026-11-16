#!/usr/bin/env bash
# تثبيت نظيف لـAPK ثم capture-manga.mjs عبر WebView التطبيق (CDP). مرجع تصميم فقط.
set -uo pipefail
apk="$1"; out="${AUDIT_EVIDENCE:-capture-evidence}"; pkg=com.vantara.app.debug
mkdir -p "$out"
adb wait-for-device
adb install "$apk" | tee "$out/install.txt"
for _ in $(seq 1 36); do
  l=$(timeout 8 adb shell cut -d' ' -f1 /proc/loadavg | tr -d '\r'); echo "$(date +%T) load ${l:-?}" >> "$out/settle.txt"
  awk -v l="${l:-99}" 'BEGIN{exit !(l<3.0)}' && break; sleep 5
done
adb shell am start -W -n "$pkg/com.vantara.app.MainActivity" | tee "$out/start.txt"
for _ in $(seq 1 30); do adb shell pidof "$pkg" >/dev/null && break; sleep 1; done
AUDIT_EVIDENCE="$out" timeout -k 30 1700 node docs/design/2026-11-12/capture/capture-manga.mjs
status=$?
timeout 30 adb exec-out screencap -p > "$out/final-screen.png" || true
exit $status
