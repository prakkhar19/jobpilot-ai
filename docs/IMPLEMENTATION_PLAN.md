# JobPilot AI — Implementation Plan & Checklist

Status legend: `[x]` implemented and verified by tests/run · `[~]` partial (see note) · `[ ]` not done.
Last verified: 2026-11-10 — backend 89 pytest (SQLite + PostgreSQL), frontend 80 Vitest, Docker stack E2E
(API workflow through nginx, browser UI tests, restart persistence).

## Phase 1 — Repository foundation
- [x] Monorepo skeleton, `.gitignore`, `.dockerignore`, `.env.example`, `Makefile`, MIT license
- [x] Architecture + plan docs

## Phase 2 — Backend foundation
- [x] Config, structured JSON logging with secret redaction, DB session, ORM tenant-isolation hook
- [x] 28 tables, Alembic migration (`alembic check` clean on PostgreSQL and SQLite)
- [x] Auth: register/login/logout, server sessions, CSRF, password reset (email or CLI), roles, lockout, account deletion
- [x] Rate limiting (Redis, in-process fallback), security headers

## Phase 3 — Candidate onboarding
- [x] Upload validation (size, extension, magic bytes, DOCX structure, zip bomb, safe names, traversal guard)
- [x] PDF/DOCX extraction, rule-based parser, optional LLM extraction with grounding (hallucinations discarded)
- [x] Profile CRUD, versions, approval, activation, duplication; immutable originals (SHA-256)

## Phase 4 — AI intelligence
- [x] LLM abstraction: OpenAI-compatible (httpx) + Anthropic (official SDK), retries, fallback provider, usage + cost
- [x] JD requirement extraction with a ~160-entry skill taxonomy
- [x] Explainable weighted matching, configurable weights, unknown ≠ missing, TF-IDF or embeddings
- [x] Resume tailoring + fact checker + DOCX/PDF, 4 templates, change log, compare, user edits as new versions
- [x] Cover letters (deterministic or LLM; unverified sentences removed), edit, export PDF/DOCX/TXT

## Phase 5 — Job discovery
- [x] Adapters: Greenhouse, Lever (incl. EU), Ashby, career pages (JSON-LD, robots.txt), demo sandbox, manual import
- [x] Filters, normalisation, cross-source dedup, expiry detection, re-verification task, SSRF-safe fetching, per-host throttling
- [x] Unsupported platforms listed explicitly (LinkedIn, Indeed, Naukri, Wellfound, Instahyre, Foundit, Glassdoor)

## Phase 6 — Frontend
- [x] Auth pages, onboarding wizard, all 14 pages + admin, light/dark, responsive drawer, toasts/dialogs/empty/error states

## Phase 7 — Application automation
- [x] Provider interface; sandbox portal (inspect/fill/submit/verify); Greenhouse/Lever inspection + assisted fill
- [x] Review / Assisted / Authorized modes, needs-input stop, answer bank, idempotency, threshold gate, CAPTCHA stop, audit trail
- [~] Automated submission to real employers intentionally not implemented (see docs/LIMITATIONS.md)

## Phase 8 — Background agents
- [x] Celery worker + beat, lifecycle states, Redis locks, daily limits, pause/resume/cancel, logs, stale-run recovery, heartbeats

## Phase 9 — Hardening
- [x] SSRF, prompt-injection, upload, authorization, tenant-leak, secret-leak, header-injection tests
- [x] Export, account deletion, backup/restore scripts, diagnostics page, log retention
- [x] Race-safe secret generation across processes (found by fresh-volume Docker test)

## Phase 10 — Release
- [x] Docker clean build, all services healthy, non-root, only 127.0.0.1:8080 published
- [x] Restart persistence verified
- [x] CI workflows (lint, tests on PostgreSQL, frontend, Docker E2E, persistence, dependency/secret checks), multi-arch build workflow
- [x] Docs set, issue/PR templates, synthetic demo seed + screenshots
- [ ] CI has not yet run on GitHub (repository not pushed)
- [ ] Multi-arch (amd64) image build not verified locally — only arm64 was built on this machine
- [x] Backup → restore round trip verified (data deleted after backup was recovered)
