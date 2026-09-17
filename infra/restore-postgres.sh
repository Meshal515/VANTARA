#!/bin/sh
set -eu

if [ "${CONFIRM_RESTORE:-}" != "YES" ]; then
  echo 'Refusing restore: set CONFIRM_RESTORE=YES' >&2
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

pg_restore --clean --if-exists --no-owner --no-acl --dbname="$primary_db" "$vantara_dump"
pg_restore --clean --if-exists --no-owner --no-acl --dbname="$uchiyomi_db" "$uchiyomi_dump"

echo 'Restore completed for VANTARA and Uchiyomi databases.'
