# AI_SETUP.md — instructions for an AI coding agent

> **You are an AI agent who was handed this file and asked to "set this up".** Read the whole file first and follow it top to bottom.
> The goal: get JobPilot AI running on this machine (usually the owner's **Windows** PC), with the owner's existing
> account and data restored from the repo, and the Chrome extension loaded, so the owner can log in and auto-apply as before.

---

## 1. What this project is (2-minute mental model)

JobPilot AI is a self-hosted job-search assistant that runs entirely in **Docker**. There are two parts:

1. **The server stack** (`docker compose`), which runs at **http://localhost:8080**.
   * `frontend`: nginx serving the React SPA (`frontend/`) and proxying `/api` to the backend. **This is the only published port.**
   * `backend`: FastAPI (`backend/app`). It runs `alembic upgrade head` on start, then uvicorn on :8000 (internal only).
   * `worker`: Celery worker plus headless Chromium (Playwright). It handles discovery, matching, resume tailoring and form inspection.
   * `scheduler`: Celery beat. It enqueues an "agent tick" every minute, which runs job discovery around the clock.
   * `postgres` 16 and `redis` 7 run on the internal network only.
   * Data lives in named Docker volumes: `pgdata` (DB), `redisdata`, `appdata` (resumes, generated docs, secrets) mounted at `/data`.
2. **The Chrome extension** (`extension/`, Manifest V3, loaded unpacked). It does the actual auto-applying inside the
   owner's own logged-in Chrome: LinkedIn Easy Apply, Naukri, Instahyre, and company ATS pages (Greenhouse, Lever, Ashby,
   Workable, SmartRecruiters), plus LinkedIn recruiter outreach. It talks to the server through `/api/ext/*`
   (`backend/app/api/extension.py`) with a bearer token. It downloads a resume tailored to each job, asks the server to answer
   form questions from the approved profile and answer bank, and reports results. Anything it can't answer, and any CAPTCHA,
   goes into **"Needs you"** in the popup. It never invents answers.

Data flow:

```
discovery (worker, every ~15 min) → jobs in Postgres → match score
      → extension (/api/ext/queue, /evaluate, /jobs/{id}/resume.pdf, /answers, /result)
      → applies in a background Chrome tab → Applications page in the web UI
```

The key folders are:

| Path | What |
|---|---|
| `docker-compose.yml`, `Dockerfile`, `docker/` | The whole stack. Multi-stage Dockerfile with targets `backend`, `worker`, `frontend`. |
| `backend/app/` | `api/` routers, `services/` domain logic, `adapters/` (job sources, LLMs, application providers), `workers/` Celery, `models/` SQLAlchemy, `migrations/` Alembic |
| `frontend/src/` | React + TypeScript + Vite UI |
| `extension/` | Chrome extension. `background.js` is the orchestrator and `content/<site>.js` holds the per-site DOM automation. |
| `scripts/` | `start-windows.ps1`, `restore-windows.ps1`, `backup.sh`, `restore.sh`, `init-env.sh`, `connect-extension.sh` |
| `start.bat` / `stop.bat` / `restore.bat` | Windows double-click launchers that call the `.ps1` scripts |
| `start.sh` | macOS/Linux one-command start |
| `data-sync/latest/` | **The owner's data snapshot**: `db.dump` (pg_dump `-Fc`) + `appdata.tar.gz` (the `/data` volume) + `MANIFEST.txt`. Used to move the account between machines. |
| `.env` | Committed on purpose for the machine move. It holds `POSTGRES_PASSWORD` and **`APP_SECRET_KEY`**. See section 3. |
| `docs/` | Architecture, API, database, environment variables, troubleshooting, and more. Read them if you need depth. |

---

## 2. Prerequisites

