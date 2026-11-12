#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu server (e.g. Oracle Cloud Always Free, Arm) for JobPilot AI.
# Run ON THE SERVER from the project directory:   bash scripts/server-setup.sh
# Installs Docker + Tailscale, creates a secure .env, starts the stack. Nothing is exposed to the internet:
# you reach the app privately over Tailscale (free) at http://<server-name>:8080.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Installing Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

echo "==> Installing Tailscale (private access, no open ports)"
if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sudo sh
fi
sudo tailscale up --ssh || true
TS_IP="$(tailscale ip -4 | head -1)"
TS_NAME="$(tailscale status --self --json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))' 2>/dev/null || echo "$TS_IP")"

echo "==> Creating .env"
if [ ! -f .env ]; then
  ./scripts/init-env.sh
  sed -i "s/^SINGLE_USER_MODE=false/SINGLE_USER_MODE=true/" .env
  # Publish only on the private Tailscale address, never on the public interface.
  sed -i "s/^JOBPILOT_BIND=.*/JOBPILOT_BIND=${TS_IP}/" .env
  sed -i "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=http://${TS_NAME}:8080|" .env
fi

echo "==> Starting JobPilot AI (first build takes ~10 minutes)"
sudo docker compose up --build -d --wait --wait-timeout 900

echo "==> Daily backup at 03:00"
( crontab -l 2>/dev/null | grep -v jobpilot-backup; \
  echo "0 3 * * * cd $(pwd) && ./scripts/backup.sh >/dev/null 2>&1 # jobpilot-backup" ) | crontab -

echo
echo "Done. Install Tailscale on your laptop/phone (same account), then open:"
echo "    http://${TS_NAME}:8080"
