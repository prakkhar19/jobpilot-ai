# Contributing to JobPilot AI

Thanks for helping! This project helps people with something stressful — job hunting — so reliability,
honesty and privacy come before feature count.

## Ground rules

1. **Never fabricate candidate information.** Any code that generates resume/cover-letter text must route it
   through `app/services/factcheck.py`. PRs that weaken fact-checking will not be merged.
2. **Permitted access only.** New job sources must use public APIs or pages that allow automated access
   (robots.txt, terms). No CAPTCHA/MFA/login bypass, no anti-bot evasion, no scraping of sites that prohibit it.
3. **No personal data in the repo.** Use the synthetic fixtures in `backend/tests/fixtures.py`. Never commit
   real resumes, `.env` files, API keys, cookies or database dumps.
4. **Tenant isolation.** Every user-owned table inherits `TenantOwned`; every endpoint uses `CurrentUser` and
   `get_owned_or_404` (or an explicit `user_id` filter). Add a cross-tenant test for new endpoints.

## Development setup

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). In short:

```bash
make dev-backend      # FastAPI on :8000 (SQLite, demo mode, tasks run inline)
make dev-frontend     # Vite on :5173, proxies /api
make test lint        # all tests and linters
```

## Pull requests

* Keep PRs focused; include tests (`backend/tests`, `frontend/src/**/*.test.tsx`).
* Database changes need an Alembic migration: `cd backend && uv run alembic revision --autogenerate -m "..."`,
  then review the generated file. CI runs `alembic check`.
* Update the docs when behaviour changes. Docs must describe what the code actually does.
* CI must be green: lint, backend tests on PostgreSQL, frontend tests/build, Docker build and the end-to-end smoke test.

## Adding a job source

Implement `JobSourceAdapter` (`backend/app/adapters/job_sources/base.py`): `validate_source_access`,
`discover_jobs`, `fetch_job_details`, `normalize_job`, `check_job_status`. Register it in
`adapters/job_sources/__init__.py`, add the kind to `SourceIn` in `schemas/jobs.py`, and add tests with mocked
HTTP (see `tests/test_discovery.py`). Document it in `docs/INTEGRATIONS.md`.

## Adding an application provider

Implement `ApplicationProvider` (`adapters/application_providers/base.py`). Set `supports_submit=True` only if the
platform permits automated submission. Always call `ensure_no_human_gate(page)` before interacting.
