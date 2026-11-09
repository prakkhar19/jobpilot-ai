# Environment variables

Set in `.env` (Docker Compose passes it to backend, worker and scheduler). Names are case-insensitive.

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `jobpilot` / *(required)* / `jobpilot` | Database credentials; Compose builds `DATABASE_URL` from them |
| `DATABASE_URL` | built by Compose | SQLAlchemy URL (`postgresql+psycopg://…`; `sqlite:///…` for local dev) |
| `REDIS_URL` | `redis://redis:6379/0` | Celery broker, locks and rate limits |
| `APP_SECRET_KEY` | *(auto)* | ≥32 chars. Signs CSRF tokens and derives the API-key encryption key. Empty ⇒ generated once into `/data/secrets/app_secret`. Changing it invalidates stored API keys |
| `DATA_DIR` | `/data` | Uploads, generated documents, screenshots, secret |
| `PUBLIC_BASE_URL` | `http://localhost:8080` | Browser-facing URL (reset links, sandbox URLs) |
| `INTERNAL_BASE_URL` | `http://backend:8000` | How the worker reaches the API on the container network |
| `JOBPILOT_BIND` / `JOBPILOT_PORT` | `127.0.0.1` / `8080` | Published address of the web UI |
| `COOKIE_SECURE` | `false` | `true` behind HTTPS (Secure cookies + HSTS) |
| `ENVIRONMENT` | `production` | `development` enables `/api/docs`; `test` for the test suite |
| `LOG_LEVEL` | `INFO` | Structured JSON logs to stdout (secrets redacted) |
| `ALLOW_REGISTRATION` | `true` | `false` ⇒ only the first account can be created |
| `SINGLE_USER_MODE` | `false` | Registration closes after the first account |
| `DEMO_MODE` | `false` | Sandbox job board + mock employer portal |
| `ALLOW_PRIVATE_LLM_ENDPOINTS` | `true` | Allow AI base URLs on private networks (admins / single-user only) |
| `SESSION_TTL_HOURS` / `SESSION_IDLE_TIMEOUT_HOURS` | `168` / `48` | Session lifetime and idle timeout |
| `MAX_UPLOAD_MB` | `10` | Resume upload limit |
| `RATE_LIMIT_LOGIN_PER_MINUTE` / `RATE_LIMIT_REGISTER_PER_HOUR` | `10` / `20` | Per IP (login also per email) |
| `PER_HOST_MIN_INTERVAL_SECONDS` | `1.0` | Politeness delay between requests to the same job site |
| `FETCH_ALLOWLIST` | *(empty)* | Comma-separated hostnames exempt from the private-address block (testing only) |
| `OUTBOUND_USER_AGENT` | `JobPilotAI/0.1 (+…)` | User-Agent for job-source requests |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_STARTTLS` | — | Password-reset email |
| `PASSWORD_RESET_LOG_LINKS` | `false` | Development only: print reset links to the console |
| `DATA_RETENTION_DAYS_LOGS` | `90` | Agent execution log retention |
| `WORKER_CONCURRENCY` | `2` | Parallel worker tasks / browser sessions |
| `API_WORKERS` | `2` | Uvicorn worker processes |
| `BROWSER_HEADLESS` | `true` | Run Chromium headless |
| `CELERY_EAGER` | `false` | Run background tasks inline (tests / local dev without Redis) |
