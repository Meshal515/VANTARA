#!/bin/sh
set -eu

compose='docker compose -f infra/docker-compose.yml'
export POSTGRES_USER="${POSTGRES_USER:-vantara}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-vantara-ci-password}"
export POSTGRES_DB="${POSTGRES_DB:-vantara}"
export UCHIYOMI_DB="${UCHIYOMI_DB:-uchiyomi}"
# Required substitutions elsewhere in the compose file must parse even though
# this test only starts postgres/db-backup.
export PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-http://localhost:3100}"
export SESSION_SECRET="${SESSION_SECRET:-ci-session-secret-ci-session-secret-1234}"
export VANTARA_IDENTITY_SECRET="${VANTARA_IDENTITY_SECRET:-ci-identity-secret-ci-identity-secret-12}"
export TUNNEL_TOKEN="${TUNNEL_TOKEN:-ci-unused-tunnel-token}"

cleanup() {
  $compose down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

# A previous job must never make this test pass accidentally.
cleanup
$compose config >/dev/null
$compose up -d postgres

attempt=0
# لا تستخدم socket هنا: docker-entrypoint يشغّل temporary server على socket أثناء init
# ثم يطفئه. TCP لا يصبح جاهزًا إلا مع السيرفر النهائي الذي ستستخدمه بقية الخدمات.
until $compose exec -T postgres pg_isready -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    $compose logs postgres >&2 || true
    exit 1
  fi
  sleep 1
done

# First-start init must create both databases.
for database in "$POSTGRES_DB" "$UCHIYOMI_DB"; do
  found="$($compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres -Atc \
    "SELECT 1 FROM pg_database WHERE datname = '$database'")"
  test "$found" = '1'
done

# Put independent markers in both stores so the backup/restore test proves it
# covers VANTARA and Uchiyomi rather than merely producing two archive files.
$compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE b1_restore_marker (value text PRIMARY KEY);
INSERT INTO b1_restore_marker VALUES ('vantara-before-backup');
SQL
$compose exec -T postgres psql -U "$POSTGRES_USER" -d "$UCHIYOMI_DB" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE b1_restore_marker (value text PRIMARY KEY);
INSERT INTO b1_restore_marker VALUES ('uchiyomi-before-backup');
SQL

if $compose run --rm --entrypoint sh db-backup /scripts/backup-postgres.sh >/tmp/vantara-backup-unpaused.log 2>&1; then
  echo 'paired backup unexpectedly ran while writers were not confirmed paused' >&2
  exit 1
fi
grep -q 'CONFIRM_SERVICES_PAUSED' /tmp/vantara-backup-unpaused.log

# CONFIRM_SERVICES_PAUSED is not enough by itself: an idle application connection
# proves the service was not actually stopped. Hold one psql client open after
# completing a query, verify PostgreSQL reports it as idle, and require backup
# to refuse the recovery point.
idle_fifo="/tmp/vantara-idle-client.$"
rm -f "$idle_fifo"
mkfifo "$idle_fifo"
$compose exec -T -e PGAPPNAME=vantara-idle-backup-test postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <"$idle_fifo" >/tmp/vantara-idle-client.log 2>&1 &
idle_pid=$!
exec 9>"$idle_fifo"
printf 'SELECT 1;\n' >&9

attempt=0
idle_state=''
until [ "$idle_state" = 'idle' ]; do
  idle_state="$($compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres -Atc \
    "SELECT state FROM pg_stat_activity WHERE application_name = 'vantara-idle-backup-test' LIMIT 1")"
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 20 ]; then
    echo "could not establish idle recovery-guard client (state=$idle_state)" >&2
    exec 9>&-
    wait "$idle_pid" || true
    rm -f "$idle_fifo"
    exit 1
  fi
  [ "$idle_state" = 'idle' ] || sleep 1
done

if $compose run --rm -e CONFIRM_SERVICES_PAUSED=YES --entrypoint sh db-backup \
  /scripts/backup-postgres.sh >/tmp/vantara-backup-idle-client.log 2>&1; then
  echo 'paired backup unexpectedly accepted an idle application connection' >&2
  exec 9>&-
  wait "$idle_pid" || true
  rm -f "$idle_fifo"
  exit 1
fi
grep -q 'active database' /tmp/vantara-backup-idle-client.log

exec 9>&-
wait "$idle_pid" || true
rm -f "$idle_fifo"

$compose run --rm -e CONFIRM_SERVICES_PAUSED=YES --entrypoint sh db-backup /scripts/backup-postgres.sh

$compose run --rm --entrypoint sh db-backup -c '
  set -eu
  cd /backups/postgres/latest
  test -f manifest.sha256
  sha256sum -c manifest.sha256
'

# Corrupt both markers after the snapshot. A successful restore must undo this.
$compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
  -c "UPDATE b1_restore_marker SET value = 'vantara-after-backup';"
$compose exec -T postgres psql -U "$POSTGRES_USER" -d "$UCHIYOMI_DB" -v ON_ERROR_STOP=1 \
  -c "UPDATE b1_restore_marker SET value = 'uchiyomi-after-backup';"

if $compose run --rm -e CONFIRM_RESTORE=YES --entrypoint sh db-backup /scripts/restore-postgres.sh >/tmp/vantara-restore-unpaused.log 2>&1; then
  echo 'paired restore unexpectedly ran while writers were not confirmed paused' >&2
  exit 1
fi
grep -q 'CONFIRM_SERVICES_PAUSED' /tmp/vantara-restore-unpaused.log

$compose run --rm -e CONFIRM_RESTORE=YES -e CONFIRM_SERVICES_PAUSED=YES --entrypoint sh db-backup /scripts/restore-postgres.sh

vantara_value="$($compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc \
  'SELECT value FROM b1_restore_marker')"
uchiyomi_value="$($compose exec -T postgres psql -U "$POSTGRES_USER" -d "$UCHIYOMI_DB" -Atc \
  'SELECT value FROM b1_restore_marker')"

test "$vantara_value" = 'vantara-before-backup'
test "$uchiyomi_value" = 'uchiyomi-before-backup'

# Failure after the first production restore must compensate BOTH databases
# back to the pre-restore pair, never leave a split recovery point.
$compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
  -c "UPDATE b1_restore_marker SET value = 'vantara-live-before-failed-restore';"
$compose exec -T postgres psql -U "$POSTGRES_USER" -d "$UCHIYOMI_DB" -v ON_ERROR_STOP=1 \
  -c "UPDATE b1_restore_marker SET value = 'uchiyomi-live-before-failed-restore';"

if $compose run --rm \
  -e CONFIRM_RESTORE=YES \
  -e CONFIRM_SERVICES_PAUSED=YES \
  -e VANTARA_RESTORE_TEST_MODE=YES \
  -e VANTARA_RESTORE_FAIL_DB_FOR_TESTS="$UCHIYOMI_DB" \
  --entrypoint sh db-backup /scripts/restore-postgres.sh; then
  echo 'injected second-database restore failure unexpectedly succeeded' >&2
  exit 1
fi

vantara_after_failure="$($compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc \
  'SELECT value FROM b1_restore_marker')"
uchiyomi_after_failure="$($compose exec -T postgres psql -U "$POSTGRES_USER" -d "$UCHIYOMI_DB" -Atc \
  'SELECT value FROM b1_restore_marker')"

test "$vantara_after_failure" = 'vantara-live-before-failed-restore'
test "$uchiyomi_after_failure" = 'uchiyomi-live-before-failed-restore'

printf '%s\n' 'B1 clean bootstrap + paired backup/restore failure recovery: OK'
