#!/bin/sh
set -eu

# PostgreSQL لا يستطيع مزامنة snapshot منطقي بين قاعدتين مختلفتين. لذلك
# الزوج VANTARA/Uchiyomi لا يُنشر كـrecovery point واحد إلا في نافذة كتابة
# متوقفة. هذا شرط صحة، لا مجرد تأكيد شكلي.
if [ "${CONFIRM_SERVICES_PAUSED:-}" != "YES" ]; then
  echo 'Refusing paired backup: stop VANTARA/Uchiyomi writers and set CONFIRM_SERVICES_PAUSED=YES' >&2
  exit 2
fi

backup_dir="${BACKUP_DIR:-/backups/postgres}"
primary_db="${POSTGRES_DB:-vantara}"
uchiyomi_db="${UCHIYOMI_DB:-uchiyomi}"
mkdir -p "$backup_dir"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
tmp_dir="$backup_dir/.tmp-$stamp-$$"
mkdir -p "$tmp_dir"
trap 'rm -rf "$tmp_dir"' EXIT INT TERM

# كل pg_dump متسق داخل قاعدة واحدة. شرط الخدمات المتوقفة أعلاه هو الذي يجعل
# اللقطتين المتتاليتين زوجًا منطقيًا واحدًا عبر القاعدتين.
pg_dump --format=custom --no-owner --no-acl --dbname="$primary_db" --file="$tmp_dir/vantara.dump"
pg_dump --format=custom --no-owner --no-acl --dbname="$uchiyomi_db" --file="$tmp_dir/uchiyomi.dump"

# Validate both archives before publishing them as the newest backup.
pg_restore --list "$tmp_dir/vantara.dump" >/dev/null
pg_restore --list "$tmp_dir/uchiyomi.dump" >/dev/null

final_dir="$backup_dir/$stamp"
mv "$tmp_dir" "$final_dir"
trap - EXIT INT TERM

ln -sfn "$stamp" "$backup_dir/latest"
printf '%s\n' "$final_dir"
