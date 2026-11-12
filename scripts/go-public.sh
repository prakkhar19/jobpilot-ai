#!/usr/bin/env bash
# Publish JobPilot AI from this computer at a free public HTTPS address using Tailscale Funnel.
#   1. Install Tailscale and log in (free, no card).
#   2. ./scripts/go-public.sh          -> prints your public URL
#   ./scripts/go-public.sh off         -> stop publishing
# The app container stays bound to 127.0.0.1; only Tailscale's HTTPS proxy reaches it.
set -euo pipefail
cd "$(dirname "$0")/.."

TS="$(command -v tailscale || echo /Applications/Tailscale.app/Contents/MacOS/Tailscale)"
[ -x "$TS" ] || { echo "Tailscale is not installed. Install it from https://tailscale.com/download"; exit 1; }
PORT="$(grep -E '^JOBPILOT_PORT=' .env | cut -d= -f2)"; PORT="${PORT:-8080}"

if [ "${1:-}" = "off" ]; then
  "$TS" funnel --https=443 off || true
  echo "Public access stopped."
  exit 0
fi

"$TS" status >/dev/null 2>&1 || { echo "Log in to Tailscale first (open the Tailscale app)."; exit 1; }
NAME="$("$TS" status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"
URL="https://${NAME}"

set_env() {  # set_env KEY VALUE
  if grep -qE "^$1=" .env; then sed -i.bak "s|^$1=.*|$1=$2|" .env && rm -f .env.bak; else echo "$1=$2" >> .env; fi
}
set_env PUBLIC_BASE_URL "$URL"
set_env COOKIE_SECURE true
set_env SINGLE_USER_MODE false

echo "==> Restarting JobPilot with the public address"
docker compose up -d --wait >/dev/null

echo "==> Publishing over HTTPS"
"$TS" funnel --bg "$PORT"

echo
echo "Public URL:  $URL"
echo "Share it with friends. To stop new sign-ups later: set ALLOW_REGISTRATION=false in .env and run 'docker compose up -d'."
