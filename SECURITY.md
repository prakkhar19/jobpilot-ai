# Security Policy

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private vulnerability reporting
(*Security → Report a vulnerability*) on this repository. Include steps to reproduce and the impact.
We aim to acknowledge reports within 7 days.

## Supported versions

Security fixes are made on the latest release on `main`.

## Security model (summary)

* **Authentication:** Argon2id password hashes; server-side sessions (random 256-bit token, stored hashed) in an
  `HttpOnly`, `SameSite=Lax` cookie (`Secure` when `COOKIE_SECURE=true`); idle and absolute expiry; revocation on
  password change/reset; account lockout and rate limiting on login, registration and password reset.
* **CSRF:** double-submit token bound to the session (HMAC) required on every state-changing request.
* **Authorization & tenant isolation:** every user-owned row carries `user_id`; endpoints check ownership, and an
  ORM hook automatically restricts all queries in a request to the current user's rows. Admin-only endpoints are
  role-checked. Cross-tenant access returns 404.
* **Secrets:** AI API keys are encrypted at rest (Fernet; key derived from `APP_SECRET_KEY` or an auto-generated
  secret stored with mode 0600 in the data volume), never returned to the browser, and redacted from logs.
* **Uploads:** size limit, extension allow-list, magic-byte and DOCX structure validation, zip-bomb guard,
  random storage names, path-traversal protection.
* **Outbound requests (SSRF):** http/https only; private, loopback, link-local, metadata and reserved addresses are
  blocked on every redirect hop; response size and time limits; robots.txt respected for HTML pages.
  Private AI endpoints (e.g. Ollama) are allowed only for administrators / single-user installs.
* **Untrusted content & prompt injection:** job descriptions, web pages and documents are wrapped as delimited data
  in prompts, and all generated text is validated against the user's verified profile; violations are discarded.
* **Browser automation:** a fresh isolated Chromium context per run; navigation to private addresses blocked;
  stops at CAPTCHA, MFA or login walls.
* **HTTP hardening:** CSP, `X-Frame-Options`, `nosniff`, Referrer-Policy, Permissions-Policy, HSTS over HTTPS.
* **Infrastructure:** non-root containers; only the web port is published (to 127.0.0.1 by default); PostgreSQL and
  Redis are internal only.

## Operator responsibilities

Use a strong `POSTGRES_PASSWORD` (`make init-env`), serve remote installs over HTTPS only, keep backups encrypted
(they contain personal data and the app secret), and keep images updated.
