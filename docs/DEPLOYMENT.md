# Deployment

## Local (laptop/desktop)

`cp .env.example .env && docker compose up --build -d`, open http://localhost:8080. The port is bound to
127.0.0.1, so other devices cannot reach it. This is the safest default.

## Remote server (VPS) with HTTPS

Docker on your laptop is **not** reachable from the internet. For access from anywhere, use a server:

1. A Linux VPS (2 vCPU / 4 GB RAM recommended; amd64 or arm64) with Docker Engine + Compose plugin.
2. A DNS name pointing at it, e.g. `jobs.example.com`.
3. Install and configure:

   ```bash
   git clone https://github.com/YOUR_USERNAME/jobpilot-ai.git && cd jobpilot-ai
   make init-env            # random POSTGRES_PASSWORD and APP_SECRET_KEY
   ```

   Edit `.env`: `PUBLIC_BASE_URL=https://jobs.example.com`, `COOKIE_SECURE=true`, keep `JOBPILOT_BIND=127.0.0.1`,
   and consider `SINGLE_USER_MODE=true` (personal use) or `ALLOW_REGISTRATION=false` after creating accounts.

4. Put an HTTPS reverse proxy in front. With [Caddy](https://caddyserver.com) (automatic certificates):

   ```
   # /etc/caddy/Caddyfile
   jobs.example.com {
       encode gzip
       reverse_proxy 127.0.0.1:8080
   }
   ```

   `sudo systemctl reload caddy`. Any proxy (nginx, Traefik) works: terminate TLS and forward to `127.0.0.1:8080`
   with `X-Forwarded-For` / `X-Forwarded-Proto`.

5. `docker compose up --build -d` and open `https://jobs.example.com`.

6. Firewall: allow only 22 (SSH), 80 and 443. Never publish 5432 (PostgreSQL), 6379 (Redis) or 8000.

Alternatives for private access without a public site: a VPN such as WireGuard or Tailscale, binding to the VPN
interface address via `JOBPILOT_BIND`.

## Upgrades

```bash
make backup
git pull
docker compose up --build -d     # migrations run automatically; volumes are preserved
```

Never run `docker compose down -v` unless you intend to delete all data.

## Resource notes

The worker runs headless Chromium only for application form automation. `WORKER_CONCURRENCY` (default 2) bounds
parallel browser sessions; `shm_size: 1gb` is set for Chromium stability.

## Architectures

Images build on linux/amd64 and linux/arm64 (Apple Silicon, Graviton, Raspberry Pi 5 with 64-bit OS).
