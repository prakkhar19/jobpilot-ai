# API

The REST API lives under `/api` on the same origin as the UI. In `ENVIRONMENT=development` the interactive
OpenAPI docs are at `/api/docs`; a snapshot of the schema is in [`openapi.json`](openapi.json).

**Auth:** `POST /api/auth/register|login` set an `HttpOnly` session cookie and return `csrf_token`. Every
non-GET request must send `X-CSRF-Token: <jp_csrf cookie value>`. Errors are `{"detail": "..."}`.

| Area | Endpoints |
|---|---|
| Auth & account | `GET /auth/status`, `POST /auth/register`, `/login`, `/logout`, `GET/PATCH /auth/me`, `POST /auth/change-password`, `/password-reset/request`, `/password-reset/confirm`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}`, `POST /auth/sessions/revoke-others`, `POST /auth/delete-account`, `GET /account/export` |
| Resumes & profiles | `POST/GET /resumes`, `GET /resumes/{id}/download`, `/text`, `DELETE`; `GET/POST /profiles`, `GET /profiles/active`, `GET/PUT/DELETE /profiles/{id}`, `POST /profiles/{id}/approve|activate|duplicate` |
| AI providers | `GET /ai-providers/catalog`, `GET/POST /ai-providers`, `PUT/DELETE /ai-providers/{id}`, `POST /ai-providers/{id}/test` |
| Sources & jobs | `GET /sources/catalog`, `GET/POST /sources`, `PATCH/DELETE /sources/{id}`, `POST /sources/{id}/test`; `POST /jobs/discover` (202, background), `/jobs/import-url`, `/jobs/import-manual`, `/jobs/rematch`; `GET /jobs?view=all|recommended|saved|hidden|expired&q=&sort=&page=`; `GET/DELETE /jobs/{id}`, `POST /jobs/{id}/match|ai-summary|verify|hide`, `PUT/DELETE /jobs/{id}/save` |
| Documents | `GET /resume-templates`; `POST/GET /resume-versions`, `GET /resume-versions/{id}`, `/compare`, `/download/{pdf|docx}`, `POST /resume-versions/{id}/edit`, `DELETE`; `POST/GET /cover-letters`, `GET/PUT/DELETE /cover-letters/{id}`, `GET /cover-letters/{id}/download/{pdf|docx|txt}` |
| Applications | `GET /applications/statuses`, `GET /applications`, `POST /applications/track|prepare`, `GET/PATCH/DELETE /applications/{id}`, `POST /applications/{id}/refresh|answers|approve|submit|assisted-fill|mark-submitted|status`, `GET /applications/{id}/events`, `/screenshot/{preparation|confirmation}` |
| Interviews & answers | `GET/POST /interviews`, `PUT/DELETE /interviews/{id}`; `GET/POST /screening-answers`, `DELETE /screening-answers/{id}` |
| Agent | `GET/PUT /agent/config`, `POST /agent/run|pause|resume`, `GET /agent/tasks`, `GET /agent/tasks/{id}`, `POST /agent/tasks/{id}/cancel`, `GET /agent/logs` |
| Insights | `GET /analytics/summary`, `/analytics/weekly-report`, `GET /notifications`, `POST /notifications/{id}/read`, `/notifications/read-all`, `GET /audit-log` |
| Operations | `GET /health`, `/health/ready`, `GET /diagnostics`; admin: `GET /admin/users`, `POST /admin/users/{id}/active`, `GET /admin/stats` |

Long-running operations (`/jobs/discover`, `/agent/run`, `/applications/{id}/submit`, `/assisted-fill`) return
202 and run in the worker; poll the task or application.
