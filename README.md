# JobPilot AI

**A self-hosted, open-source AI assistant for your job search** — discover relevant openings, see an
explainable match score, generate truthful tailored resumes and cover letters, prepare applications
for your approval, and track everything through to the offer.

Your data stays on your server. You bring your own AI provider (or none at all).

> JobPilot never invents experience. Every AI-generated sentence is fact-checked against the profile
> *you* approved; anything that adds skills, employers, numbers or credentials you don't have is rejected.

---

## What it does

| Stage | What happens |
|---|---|
| **Onboarding** | Upload a PDF/DOCX resume → structured profile is extracted (rule-based, optionally AI-assisted with a grounding check) → you review, edit and approve it. The original file is stored unchanged. |
| **Discovery** | Scheduled or on-demand search of Greenhouse, Lever and Ashby public job boards and company career pages with schema.org `JobPosting` data. Filters, de-duplication across sources, expiry checks. Postings from anywhere else (LinkedIn, Indeed, …) can be imported by pasting the text. |
| **Matching** | Weighted, configurable score from required/preferred skills, content similarity (TF-IDF or embeddings), experience, title alignment, education and location — every component explained. Missing profile data is shown as *unknown*, never as a gap. |
| **Resume Studio** | Per-job tailored resume: relevant skills first, bullets reordered, best projects selected, optional AI rephrasing with fact-checking. ATS-friendly DOCX + PDF, 4 templates, version history, side-by-side comparison with your original. |
| **Cover letters** | Concise letters from verified facts (template or AI + fact-check), editable, exportable. |
| **Applications** | Form fields are inspected and mapped to your verified data; unknown screening questions stop the process and ask you. **Review**, **Assisted** (pre-fill, you submit) or **Authorized automation** modes. Never bypasses CAPTCHA/MFA/logins, never applies twice. |
| **Tracking & analytics** | Full status pipeline, interviews, notes, follow-ups, audit trail; response/interview rates by source, role, company and resume version; weekly reports. |
| **Agent** | Background pipeline (discover → analyse → match → generate → prepare) with schedules, daily limits, pause/resume/cancel, locks, retries and logs. |

### Supported integrations — honestly

| Integration | Status |
|---|---|
| Greenhouse public job boards | ✅ Discovery, status checks, form inspection, assisted pre-fill |
| Lever public postings | ✅ Discovery, status checks, form inspection, assisted pre-fill |
| Ashby public job boards | ✅ Discovery, status checks |
| Company career pages with schema.org `JobPosting` | ✅ Discovery (robots.txt respected) |
| Manual import (any site) | ✅ Paste URL/text |
| Sandbox employer portal (`DEMO_MODE`) | ✅ Full automated submission, for demos/tests only |
| LinkedIn, Indeed, Naukri, Wellfound, Instahyre, Foundit, Glassdoor | ❌ Not automated (no permitted API). Import postings manually. |
| Automated *submission* to real employers | ❌ Deliberately not supported — JobPilot pre-fills, you submit. See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md). |

AI providers: any **OpenAI-compatible** endpoint (OpenAI, NVIDIA NIM / Nemotron, OpenRouter, Ollama,
vLLM, LM Studio…) and **Anthropic Claude**. Everything also works with **no AI provider** configured.

---

## Quick start (Docker)

Requirements: Docker with Compose v2 (Docker Desktop, or Docker Engine on Linux). Nothing else —
no Python, Node, PostgreSQL, Redis or browsers on your machine.

```bash
git clone https://github.com/YOUR_USERNAME/jobpilot-ai.git
cd jobpilot-ai
cp .env.example .env          # or: make init-env   (generates random secrets)
docker compose up --build -d
```

Open **http://localhost:8080**, create your account (the first account becomes the administrator),
and follow the onboarding wizard.

First build takes a few minutes (the worker image includes a headless Chromium). Check status with
`docker compose ps` — all services should become `healthy`.

**Try it safely:** set `DEMO_MODE=true` in `.env` and restart (`docker compose up -d`). A clearly labelled
sandbox job board with fictional postings and a mock employer portal let you run the entire
workflow, including automated submission, without contacting any real employer.

### Configure an AI provider (optional)

*Integrations → AI providers → Add*. Examples:

| Provider | Base URL | Model |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | e.g. `gpt-4o-mini` |
| NVIDIA NIM (Nemotron) | `https://integrate.api.nvidia.com/v1` | e.g. `nvidia/llama-3.3-nemotron-super-49b-v1` |
| Ollama on your machine | `http://host.docker.internal:11434/v1` | e.g. `llama3.1` |
| Anthropic | *(leave empty)* | `claude-opus-5-5` |

Keys are encrypted at rest and never sent to the browser. Use **Test** to verify connectivity.

### Everyday commands

```bash
make up              # build + start
make down            # stop (data is kept)
make logs            # follow logs
make backup          # database + files → ./backups/
make restore DIR=backups/jobpilot-<timestamp>
make reset-password EMAIL=you@example.com   # prints a reset link (when SMTP isn't configured)
```

---

## Remote access

Docker on a laptop is **not** reachable from the internet, and it shouldn't be over plain HTTP.
To use JobPilot from anywhere, run it on a VPS/server behind an HTTPS reverse proxy (e.g. Caddy) and
set `COOKIE_SECURE=true`, `PUBLIC_BASE_URL=https://your-domain`. PostgreSQL, Redis and the browser
automation are never exposed. Step-by-step: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Documentation

| | |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | Components, request flow, tenant isolation, agent pipeline |
| [Database](docs/DATABASE.md) | Tables, ownership and deletion behaviour |
| [API](docs/API.md) | REST API overview (OpenAPI at `/api/docs` in development) |
| [Integrations](docs/INTEGRATIONS.md) | Job sources, application providers, AI providers, what is unsupported and why |
| [Deployment](docs/DEPLOYMENT.md) | VPS + HTTPS, upgrades, hardening |
| [Backup & restore](docs/BACKUP_RESTORE.md) | Backups, restores, safe reset |
| [Environment variables](docs/ENVIRONMENT.md) | Every configuration option |
| [Development](docs/DEVELOPMENT.md) | Local setup, tests, adding integrations |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Common problems |
| [Known limitations](docs/LIMITATIONS.md) | What it doesn't do (yet) |
| [Release checklist](docs/RELEASE_CHECKLIST.md) | For maintainers |
| [Implementation plan](docs/IMPLEMENTATION_PLAN.md) | Build checklist and verification status |

## Responsible use

* Apply only to jobs you actually want; JobPilot favours relevance over volume and enforces daily limits.
* Review every application. Authorized automation exists only for providers that permit it and only after
  you explicitly enable it.
* Respect each site's terms of service. JobPilot uses public APIs, honours robots.txt for HTML pages,
  rate-limits itself, and never bypasses CAPTCHAs, MFA, paywalls or logins.
* Match scores are guidance. **No score guarantees an interview or an offer.**

## Contributing & security

See [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
