#!/usr/bin/env bash
# تدقيق Issue #323 على APK Debug حقيقي: تثبيت نظيف ثم audit.mjs عبر WebView التطبيق (CDP). لا حسابات حقيقية.
set -uo pipefail
apk="$1"
out="${AUDIT_EVIDENCE:-audit-evidence}"
pkg=com.vantara.app.debug
mkdir -p "$out"
adb wait-for-device
adb shell getprop ro.product.cpu.abilist | tr -d '\r' | tee "$out/abi.txt"
adb logcat -c
adb logcat -b all -v threadtime > "$out/logcat-all.txt" &
logcat_pid=$!
adb install "$apk" | tee "$out/install.txt"
adb shell am start -W -n "$pkg/com.vantara.app.MainActivity" | tee "$out/start.txt"
for _ in $(seq 1 30); do adb shell pidof "$pkg" >/dev/null && break; sleep 1; done
AUDIT_EVIDENCE="$out" timeout -k 30 1800 node "docs/audit/ux-2026-11-12/android/${AUDIT_SCRIPT:-audit-addons.mjs}"
status=$?
timeout 30 adb exec-out screencap -p > "$out/final-screen.png" || true
timeout 30 adb logcat -b crash -d -v threadtime > "$out/logcat-crash.txt" || true
timeout 30 adb shell dumpsys meminfo "$pkg" > "$out/meminfo.txt" || true
timeout 30 adb shell dumpsys activity activities > "$out/activities.txt" || true
timeout 30 adb shell "cat /data/anr/traces.txt 2>/dev/null; ls /data/anr" > "$out/anr.txt" || true
kill "$logcat_pid" 2>/dev/null || true
exit $status
