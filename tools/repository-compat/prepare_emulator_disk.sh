#!/usr/bin/env bash
# Reclaim unused language toolchains on an ephemeral GitHub-hosted Ubuntu runner
# AFTER the Android APK has been compiled. Never touch the workspace, Java,
# Android SDK, Gradle, Node, Python, browser, or anything used by VANTARA.
set -euo pipefail

if [[ "${GITHUB_ACTIONS:-}" != "true" || "${RUNNER_OS:-}" != "Linux" || "${HOME:-}" != "/home/runner" ]]; then
  echo '::error::Emulator disk preparation may run only on an ephemeral GitHub-hosted Linux runner.'
  exit 1
fi

mkdir -p "$HOME/.android/avd"
target_kib=$((9 * 1024 * 1024))  # 9 GiB free: AVD requires 7.37 GB plus headroom
available_kib() { df -Pk "$HOME/.android/avd" | awk 'NR==2 { print $4 }'; }

echo '=== Emulator disk capacity before safe cleanup ==='
df -h "$HOME/.android/avd"

# Only unrelated, preinstalled language SDKs, with exact absolute paths.
# No Android SDK/NDK, Java, Gradle, source files, runner temp, or APK assets.
unused_toolchains=(
  /usr/share/dotnet
  /usr/local/share/powershell
  /usr/local/.ghcup
  /opt/hostedtoolcache/CodeQL
  /opt/hostedtoolcache/Ruby
  /opt/hostedtoolcache/go
)

for directory in "${unused_toolchains[@]}"; do
  if (( $(available_kib) >= target_kib )); then break; fi
  if [[ -d "$directory" && ! -L "$directory" ]]; then
    echo "Removing unused runner toolchain: $directory"
    du -sh -- "$directory" || true
    sudo rm -rf -- "$directory"
  fi
done

echo '=== Emulator disk capacity after safe cleanup ==='
df -h "$HOME/.android/avd"
remaining_kib="$(available_kib)"
if (( remaining_kib < target_kib )); then
  echo "::error::Insufficient runner storage for the real Android emulator: $(( remaining_kib / 1024 )) MiB free, need at least $(( target_kib / 1024 )) MiB. No emulator attempted; do not skip device tests or publish Debug."
  exit 1
fi
echo "Emulator disk preflight passed: $(( remaining_kib / 1024 )) MiB available."
