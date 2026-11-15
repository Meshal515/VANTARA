#!/usr/bin/env bash
# كل مقاسات الرئيسيات: 1366/1920/2560 والشريط مفتوح ومقفل
set -u
tag=${1:-a}
for spec in "1366 768" "1920 1080" "2560 1440"; do
  set -- $spec
  for rail in 0 1; do
    RAIL=$rail timeout 600 node homes.cjs $1 $2 ${tag}-$1-r$rail > shots/homes/${tag}-$1-r$rail.log 2>&1
    echo "done $1 rail=$rail"
  done
done
