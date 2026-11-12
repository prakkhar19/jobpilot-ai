#!/usr/bin/env bash
# Copy JobPilot AI to a server and run the one-time setup there.
#   ./scripts/deploy-to-server.sh ubuntu@<server-ip> [path/to/ssh-key]
# Local data, backups, .env and build artifacts are NOT copied (the server gets its own secure .env).
set -euo pipefail

TARGET="${1:?usage: scripts/deploy-to-server.sh user@host [ssh-key]}"
KEY="${2:-}"
SSH=(ssh -o StrictHostKeyChecking=accept-new)
[ -n "$KEY" ] && SSH+=(-i "$KEY")

cd "$(dirname "$0")/.."
echo "==> Copying project to $TARGET:~/jobpilot-ai"
rsync -az --delete -e "${SSH[*]}" \
  --exclude .git --exclude .env --exclude 'backups/' --exclude 'data/' --exclude node_modules \
  --exclude '.venv' --exclude 'frontend/dist' --exclude '__pycache__' --exclude 'test-results' \
  ./ "$TARGET:~/jobpilot-ai/"

echo "==> Running setup on the server"
"${SSH[@]}" -t "$TARGET" "cd ~/jobpilot-ai && bash scripts/server-setup.sh"
