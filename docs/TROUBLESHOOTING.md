# Troubleshooting

| Symptom | Fix |
|---|---|
| `POSTGRES_PASSWORD` error on `docker compose up` | Create `.env` (`cp .env.example .env`). |
| Page doesn't load at http://localhost:8080 | `docker compose ps` — wait until services are `healthy`; `docker compose logs backend frontend`. Port in use? change `JOBPILOT_PORT`. |
| Can't reach it from another device | By design it's bound to 127.0.0.1. See [DEPLOYMENT.md](DEPLOYMENT.md) for secure remote access. |
| Discovery does nothing | Add a source (*Integrations → Job sources*) and check *Agent Activity* logs. Strict filters (target roles, locations) may filter everything out — the log shows examples of filtered postings. |
| "Agent is already running" | A run is in progress; cancel it from *Agent Activity*. Stuck runs are failed automatically after 20 minutes without a heartbeat. |
| Worker/scheduler "stale" on the diagnostics page | `docker compose logs worker scheduler`; `docker compose restart worker scheduler`. |
| AI provider test fails | Check base URL (must include `/v1` for OpenAI-compatible), model name and key. For Ollama use `http://host.docker.internal:11434/v1`; private endpoints require an admin account or single-user mode. |
| "Stored secret could not be decrypted" | `APP_SECRET_KEY` changed (or the data volume was replaced). Re-enter API keys. |
| Resume parsed poorly | Scanned PDFs have no text — upload a text PDF or DOCX. Edit the profile manually; enable an AI provider and re-upload with "use AI" for better extraction. |
| Application stuck in "Needs your input" | Answer the listed questions on the application page; answers are saved for reuse. |
| Submission says CAPTCHA/login required | Expected: JobPilot never bypasses these. Open the application page and submit yourself, then *Mark as submitted*. |
| Forgot password, no SMTP | `make reset-password EMAIL=you@example.com` prints a one-hour link. |
| Disk usage grows | Generated documents and screenshots live in the `appdata` volume; delete old resume versions in Resume Studio. Agent logs are pruned after `DATA_RETENTION_DAYS_LOGS`. |
