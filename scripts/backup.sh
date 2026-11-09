#!/usr/bin/env sh
# Back up the JobPilot AI database and file storage.
#
#   ./scripts/backup.sh [output-directory]        (default: ./backups)
#
# Produces <dir>/jobpilot-<timestamp>/{db.dump,appdata.tar.gz,MANIFEST.txt}.
# Backups contain personal data and the auto-generated app secret: store them securely.
set -eu

cd "$(dirname "$0")/.."
OUT_ROOT="${1:-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$OUT_ROOT/jobpilot-$STAMP"
mkdir -p "$OUT"
chmod 700 "$OUT_ROOT" "$OUT" 2>/dev/null || true

if ! docker compose ps --status running --services | grep -qx postgres; then
  echo "error: the postgres service is not running (docker compose up -d postgres)" >&2
  exit 1
fi

echo "==> Dumping database"
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$OUT/db.dump"

echo "==> Archiving uploaded and generated files"
docker compose run --rm --no-deps -T --entrypoint sh backend -c 'tar -C /data -czf - .' > "$OUT/appdata.tar.gz"

{
  echo "created_utc=$STAMP"
  echo "db_bytes=$(wc -c < "$OUT/db.dump" | tr -d ' ')"
  echo "files_bytes=$(wc -c < "$OUT/appdata.tar.gz" | tr -d ' ')"
  echo "alembic_head=$(docker compose run --rm --no-deps -T backend alembic current 2>/dev/null | tail -1 || echo unknown)"
} > "$OUT/MANIFEST.txt"

echo "==> Backup written to $OUT"
