# JobPilot AI — Implementation Plan & Checklist

This file is the living checklist. Each phase is verified (tests run, failures fixed) before moving on.
Status legend: `[x]` done and verified · `[~]` partially done (see notes) · `[ ]` not started.

## Key engineering decisions

| Decision | Choice | Why |
|---|---|---|
| Shape | Modular monolith (FastAPI) + Celery worker + Celery beat | One codebase, independent background processing, no microservice overhead |
| DB | PostgreSQL 16, SQLAlchemy 2.0, Alembic | Portable types (`Uuid`, `JSON`) so the unit suite also runs on SQLite |
| Auth | Server-side sessions (hashed token in DB) in an `HttpOnly` cookie + double-submit CSRF token | Revocable sessions, no JWT secrets in the browser |
| Passwords | Argon2id (`argon2-cffi`) | Current OWASP recommendation |
| Secrets at rest | Fernet (AES-128-CBC + HMAC) keyed from the app secret | API keys never stored or returned in plaintext |
| Tenant isolation | `user_id` on every owned row + service-layer scoping + a SQLAlchemy `do_orm_execute` hook that injects `user_id = :tenant` criteria on every ORM query when a tenant is bound | Defence in depth: forgetting a filter cannot leak rows |
| LLM | Provider-neutral interface; OpenAI-compatible (OpenAI, NVIDIA NIM/Nemotron, Ollama, vLLM, LM Studio…) + Anthropic Messages API | Users bring their own key/model |
| Works without an LLM | Rule-based resume parser, TF-IDF similarity, deterministic tailoring/cover letters | Core features never depend on a paid API; LLM output is an enhancement and is fact-checked |
| Factual safety | Every LLM rewrite is validated against the verified profile (skills, numbers, organisations); violations are reverted and logged | "Never fabricate" enforced in code, not just in prompts |
| Job sources | Greenhouse / Lever / Ashby public JSON APIs, schema.org `JobPosting` on career pages, manual URL/text import | Only sources with public, permitted access are automated |
| Applications | Provider adapters; sandbox "mock portal" for end-to-end verification; Greenhouse/Lever assisted fill (stops at CAPTCHA, never bypasses) | Human approval is the default |
| Docs | python-docx (DOCX) and ReportLab (PDF), single-column ATS-safe templates | No external binaries needed |
| Frontend | React + TS + Vite + Tailwind, TanStack Query, Radix primitives, served by nginx which proxies `/api` | Same-origin cookies, nothing secret in the bundle |

## Phases

### Phase 1 — Repository foundation
- [ ] Repo skeleton, `.gitignore`, `.dockerignore`, `.env.example`, `Makefile`, license
- [ ] Architecture + plan docs

### Phase 2 — Backend foundation
- [ ] Config, logging (structured JSON, secret redaction), DB session, tenant hook
- [ ] All models + Alembic migration
- [ ] Auth: register/login/logout/sessions/CSRF/password reset/roles/account deletion
- [ ] Rate limiting, security headers

### Phase 3 — Candidate onboarding
- [ ] Upload validation (size, extension, magic bytes, safe names)
- [ ] PDF/DOCX text extraction, rule-based parser, optional LLM extraction with grounding check
- [ ] Profile CRUD, versions, approval

### Phase 4 — AI intelligence
- [ ] LLM abstraction (OpenAI-compatible, Anthropic), retries, usage tracking, fallback
- [ ] JD requirement extraction + skill taxonomy
- [ ] Explainable weighted matching (configurable weights, unknown ≠ missing)
- [ ] Resume tailoring + fact checker + DOCX/PDF rendering, templates, change log
- [ ] Cover letters (LLM or deterministic), edit/regenerate/export

### Phase 5 — Job discovery
- [ ] Adapter interface; Greenhouse, Lever, Ashby, career page (JSON-LD), manual import
- [ ] Filters, normalisation, dedup, status re-verification, SSRF-safe fetching, robots.txt, per-host rate limits

### Phase 6 — Frontend
- [ ] Auth, onboarding wizard, all 14 pages, light/dark, responsive, toasts/dialogs/empty/error states

### Phase 7 — Application automation
- [ ] Provider interface; mock portal provider (full submit); Greenhouse/Lever assisted fill
- [ ] Review / Assisted / Authorized modes, missing-info stop, idempotency, audit trail

### Phase 8 — Background agents
- [ ] Celery worker + beat, agent lifecycle, locks, retries, pause/resume/cancel, logs, limits

### Phase 9 — Hardening
- [ ] SSRF/prompt-injection/upload/authz/tenant tests, export/deletion, backup/restore scripts, diagnostics

### Phase 10 — Release
- [ ] Docker clean build + restart persistence, CI workflows, docs set, screenshots
