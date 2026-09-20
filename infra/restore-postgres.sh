#!/bin/sh
set -eu

if [ "${CONFIRM_RESTORE:-}" != "YES" ]; then
  echo 'Refusing restore: set CONFIRM_RESTORE=YES' >&2
  exit 2
fi
if [ "${CONFIRM_SERVICES_PAUSED:-}" != "YES" ]; then
  echo 'Refusing paired restore: stop VANTARA/Uchiyomi writers and set CONFIRM_SERVICES_PAUSED=YES' >&2
  exit 2
fi

backup_dir="${BACKUP_DIR:-/backups/postgres}"
restore_from="${RESTORE_FROM:-$backup_dir/latest}"
primary_db="${POSTGRES_DB:-vantara}"
uchiyomi_db="${UCHIYOMI_DB:-uchiyomi}"

vantara_dump="$restore_from/vantara.dump"
uchiyomi_dump="$restore_from/uchiyomi.dump"

for dump in "$vantara_dump" "$uchiyomi_dump"; do
  if [ ! -f "$dump" ]; then
    echo "Missing backup archive: $dump" >&2
    exit 3
  fi
  pg_restore --list "$dump" >/dev/null
done

rollback_dir="$(mktemp -d "${TMPDIR:-/tmp}/vantara-restore-rollback.XXXXXX")"
cleanup() {
  rm -rf "$rollback_dir"
}
trap cleanup EXIT

# لا نلمس أي قاعدة قبل أن نملك نقطة رجوع فعلية للاثنتين.
pg_dump --format=custom --no-owner --no-acl \
  --dbname="$primary_db" --file="$rollback_dir/vantara.before.dump"
pg_dump --format=custom --no-owner --no-acl \
  --dbname="$uchiyomi_db" --file="$rollback_dir/uchiyomi.before.dump"
pg_restore --list "$rollback_dir/vantara.before.dump" >/dev/null
pg_restore --list "$rollback_dir/uchiyomi.before.dump" >/dev/null

restore_one() {
  db="$1"
  dump="$2"
  pg_restore --single-transaction --exit-on-error --clean --if-exists \
    --no-owner --no-acl --dbname="$db" "$dump"
}

rollback_pair() {
  echo 'Restore failed: rolling BOTH databases back to their pre-restore pair.' >&2
  first=0
  second=0
  restore_one "$primary_db" "$rollback_dir/vantara.before.dump" || first=$?
  restore_one "$uchiyomi_db" "$rollback_dir/uchiyomi.before.dump" || second=$?
  if [ "$first" -ne 0 ] || [ "$second" -ne 0 ]; then
    echo "FATAL: paired rollback failed (vantara=$first uchiyomi=$second); keep services stopped." >&2
    return 1
  fi
  echo 'Both databases returned to the pre-restore pair.' >&2
}

# من هذه النقطة وأي فشل يعني تعويض القاعدتين، لا ترك واحدة على recovery point
# جديد والثانية على القديم. --single-transaction يحمي كل قاعدة داخليًا،
# وrollback_pair يحمي الزوج بين القاعدتين.
if ! restore_one "$primary_db" "$vantara_dump"; then
  rollback_pair || exit 70
  exit 4
fi

if ! restore_one "$uchiyomi_db" "$uchiyomi_dump"; then
  rollback_pair || exit 70
  exit 5
fi

echo 'Restore completed for the paired VANTARA and Uchiyomi recovery point.'
