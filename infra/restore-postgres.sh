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

# Database names are interpolated as quoted SQL identifiers below. Keep the
# accepted alphabet deliberately tiny so recovery tooling never becomes a SQL
# injection surface through environment variables.
for db in "$primary_db" "$uchiyomi_db"; do
  case "$db" in
    ''|*[!A-Za-z0-9_]*)
      echo "Unsafe database name: $db" >&2
      exit 2
      ;;
  esac
done

vantara_dump="$restore_from/vantara.dump"
uchiyomi_dump="$restore_from/uchiyomi.dump"

for dump in "$vantara_dump" "$uchiyomi_dump"; do
  if [ ! -f "$dump" ]; then
    echo "Missing backup archive: $dump" >&2
    exit 3
  fi
  pg_restore --list "$dump" >/dev/null
done

suffix="$$"
stage_primary="vtr_stage_a_$suffix"
stage_uchiyomi="vtr_stage_b_$suffix"
old_primary="vtr_old_a_$suffix"
old_uchiyomi="vtr_old_b_$suffix"
failed_primary="vtr_failed_a_$suffix"
failed_uchiyomi="vtr_failed_b_$suffix"

success=0
promotion_started=0

db_exists() {
  [ "$(psql --dbname=postgres -Atc "SELECT 1 FROM pg_database WHERE datname = '$1'")" = "1" ]
}

allow_connections() {
  db="$1"
  state="$2"
  if db_exists "$db"; then
    psql --dbname=postgres -v ON_ERROR_STOP=1 -c       "ALTER DATABASE \"$db\" WITH ALLOW_CONNECTIONS $state;" >/dev/null
  fi
}

terminate_connections() {
  db="$1"
  psql --dbname=postgres -v ON_ERROR_STOP=1 -c     "SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
      WHERE datname = '$db' AND pid <> pg_backend_pid();" >/dev/null
}

rename_db() {
  from="$1"
  to="$2"
  psql --dbname=postgres -v ON_ERROR_STOP=1 -c     "ALTER DATABASE \"$from\" RENAME TO \"$to\";" >/dev/null
}

drop_db_if_exists() {
  db="$1"
  if db_exists "$db"; then
    dropdb --if-exists --force "$db" >/dev/null 2>&1 || true
  fi
}

rollback_one() {
  live="$1"
  old="$2"
  failed="$3"

  # During promotion every participating DB has ALLOW_CONNECTIONS=false, so no
  # request can observe a mixed VANTARA/Uchiyomi pair. If the first rename
  # succeeded and the second failed, move the staged live DB aside and put the
  # original name back before reopening either side.
  if db_exists "$old"; then
    if db_exists "$live"; then
      terminate_connections "$live" || true
      rename_db "$live" "$failed" || true
    fi
    terminate_connections "$old" || true
    rename_db "$old" "$live" || true
  fi
}

cleanup() {
  status=$?
  set +e

  if [ "$success" -ne 1 ] && [ "$promotion_started" -eq 1 ]; then
    echo 'Restore promotion failed; rolling the database pair back.' >&2
    rollback_one "$primary_db" "$old_primary" "$failed_primary"
    rollback_one "$uchiyomi_db" "$old_uchiyomi" "$failed_uchiyomi"
    allow_connections "$primary_db" true
    allow_connections "$uchiyomi_db" true
  fi

  for db in     "$stage_primary" "$stage_uchiyomi"     "$failed_primary" "$failed_uchiyomi"; do
    drop_db_if_exists "$db"
  done

  # Old databases are retained only until a successful pair promotion. On any
  # failed path rollback_one consumed them; this is just defensive cleanup.
  if [ "$success" -eq 1 ]; then
    drop_db_if_exists "$old_primary"
    drop_db_if_exists "$old_uchiyomi"
  fi

  return "$status"
}
trap cleanup EXIT HUP INT TERM

# ── Phase 1: prove BOTH archives are fully restorable without touching live DBs.
createdb "$stage_primary"
createdb "$stage_uchiyomi"

pg_restore --single-transaction --exit-on-error   --no-owner --no-acl --dbname="$stage_primary" "$vantara_dump"
pg_restore --single-transaction --exit-on-error   --no-owner --no-acl --dbname="$stage_uchiyomi" "$uchiyomi_dump"

# ── Phase 2: closed-gate pair promotion.
# A logical restore cannot make two PostgreSQL databases one SQL transaction.
# Instead both staged restores must succeed first, then BOTH live and staged
# databases are closed to new connections until both names have been swapped.
# A failure between the swaps is compensated before either DB is reopened.
for db in "$stage_primary" "$stage_uchiyomi" "$primary_db" "$uchiyomi_db"; do
  allow_connections "$db" false
done
terminate_connections "$primary_db"
terminate_connections "$uchiyomi_db"

promotion_started=1

rename_db "$primary_db" "$old_primary"
rename_db "$stage_primary" "$primary_db"

# CI-only fault injection at the exact historically-dangerous midpoint.
if [ "${RESTORE_FAULT_AFTER_PRIMARY_PROMOTE:-}" = "YES" ]; then
  echo 'Injected restore failure after primary promotion.' >&2
  exit 97
fi

rename_db "$uchiyomi_db" "$old_uchiyomi"
rename_db "$stage_uchiyomi" "$uchiyomi_db"

# Only now can clients observe the restored pair.
allow_connections "$primary_db" true
allow_connections "$uchiyomi_db" true
success=1

echo 'Restore completed for VANTARA and Uchiyomi databases as one closed-gate pair.'
