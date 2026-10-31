#!/usr/bin/env bash
# رحلات Debug الثلاث على محاكي فارغ (tools/android-debug/journeys.mjs). لا حذف ولا مسح بيانات في حالة الترقية.
#   journeys.sh upgrade <previous.apk> <candidate.apk>
#   journeys.sh clean <candidate.apk>          (تثبيت نظيف ثم مستودع ← مصدر ← فصل كامل)
set -euo pipefail
case_name="$1"; shift
out="${DEBUG_EVIDENCE:-android-debug-evidence}/$case_name"
export DEBUG_EVIDENCE="$out"
package=com.vantara.app.debug
mkdir -p "$out"
adb wait-for-device
adb shell getprop ro.product.cpu.abilist | tr -d '\r' | grep -q arm64-v8a || { echo 'Emulator lacks arm64-v8a translation'; exit 1; }
adb logcat -c
adb logcat -b all -v threadtime > "$out/logcat-all.txt" &
logcat_pid=$!
finish() {
  adb logcat -b crash -d -v threadtime > "$out/logcat-crash.txt" || true
  adb shell cmd connectivity airplane-mode disable || true
  kill "$logcat_pid" 2>/dev/null || true
}
trap finish EXIT
launch() {
  adb shell am start -W -n "$package/com.vantara.app.MainActivity" >/dev/null
  for _ in $(seq 1 30); do adb shell pidof "$package" >/dev/null && return; sleep 1; done
  echo 'App process did not start'; return 1
}
bundled() { unzip -l "$1" | grep -c 'assets/extensions/.*\.apk' || true; }

if [ "$case_name" = upgrade ]; then
  previous="$1"; candidate="$2"
  echo "previous bundles $(bundled "$previous") extension APKs; candidate bundles $(bundled "$candidate")" | tee "$out/apk-contents.txt"
  [ "$(bundled "$candidate")" = 0 ] || { echo 'candidate Debug still bundles source APKs'; exit 1; }
  adb install "$previous" | tee "$out/install-previous.txt"
  launch
  node tools/android-debug/journeys.mjs upgrade-before
  adb shell run-as "$package" sh -c "'echo journey-native-20261031 > files/journey-proof'"
  adb shell input keyevent KEYCODE_HOME; sleep 2
  adb shell am force-stop "$package"
  # الترقية فوق القديم بلا حذف ولا مسح: install -r فقط
  adb install -r "$candidate" | tee "$out/install-upgrade.txt"
  adb shell run-as "$package" cat files/journey-proof | tr -d '\r' | grep -qx journey-native-20261031
  launch
  node tools/android-debug/journeys.mjs upgrade-after
  adb shell am force-stop "$package"
  launch
  node tools/android-debug/journeys.mjs restart
elif [ "$case_name" = clean ]; then
  candidate="$1"
  [ "$(bundled "$candidate")" = 0 ] || { echo 'candidate Debug still bundles source APKs'; exit 1; }
  adb install "$candidate" | tee "$out/install-clean.txt"
  launch
  # حالتان منفصلتان: فشل الأولى يُسجَّل ولا يمنع الثانية من الحكم على نفسها
  status=0
  node tools/android-debug/journeys.mjs clean || status=1
  node tools/android-debug/journeys.mjs repo-read || status=1
  node tools/android-debug/journeys.mjs anime || status=1
  node tools/android-debug/journeys.mjs ui-anime || status=1
  node tools/android-debug/journeys.mjs anime-match || true
  [ "$status" = 0 ] || failed=1
else
  echo "unknown case $case_name"; exit 2
fi
adb logcat -b crash -d -v threadtime > "$out/logcat-crash.txt" || true
if grep -Eq 'FATAL EXCEPTION|Fatal signal' "$out/logcat-crash.txt" 2>/dev/null && grep -q "$package" "$out/logcat-crash.txt"; then
  echo 'Debug APK crashed during the journey; see logcat-crash.txt'; exit 1
fi
[ -z "${failed:-}" ] || { echo 'a journey failed; see its JSON'; exit 1; }
