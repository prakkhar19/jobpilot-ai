# Database

PostgreSQL 16 via SQLAlchemy 2 + Alembic (`backend/migrations`). Primary keys are UUIDs; timestamps are
timezone-aware UTC. Every table except `users`, `password_reset_tokens` and `worker_heartbeats` carries a
non-null `user_id` FK to `users(id) ON DELETE CASCADE`, so deleting an account deletes everything it owns.

| Table | Purpose | Notable constraints |
|---|---|---|
| `users` | Accounts (email, Argon2 hash, role, lockout fields, onboarding flag) | unique `email` |
| `user_sessions` | Server-side sessions (SHA-256 of token, expiry, last seen, IP, UA, revoked) | unique `token_hash` |
| `password_reset_tokens` | Single-use, 1-hour reset tokens (hashed) | unique `token_hash` |
| `master_resumes` | Immutable uploaded originals (path, MIME, size, SHA-256, extracted text) | |
| `candidate_profiles` | Verified profile (contact, summary, achievements, publications, application facts), status `draft/approved`, `version`, `is_active` | |
| `educations`, `work_experiences`, `skills`, `projects`, `certifications` | Profile sections (cascade with profile) | unique `(profile_id, name)` on skills |
| `resume_versions` | Generated resumes: structured content, profile snapshot, change log, fact-check report, provider/model, file paths, parent version | FK job/profile `SET NULL` |
| `cover_letters` | Versioned letters with method/provider and fact-check report | |
| `job_sources` | Configured discovery sources and their health | unique `(user_id, kind, identifier)` |
| `jobs` | Normalised postings, status `active/expired/unknown`, `dedupe_key`, `duplicate_of_id`, demo flag | unique `(user_id, source_kind, external_id)` |
| `job_requirements` | Extracted requirements (required/preferred skills, years, education, seniority, responsibilities) | cascade with job |
| `job_matches` | Score, per-component breakdown, strengths/gaps/unknowns, weights, recommendation | unique `(user_id, job_id)` |
| `saved_jobs` | Bookmarks with notes | unique `(user_id, job_id)` |
| `applications` | One per job (idempotency), status, mode, provider, documents, form fields, answers (with source), missing fields, approval/submission data | unique `(user_id, job_id)` |
| `application_events` | Append-only audit trail of every application change (actor, from→to status) | |
| `interviews` | Interview schedule/outcomes per application | |
| `screening_answers` | User-verified answers reused for screening questions | unique `(user_id, question_key)` |
| `ai_provider_configurations` | Provider, base URL, model, **encrypted** API key, limits, default/fallback, usage counters, prices | |
| `agent_configurations` | Schedule, search filters, thresholds, limits, application mode, matching weights | one per user |
| `agent_tasks` | Pipeline runs: lifecycle state, stats, error, heartbeats, cancel flag | |
| `agent_execution_logs` | Per-step logs (retention: `DATA_RETENTION_DAYS_LOGS`) | |
| `notifications` | In-app notifications | |
| `audit_logs` | Security-relevant actions (redacted data) | |
| `worker_heartbeats` | Worker/scheduler liveness (system table) | |

## Migrations

```bash
docker compose run --rm backend migrate                         # apply (also done automatically on API start)
cd backend && uv run alembic revision --autogenerate -m "msg"   # create (dev)
uv run alembic check                                            # CI: models and migrations agree
```
