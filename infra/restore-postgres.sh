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

case "$primary_db:$uchiyomi_db" in
  *[!A-Za-z0-9_:.-]*) echo 'Database names must be simple identifiers.' >&2; exit 3 ;;
esac

vantara_dump="$restore_from/vantara.dump"
uchiyomi_dump="$restore_from/uchiyomi.dump"
manifest="$restore_from/manifest.sha256"

for file in "$vantara_dump" "$uchiyomi_dump" "$restore_from/manifest.txt" "$manifest"; do
  if [ ! -f "$file" ]; then
    echo "Missing recovery-set file: $file" >&2
    exit 3
  fi
done

(
  cd "$restore_from"
  sha256sum -c manifest.sha256 >/dev/null
)
pg_restore --list "$vantara_dump" >/dev/null
pg_restore --list "$uchiyomi_dump" >/dev/null

active_writers="$(psql --dbname=postgres -Atc "
  SELECT count(*)
    FROM pg_stat_activity
   WHERE datname IN ('$primary_db', '$uchiyomi_db')
     AND backend_type = 'client backend'
     AND state <> 'idle'
" 2>/dev/null || printf 'unknown')"
if [ "$active_writers" = "unknown" ] || [ "$active_writers" -ne 0 ] 2>/dev/null; then
  echo "Refusing paired restore: active database work detected ($active_writers)." >&2
  exit 3
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
check_primary="vantara_restore_check_$stamp"
check_uchiyomi="uchiyomi_restore_check_$stamp"
rollback_dir="$(mktemp -d "${TMPDIR:-/tmp}/vantara-restore-rollback.XXXXXX")"

cleanup() {
  dropdb --if-exists --force --maintenance-db="$primary_db" "$check_primary" >/dev/null 2>&1 || true
  dropdb --if-exists --force --maintenance-db="$primary_db" "$check_uchiyomi" >/dev/null 2>&1 || true
  rm -rf "$rollback_dir"
}
trap cleanup EXIT INT TERM

restore_archive() {
  db="$1"
  dump="$2"
  phase="${3:-production}"

  if [ "$phase" = "production" ] &&
     [ "${VANTARA_RESTORE_TEST_MODE:-}" = "YES" ] &&
     [ "${VANTARA_RESTORE_FAIL_DB_FOR_TESTS:-}" = "$db" ]; then
    echo "Injected restore failure for $db (test mode)." >&2
    return 99
  fi

  pg_restore --single-transaction --exit-on-error --clean --if-exists \
    --no-owner --no-acl --dbname="$db" "$dump"
}

# Prove both archives can actually be restored before production is touched.
createdb --maintenance-db="$primary_db" "$check_primary"
createdb --maintenance-db="$primary_db" "$check_uchiyomi"
pg_restore --single-transaction --exit-on-error --no-owner --no-acl \
  --dbname="$check_primary" "$vantara_dump"
pg_restore --single-transaction --exit-on-error --no-owner --no-acl \
  --dbname="$check_uchiyomi" "$uchiyomi_dump"

# Capture the complete pre-restore pair. These dumps are the compensation point
# if either production restore fails after the first database commits.
pg_dump --format=custom --no-owner --no-acl \
  --dbname="$primary_db" --file="$rollback_dir/vantara.before.dump"
pg_dump --format=custom --no-owner --no-acl \
  --dbname="$uchiyomi_db" --file="$rollback_dir/uchiyomi.before.dump"
pg_restore --list "$rollback_dir/vantara.before.dump" >/dev/null
pg_restore --list "$rollback_dir/uchiyomi.before.dump" >/dev/null

rollback_pair() {
  echo 'Restore failed: compensating BOTH databases to the pre-restore pair.' >&2
  first=0
  second=0
  restore_archive "$primary_db" "$rollback_dir/vantara.before.dump" rollback || first=$?
  restore_archive "$uchiyomi_db" "$rollback_dir/uchiyomi.before.dump" rollback || second=$?
  if [ "$first" -ne 0 ] || [ "$second" -ne 0 ]; then
    echo "FATAL: paired rollback failed (vantara=$first uchiyomi=$second); keep services stopped." >&2
    return 1
  fi
  echo 'Both databases returned to the pre-restore pair.' >&2
}

if ! restore_archive "$primary_db" "$vantara_dump" production; then
  rollback_pair || exit 70
  exit 4
fi

if ! restore_archive "$uchiyomi_db" "$uchiyomi_dump" production; then
  rollback_pair || exit 70
  exit 5
fi

echo 'Restore completed for the paired VANTARA and Uchiyomi recovery point.'
