# Known limitations

* **No automated submission to real employers.** Greenhouse and Lever forms can be inspected and pre-filled for
  review; you click submit. Only the sandbox portal supports end-to-end automated submission.
* **Platforms without permitted APIs** (LinkedIn, Indeed, Naukri, Wellfound, Instahyre, Foundit, Glassdoor) are not
  automated; postings must be imported by pasting text.
* **Career pages** are supported only when they publish schema.org `JobPosting` data.
* **Resume parsing** is heuristic without an AI provider; complex multi-column layouts, tables and scanned PDFs
  (no OCR) parse poorly. Review is always required before approval.
* **Fact checking** is conservative and rule-based (skills taxonomy, numbers, credentials, proper nouns). It may
  reject harmless rephrasings (the original text is kept) and cannot catch every subtle overstatement — always
  review generated documents.
* **Skill taxonomy** covers ~160 common technologies and concepts (with aliases); unknown skills still match by exact name but are not
  recognised inside free text.
* **Embeddings** are used only with an OpenAI-compatible provider that has an embedding model; otherwise TF-IDF.
* **Email-based status updates** are not implemented; statuses are updated manually.
* **Notifications** are in-app only (email is used only for password resets).
* **Timezone** for schedules is per user; the weekly report runs Mondays 08:00 UTC.
* **Encryption at rest** covers stored API keys; resumes and the database rely on disk/volume encryption you configure.
* **Single region / single node**: no built-in HA; scale vertically or run multiple workers against the same Redis.
* **SSRF protection** resolves and validates hostnames before connecting and on every redirect, but a hostile DNS
  server could in theory change the answer between validation and connection (DNS rebinding). Outbound requests
  only go to job-board APIs, career pages and AI endpoints you configure; run behind an egress firewall if your
  threat model requires it.
* **Account lockout** (15 minutes after 8 failed logins) could be triggered by someone who knows your email; the
  per-IP and per-email rate limits reduce this, and an admin can always issue a reset link.
