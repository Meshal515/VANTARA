#!/bin/sh
set -eu

# A pair of logical dumps from two PostgreSQL databases cannot share one exported
# snapshot. The recovery set is valid only while application writers are paused.
if [ "${CONFIRM_SERVICES_PAUSED:-}" != "YES" ]; then
  echo 'Refusing paired backup: stop VANTARA/Uchiyomi writers and set CONFIRM_SERVICES_PAUSED=YES' >&2
  exit 2
fi

backup_dir="${BACKUP_DIR:-/backups/postgres}"
primary_db="${POSTGRES_DB:-vantara}"
uchiyomi_db="${UCHIYOMI_DB:-uchiyomi}"
mkdir -p "$backup_dir"

case "$primary_db:$uchiyomi_db" in
  *[!A-Za-z0-9_:.-]*) echo 'Database names must be simple identifiers.' >&2; exit 3 ;;
esac

# The confirmation above is the operational lock. This query catches the common
# failure where services were not actually quiesced before the operator confirmed.
active_writers="$(psql --dbname=postgres -Atc "
  SELECT count(*)
    FROM pg_stat_activity
   WHERE datname IN ('$primary_db', '$uchiyomi_db')
     AND backend_type = 'client backend'
     AND state <> 'idle'
" 2>/dev/null || printf 'unknown')"
if [ "$active_writers" = "unknown" ] || [ "$active_writers" -ne 0 ] 2>/dev/null; then
  echo "Refusing paired backup: active database work detected ($active_writers)." >&2
  exit 3
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
tmp_dir="$backup_dir/.tmp-$stamp-$$"
mkdir -p "$tmp_dir"
trap 'rm -rf "$tmp_dir"' EXIT INT TERM

# Each archive is internally consistent. With writers paused, the sequential
# dumps represent one application recovery point.
pg_dump --format=custom --no-owner --no-acl --dbname="$primary_db" --file="$tmp_dir/vantara.dump"
pg_dump --format=custom --no-owner --no-acl --dbname="$uchiyomi_db" --file="$tmp_dir/uchiyomi.dump"

pg_restore --list "$tmp_dir/vantara.dump" >/dev/null
pg_restore --list "$tmp_dir/uchiyomi.dump" >/dev/null

cat > "$tmp_dir/manifest.txt" <<EOF
recovery_id=$stamp
created_at=$stamp
vantara_database=$primary_db
uchiyomi_database=$uchiyomi_db
writers_paused=YES
EOF

(
  cd "$tmp_dir"
  sha256sum vantara.dump uchiyomi.dump manifest.txt > manifest.sha256
  sha256sum -c manifest.sha256 >/dev/null
)

final_dir="$backup_dir/$stamp"
mv "$tmp_dir" "$final_dir"
trap - EXIT INT TERM

ln -sfn "$stamp" "$backup_dir/latest"
printf '%s\n' "$final_dir"
