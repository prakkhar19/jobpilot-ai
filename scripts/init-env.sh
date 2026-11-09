#!/usr/bin/env sh
# Create .env from .env.example with freshly generated secrets. Refuses to overwrite an existing .env.
set -eu
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  echo ".env already exists — not overwriting." >&2
  exit 1
fi
gen() { head -c 48 /dev/urandom | base64 | tr -d '\n/+=' | cut -c1-"$1"; }
PG_PASS="$(gen 32)"
APP_KEY="$(gen 64)"
sed -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$PG_PASS|" \
    -e "s|^APP_SECRET_KEY=.*|APP_SECRET_KEY=$APP_KEY|" .env.example > .env
chmod 600 .env
echo "Created .env with random POSTGRES_PASSWORD and APP_SECRET_KEY. Back it up somewhere safe."
