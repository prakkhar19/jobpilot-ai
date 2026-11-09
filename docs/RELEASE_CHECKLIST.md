# Release checklist

- [ ] CI green on `main` (lint, backend tests on PostgreSQL, frontend tests/build, Docker e2e smoke, persistence)
- [ ] `alembic check` clean; new migrations reviewed and reversible
- [ ] `docker compose up --build -d` from a clean clone with only `cp .env.example .env` works; all services healthy
- [ ] `DEMO_MODE=true` walkthrough: register → upload → approve → discover → match → resume/cover letter → prepare → approve → submit → track
- [ ] Data persists across `docker compose down && docker compose up -d`
- [ ] Backup + restore round-trip tested
- [ ] Multi-arch build workflow (amd64 + arm64) passes
- [ ] `npm audit --omit=dev` / `pip-audit` reviewed
- [ ] No secrets or personal data: `git grep` for keys, no `.env`, dumps, real resumes or screenshots with real data
- [ ] Docs match behaviour (README integration table, LIMITATIONS, ENVIRONMENT)
- [ ] Version bumped (`backend/pyproject.toml`, `frontend/package.json`, `/api/diagnostics`), CHANGELOG/release notes written
- [ ] Tag `vX.Y.Z` and publish release notes
