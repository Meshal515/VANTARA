#!/usr/bin/env bash
# A published-repository ABI/registration sweep. This does NOT certify source content/video.
set -uo pipefail
: "${VANTARA_SHARD:?VANTARA_SHARD is required}"
: "${VANTARA_SHARD_COUNT:?VANTARA_SHARD_COUNT is required}"
adb logcat -G 16M || true
adb logcat -c || true
bash android/gradlew -p android :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.vantara.runtime.PublishedRepoRegistrationTest \
  -Pandroid.testInstrumentationRunnerArguments.vantaraRegistrationSweep=true \
  "-Pandroid.testInstrumentationRunnerArguments.vantaraShard=${VANTARA_SHARD}" \
  "-Pandroid.testInstrumentationRunnerArguments.vantaraShardCount=${VANTARA_SHARD_COUNT}" \
  --no-daemon --stacktrace
status=$?
adb logcat -d -v raw -s VANTARA_REGISTRATION:I > registration-sweep.jsonl 2>/dev/null || true
adb logcat -d AndroidRuntime:E TestRunner:I VantaraRuntime:V '*:S' > registration-logcat.txt 2>&1 || true
if [[ ! -s registration-sweep.jsonl ]]; then echo "REGISTRATION_EVIDENCE_MISSING" >&2;exit 1;fi
node tools/repository-compat/summarize_registration_sweep.mjs registration-sweep.jsonl --strict > registration-summary.md
proof=$?
cat registration-summary.md
if [[ "$proof" -ne 0 ]]; then status=1; fi
exit "$status"
