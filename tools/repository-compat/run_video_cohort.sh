#!/usr/bin/env bash
set -euo pipefail
if [[ "$VANTARA_VIDEO_ECOSYSTEM" == aniyomi ]]; then
  exec bash tools/repository-compat/run_aniyomi_video.sh
fi
# Refuse silent truncation of requested providers; one shard is deliberately small.
IFS=',' read -r -a providers <<< "$VANTARA_LIVE_ONLY"
if (( ${#providers[@]} < 1 || ${#providers[@]} > 8 )); then
  echo 'INVALID_COHORT: require 1..8 actual CloudStream plugin names' >&2
  exit 1
fi
exec bash tools/repository-compat/run_live_video.sh
