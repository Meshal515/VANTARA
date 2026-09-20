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

# قاعدة مؤقتة لكل أرشيف: pg_restore --list يثبت أن الفهرس مقروء فقط، لكنه لا
# يثبت أن كل DDL/data قابلة للاستعادة. لا نلمس الإنتاج قبل نجاح استعادة كاملة
# للنسختين.
case "$primary_db:$uchiyomi_db" in
  *[!A-Za-z0-9_:.-]*) echo 'Database names must be simple identifiers.' >&2; exit 3 ;;
esac

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

createdb --maintenance-db="$primary_db" "$check_primary"
createdb --maintenance-db="$primary_db" "$check_uchiyomi"

pg_restore --single-transaction --exit-on-error --no-owner --no-acl \
  --dbname="$check_primary" "$vantara_dump"
pg_restore --single-transaction --exit-on-error --no-owner --no-acl \
  --dbname="$check_uchiyomi" "$uchiyomi_dump"

# خذ نقطة رجوع مباشرة قبل لمس الإنتاج. إذا فشلت القاعدة الثانية بعد نجاح
# الأولى، نعيد الأولى لهذه النقطة بدل ترك النظام بزمنين مختلفين.
pg_dump --format=custom --no-owner --no-acl \
  --dbname="$primary_db" --file="$rollback_dir/vantara-before.dump"
pg_dump --format=custom --no-owner --no-acl \
  --dbname="$uchiyomi_db" --file="$rollback_dir/uchiyomi-before.dump"

pg_restore --single-transaction --exit-on-error --clean --if-exists \
  --no-owner --no-acl --dbname="$primary_db" "$vantara_dump"

if ! pg_restore --single-transaction --exit-on-error --clean --if-exists \
  --no-owner --no-acl --dbname="$uchiyomi_db" "$uchiyomi_dump"; then
  echo 'Uchiyomi restore failed; rolling VANTARA back to its pre-restore state.' >&2
  if ! pg_restore --single-transaction --exit-on-error --clean --if-exists \
    --no-owner --no-acl --dbname="$primary_db" "$rollback_dir/vantara-before.dump"; then
    echo 'CRITICAL: paired restore failed and VANTARA rollback also failed.' >&2
    exit 5
  fi
  echo 'Paired restore aborted; VANTARA was rolled back and Uchiyomi transaction stayed unchanged.' >&2
  exit 4
fi

echo 'Restore completed for VANTARA and Uchiyomi databases.'
