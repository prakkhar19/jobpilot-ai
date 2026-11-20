#!/usr/bin/env sh
# One-command start for macOS/Linux: creates .env with random secrets (first run only), builds and
# starts JobPilot in Docker, waits until it is ready and opens it.
set -eu
cd "$(dirname "$0")"
command -v docker >/dev/null || { echo "Install Docker Desktop first: https://www.docker.com/products/docker-desktop/" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is not running. Start Docker Desktop and try again." >&2; exit 1; }
[ -f .env ] || ./scripts/init-env.sh
echo "Building and starting (the first time takes 5-15 minutes)..."
docker compose up --build -d
PORT=$(sed -n 's/^JOBPILOT_PORT=\([0-9]*\).*/\1/p' .env | head -n1); PORT=${PORT:-8080}
URL="http://localhost:$PORT"
i=0
until curl -fs "$URL/healthz" >/dev/null 2>&1; do
  i=$((i+1)); [ "$i" -gt 60 ] && { echo "Not ready yet. Check: docker compose ps / docker compose logs backend" >&2; exit 1; }
  sleep 5
done
echo "JobPilot is running at $URL"
(command -v open >/dev/null && open "$URL") || (command -v xdg-open >/dev/null && xdg-open "$URL") || true
