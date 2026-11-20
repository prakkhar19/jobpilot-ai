#!/usr/bin/env bash
# Pre-connect the Chrome extension to a JobPilot account (no login in the popup needed).
# Usage: scripts/connect-extension.sh you@example.com [--autostart]
# Writes extension/config.local.json (git-ignored) containing a session token for that account.
set -euo pipefail
cd "$(dirname "$0")/.."
EMAIL="${1:?usage: $0 email [--autostart]}"
AUTO=false
[[ "${2:-}" == "--autostart" ]] && AUTO=true

TOKEN=$(docker compose exec -T -e JP_EMAIL="$EMAIL" backend python - <<'EOF'
import os
from sqlalchemy import select
from app.core.database import SessionLocal
from app.models import User
from app.services.accounts import create_session
db = SessionLocal()
u = db.scalar(select(User).where(User.email == os.environ["JP_EMAIL"].lower()))
if u is None:
    raise SystemExit("no such JobPilot user")
print(create_session(db, u, "127.0.0.1", "JobPilot extension (pre-connected)"))
EOF
)
umask 077
printf '{"server":"http://localhost:8080","token":"%s","account":"%s","autostart":%s}\n' "$TOKEN" "$EMAIL" "$AUTO" > extension/config.local.json
echo "Wrote extension/config.local.json for $EMAIL (autostart=$AUTO)."
