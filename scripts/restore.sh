#!/usr/bin/env sh
# Restore a backup created by scripts/backup.sh.
#
#   ./scripts/restore.sh backups/jobpilot-<timestamp>
#
# The database is replaced with the backup's contents. Files from the backup are extracted over the
# data volume (existing files with the same name are overwritten; nothing else is deleted).
set -eu

cd "$(dirname "$0")/.."
SRC="${1:?usage: scripts/restore.sh <backup-directory>}"
[ -f "$SRC/db.dump" ] || { echo "error: $SRC/db.dump not found" >&2; exit 1; }
[ -f "$SRC/appdata.tar.gz" ] || { echo "error: $SRC/appdata.tar.gz not found" >&2; exit 1; }

printf "This will REPLACE the current database with %s. Type RESTORE to continue: " "$SRC"
read -r answer
[ "$answer" = "RESTORE" ] || { echo "aborted"; exit 1; }

echo "==> Stopping application services"
docker compose stop frontend worker scheduler backend

echo "==> Starting database"
docker compose up -d postgres redis
until docker compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; do sleep 1; done

echo "==> Restoring database"
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < "$SRC/db.dump"

echo "==> Restoring files"
docker compose run --rm --no-deps -T --entrypoint sh backend -c 'tar -C /data -xzf -' < "$SRC/appdata.tar.gz"

echo "==> Starting application (migrations run automatically)"
docker compose up -d
echo "==> Restore complete"