* **Docker Desktop** installed and running ("Engine running"). On Windows it needs WSL 2 (Docker Desktop's installer handles it).
  Nothing else is needed on the host: no Python, Node or Postgres.
* **Git** (to clone or pull).
* **Google Chrome** (for the extension).
* About 6 GB of free disk space, because the worker image contains Chromium. The first build takes 5 to 15 minutes.

Check:

```powershell
docker --version
docker compose version     # must be Compose v2
docker info                # must not error
git --version
```

If Docker isn't installed, tell the owner to install Docker Desktop from https://www.docker.com/products/docker-desktop/,
start it once, then continue. You can't finish setup without it.

---

## 3. Critical rules (read before running anything)

1. **Do not regenerate or overwrite `.env`.** It is committed in the repo. Its `APP_SECRET_KEY` decrypts the stored AI-provider
   keys, mailbox credentials and careers-portal accounts that are inside `data-sync/latest/`. A new key makes those
   unreadable ("Stored secret could not be decrypted"). `POSTGRES_PASSWORD` must also stay as it is.
   Don't run `make init-env` or `scripts/init-env.sh`, and don't copy `.env.example` over `.env`.
2. **Line endings:** `.gitattributes` forces LF for everything except `.bat/.cmd/.ps1`. Shell scripts run inside Linux containers
   and break if they get CRLF. If a container fails with `/bin/sh^M` or `exec format error` from `docker/entrypoint.sh`, run
   `git config core.autocrlf false`, then `git rm --cached -r . ; git reset --hard` and rebuild.
3. **Restoring replaces the database** on this machine. That's intended on a fresh machine. If JobPilot is already running here with
   data you care about, back it up first (`docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > before-restore.dump`).
4. Never commit `extension/config.local.json`, which holds a session token and is git-ignored.
5. Don't add features or "fix" site selectors as part of setup. Only set it up and verify it.

---

## 4. Setup on Windows (the main path)

Run these in **PowerShell** (not as admin unless Docker requires it):

```powershell
# 1. Get the code (skip clone if the folder already exists, just pull)
git clone https://github.com/prakkhar19/jobpilot-ai.git
cd jobpilot-ai
git pull

# 2. Confirm the data snapshot and .env came down
Test-Path .env                              # True
Get-Content data-sync\latest\MANIFEST.txt    # shows created_utc, db_bytes, files_bytes, alembic_head
```

### 4a. Restore the owner's account and data (fresh machine, the normal case)

`restore.bat` calls `scripts/restore-windows.ps1`. It asks you to type `RESTORE`, so it is interactive. Either:

* ask the owner to double-click **`restore.bat`** and type `RESTORE`, **or**
* run the same steps yourself, non-interactively, from the repo root:

```powershell
docker compose build
docker compose up -d postgres redis
# wait until healthy
do { Start-Sleep 2; docker compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' *> $null } while ($LASTEXITCODE -ne 0)

docker compose cp data-sync\latest\db.dump postgres:/tmp/db.dump
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner /tmp/db.dump; rm -f /tmp/db.dump'

$abs = (Resolve-Path data-sync\latest).Path
docker compose run --rm --no-deps -T -v "${abs}:/restore:ro" --entrypoint sh backend -c 'tar -C /data -xzf /restore/appdata.tar.gz'

docker compose up -d
```

`pg_restore` printing a few "does not exist, skipping" warnings on a fresh DB is normal. Real errors are not.

### 4b. Just start it (data already restored, or the owner wants a clean install)

Double-click **`start.bat`** or run `docker compose up --build -d`. `start.bat` only creates `.env` if it's missing, which it
won't be here.

### 4c. Verify

```powershell
docker compose ps                         # postgres, redis, backend, worker, frontend → healthy; scheduler → running
Invoke-WebRequest http://localhost:8080/healthz -UseBasicParsing        # 200
Invoke-WebRequest http://localhost:8080/api/health/ready -UseBasicParsing   # 200
docker compose logs --tail=50 backend     # should show alembic upgrade + uvicorn started, no tracebacks
```

Then open http://localhost:8080. **The owner logs in with their usual email and password** (the restored account).
Don't create a new account. Ask the owner for credentials only if they want you to check the UI, and never store them.

If the owner forgot the password: `docker compose exec backend python -m app.cli reset-password <their-email>` prints a one-hour reset link.

---

## 5. Load the Chrome extension

The owner must do this in their own Chrome. Walk them through it:

1. Chrome → `chrome://extensions` → turn on **Developer mode** (top right).
2. **Load unpacked** → pick the repo's **`extension`** folder.
3. In the same Chrome, log in to **LinkedIn, Naukri and Instahyre**.
4. Click the JobPilot extension icon → server `http://localhost:8080` → log in with the JobPilot email and password →
   **Start auto-apply**.

Optional pre-connect (macOS/Linux/Git-Bash only): `scripts/connect-extension.sh <email> --autostart` writes
`extension/config.local.json` so the popup doesn't need a login. On Windows, just log in through the popup.

Behaviour: the extension works in a background tab it opened itself, at a human pace. It runs a new cycle every ~30 minutes and
stops at the daily cap (popup → Settings). It resets at local midnight. Chrome must stay open.
After any code change in `extension/`, click **Reload** on the extension card in `chrome://extensions`.

---

## 6. Setup on macOS / Linux (if not Windows)

```bash
git clone https://github.com/prakkhar19/jobpilot-ai.git && cd jobpilot-ai
docker compose build
./scripts/restore.sh data-sync/latest     # restore the owner's data (prompts for confirmation)
docker compose up -d                       # or ./start.sh
```

Then follow sections 4c and 5.

---

## 7. Moving data again later (back to Mac or to another PC)

On the machine that has the current data:

```bash
./scripts/backup.sh data-sync          # writes data-sync/jobpilot-<timestamp>/
rm -rf data-sync/latest && mv data-sync/jobpilot-* data-sync/latest
git add -f data-sync/latest && git commit -m "Refresh data snapshot" && git push
```

(On Windows without bash, run the `pg_dump` and `tar` commands from `scripts/backup.sh` by hand through `docker compose exec` / `run`.)
On the target machine: `git pull`, then section 4a.

---

## 8. Everyday commands

```powershell
docker compose up -d            # start (start.bat does this and opens the browser)
docker compose stop             # stop, data kept (stop.bat)
docker compose logs -f --tail=100 backend worker
docker compose restart backend worker scheduler frontend
docker compose up --build -d    # after pulling code changes
docker compose ps
```

`make` targets exist (`make up`, `make logs`, `make backup`, …) but Windows usually lacks `make`, so use the raw commands.

---

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| `Set POSTGRES_PASSWORD in .env` | `.env` is missing. `git checkout -- .env` (it's in the repo). Don't make a new one. |
| `/bin/sh^M` or entrypoint `exec format error` | CRLF line endings. See rule 2 in section 3. |
| Port 8080 in use | Change `JOBPILOT_PORT` in `.env`, `docker compose up -d`, and use the new port in the extension popup. |
| Login says wrong password after restore | The restore didn't run, or ran against a different DB. Check `docker compose logs postgres`, rerun 4a, or use `reset-password`. |
| "Stored secret could not be decrypted" | `APP_SECRET_KEY` in `.env` differs from the source machine. Restore the committed `.env` (`git checkout -- .env`) and `docker compose up -d`. Otherwise the owner re-enters AI keys in *Integrations*. |
| `pg_restore` errors about version | The dump is from postgres 16. Keep the `postgres:16-alpine` image. |
| worker unhealthy or slow first start | It's still pulling or building Chromium. Wait, then `docker compose logs worker`. |
| Build fails on network | Retry `docker compose build`. Docker Desktop may need more RAM (≥4 GB) under Settings → Resources. |
| Extension popup can't reach server | Is the stack up (`/healthz`)? Is the server URL exactly `http://localhost:8080`? |
| Extension stops on a site | Site layouts change. The popup's Activity log (also mirrored in `docker compose logs backend`, logger `jobpilot.extension`) shows the step. Selectors live in `extension/content/<site>.js`. |

More detail: `docs/TROUBLESHOOTING.md`, `docs/ENVIRONMENT.md`, `docs/ARCHITECTURE.md`, `extension/README.md`.

---

## 10. Done checklist (report this back to the owner)

- [ ] `docker compose ps` shows everything healthy or running
- [ ] http://localhost:8080 loads and the owner can log in with their existing account (their jobs and applications are visible)
- [ ] AI provider test passes in *Integrations → AI providers* (if one was configured)
- [ ] Extension loaded, logged in, **Start auto-apply** pressed, and the Activity log shows it working
