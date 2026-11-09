# Development

## Prerequisites

* [uv](https://docs.astral.sh/uv/) (installs Python 3.12 automatically), Node.js 22+, Docker (for PostgreSQL/the full stack).

## Run locally without Docker

```bash
cd backend && uv sync && uv run playwright install chromium   # once
make dev-backend    # FastAPI :8000 — SQLite in ./data/dev, DEMO_MODE, background tasks inline
make dev-frontend   # Vite :5173 — proxies /api and /mock-portal to :8000
```

Open http://localhost:5173. `ENVIRONMENT=development` exposes the OpenAPI UI at http://localhost:8000/api/docs.

## Tests

```bash
make test-backend                     # pytest (SQLite); browser tests use Playwright Chromium
TEST_DATABASE_URL=postgresql+psycopg://jobpilot:jobpilot@localhost:5432/test uv run pytest   # against PostgreSQL
make test-frontend                    # Vitest
make lint                             # ruff, eslint, tsc
docker compose exec -T backend python - < e2e/api_smoke.py         # full workflow against the running stack (DEMO_MODE=true)
```

Backend test suites: auth/sessions/CSRF/rate limits, upload validation & parsing, LLM grounding, matching, fact
checking & prompt injection, tailoring & rendering, cover letters, discovery adapters (mocked HTTP), filters &
dedup, SSRF, tenant isolation, secret handling, application state machine, sandbox submission with Playwright
(CAPTCHA stop, idempotency, assisted fill), agent pipeline, limits and scheduler.

All test data is synthetic (`backend/tests/fixtures.py`). Tests never contact real employers.

## Layout

```
backend/app/
  api/            routers (thin)            services/      domain logic
  adapters/       job_sources, application_providers, llm
  agents/         pipeline state machine    workers/       Celery app + tasks
  core/           config, db, logging       security/      passwords, tokens, crypto, ssrf, uploads
  documents/      extraction + rendering    models/ schemas/ data/
frontend/src/     React + TypeScript (pages, components, services, hooks, context, types)
```

## Database changes

Edit models → `uv run alembic revision --autogenerate -m "describe"` → review → `uv run alembic upgrade head`.
