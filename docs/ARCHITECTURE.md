# Architecture

JobPilot AI is a **modular monolith**: one FastAPI application holds all domain logic, and the same
code is run in three roles (API, Celery worker, Celery beat scheduler). A React SPA is served by
nginx, which also reverse-proxies `/api` so the browser only ever talks to one origin.

```
                    ┌──────────────────────────── docker network: jobpilot ────────────────────────────┐
 Browser ──HTTP──▶  │ frontend (nginx :8080)                                                             │
                    │   ├─ /            → static React build                                             │
                    │   └─ /api, /mock-portal → backend:8000                                             │
                    │ backend (uvicorn/FastAPI) ──┬── postgres:5432 (data)                                │
                    │                             ├── redis:6379   (broker, locks, rate limits)          │
                    │                             └── /data volume (resumes, generated docs, secrets)    │
                    │ worker (celery + Playwright Chromium) ── same DB/redis/volume                      │
                    │ scheduler (celery beat) ── enqueues "agent tick" every minute                      │
                    └────────────────────────────────────────────────────────────────────────────────────┘
```

Only the frontend port is published, bound to `127.0.0.1` by default. PostgreSQL, Redis and the
browser automation never listen on host interfaces.

## Backend layout (`backend/app`)

| Package | Responsibility |
|---|---|
| `core/` | settings, DB engine/session, tenant scoping hook, logging with secret redaction, errors, rate limiter |
| `security/` | Argon2 passwords, session tokens, CSRF, Fernet encryption, SSRF-safe HTTP client, upload validation |
| `models/` | SQLAlchemy models (see `docs/DATABASE.md`) |
| `schemas/` | Pydantic request/response models |
| `api/` | Routers — thin; validate input, call services, map errors |
| `services/` | Domain logic: profile parsing, matching, tailoring, fact-checking, cover letters, discovery, applications, analytics, export |
| `adapters/job_sources/` | `JobSourceAdapter` implementations (Greenhouse, Lever, Ashby, career page JSON-LD, manual, demo) |
| `adapters/application_providers/` | `ApplicationProvider` implementations (mock portal, Greenhouse, Lever, manual) |
| `adapters/llm/` | `LLMClient` implementations (OpenAI-compatible, Anthropic) + embeddings |
| `documents/` | Text extraction (PDF/DOCX) and rendering (DOCX/PDF templates) |
| `agents/` | Agent run state machine (IDLE → DISCOVERING → … → COMPLETED/FAILED/PAUSED) |
| `workers/` | Celery app, tasks, beat schedule |

## Request lifecycle & tenant isolation

1. `SecurityHeadersMiddleware` adds CSP/HSTS/etc.
2. `get_current_user` resolves the session cookie → `UserSession` (token stored as SHA-256) → `User`.
3. For unsafe methods, the `X-CSRF-Token` header must equal the `jp_csrf` cookie (double-submit) and
   match the token bound to the session.
4. The DB session is bound to the tenant (`session.info["tenant_id"]`). A `do_orm_execute` listener
   adds `with_loader_criteria(TenantOwned, user_id == tenant)` to every ORM `SELECT`, so even a
   query that forgets `.where(user_id == …)` cannot return another user's rows. Services also
   filter explicitly and use `get_owned_or_404`.

## Untrusted content

Job descriptions, web pages, uploaded files and LLM output are untrusted:

* Fetches go through `security.ssrf.SafeHttpClient`: http(s) only, DNS resolved and checked against
  private/loopback/link-local/metadata ranges on every hop, redirects followed manually, size and
  time limits, robots.txt honoured for HTML career pages, per-host rate limits.
* LLM prompts put external content inside clearly delimited data blocks and the system prompt states it
  is data, not instructions.
* The real defence is **output validation**: `services.factcheck` rejects any generated text that
  introduces skills, numbers, employers or credentials not present in the verified profile, and the
  original text is kept instead.

## Agent pipeline

```
IDLE → DISCOVERING → ANALYZING → MATCHING → GENERATING_RESUME → PREPARING_APPLICATION
     → AWAITING_APPROVAL → (SUBMITTING → VERIFYING, only for authorised automation) → COMPLETED
                                                                       ↘ FAILED / PAUSED
```

Every run is an `AgentTask` row with per-step `AgentExecutionLog` entries. A Redis lock prevents
concurrent runs per user; daily discovery/preparation caps prevent runaway loops; cancellation is
checked between steps. The beat scheduler only enqueues runs that are due per the user's schedule.

## Applications

`Application` has a unique `(user_id, job_id)` constraint (idempotency) and an append-only
`ApplicationEvent` log. Submission modes:

* **Review** — documents prepared, user approves, user submits (or a supported provider submits after approval).
* **Assisted** — provider fills the form in an isolated browser context and captures a screenshot, then stops.
* **Authorized automation** — only when the user enabled it, the provider supports it, every required answer is
  verified, the match score passes the threshold and no CAPTCHA/MFA is present.

Provider capabilities today: the sandbox portal supports inspection, fill and submission; Greenhouse (public API
`?questions=true`) and Lever (public apply page) support inspection and assisted fill only; every other site uses
the manual provider (documents prepared, the user applies and records it). See `docs/INTEGRATIONS.md`.

## Background processing

| Process | Command | Responsibilities |
|---|---|---|
| `backend` | `uvicorn app.main:app` (runs `alembic upgrade head` first) | REST API, quick synchronous work (parsing, matching, rendering) |
| `worker` | `celery worker` (+ Chromium) | `run_pipeline`, `submit_application`, `inspect_application`, `verify_jobs`, `weekly_reports`, `retention` |
| `scheduler` | `celery beat` | `agent_tick` every minute (starts due runs, fails stale runs), job re-verification every 6 h, weekly report, retention |

Workers write heartbeats to `worker_heartbeats`, shown on the diagnostics page.

## Testing strategy

* `backend/tests` — 86 pytest tests run on SQLite and PostgreSQL, including Playwright tests that submit to the
  local sandbox portal. All candidate data is synthetic.
* `frontend/src/**/*.test.tsx` — Vitest + Testing Library.
* `e2e/api_smoke.py` / `e2e/persistence_check.py` — full workflow and restart persistence against the Docker stack
  (also run in CI).

## Documents

Originals are stored immutably (`MasterResume`, SHA-256 recorded). Every tailored resume is a new
`ResumeVersion` with the profile snapshot, job id, model/provider, change log and fact-check report;
DOCX and PDF are rendered from the same structured content.
