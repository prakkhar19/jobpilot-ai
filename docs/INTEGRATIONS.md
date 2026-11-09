# Integrations

## Job sources

| Kind | Identifier | How it works | Status checks |
|---|---|---|---|
| `greenhouse` | board token (`acme` from `boards.greenhouse.io/acme`) or URL | Public Job Board API `boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` | Job endpoint 404 → expired; jobs missing from the full listing are marked expired |
| `lever` | company slug, `eu:slug` for EU, or URL | Public Postings API `api.lever.co/v0/postings/{slug}?mode=json` | same |
| `ashby` | board name or URL | Public Posting API `api.ashbyhq.com/posting-api/job-board/{name}` | same; unlisted jobs ignored |
| `career_page` | careers page or posting URL | Reads schema.org `JobPosting` JSON-LD on the page, or follows up to 25 same-site job links that carry it. robots.txt is honoured; `validThrough` in the past ⇒ skipped | re-fetch |
| `demo` | `sandbox` | Fictional postings, only with `DEMO_MODE=true` | n/a |
| manual import | URL or pasted text | Greenhouse/Lever/Ashby/JSON-LD URLs are fetched; anything else is pasted by the user | none |

All fetches use the SSRF-safe client (public addresses only, size/time limits) with at least
`PER_HOST_MIN_INTERVAL_SECONDS` between requests to the same host. Results are filtered by the agent
configuration (roles, keywords, locations, work style, employment type, seniority, salary, companies, required
technologies, posting age) and de-duplicated across sources by company + title + location.

### Not supported (and why)

LinkedIn, Indeed, Glassdoor, Naukri, Wellfound, Instahyre and Foundit do not offer a public API that permits this
use, and their terms prohibit scraping. JobPilot does not automate them. Copy the posting into
*Discover Jobs → Import job → Paste text* — matching, tailoring and tracking then work as usual.

## Application providers

| Provider | Form inspection | Assisted pre-fill | Automated submission |
|---|---|---|---|
| Sandbox portal (`DEMO_MODE`) | ✅ | ✅ | ✅ (the only one) |
| Greenhouse | ✅ via public API `?questions=true` | ✅ Playwright fills text fields + uploads, then stops | ❌ you submit on the employer's site |
| Lever | ✅ parses the public apply page | ✅ same | ❌ |
| Anything else | — | — | — (documents prepared; you apply and click *Mark as submitted*) |

Why no automated submission to real employers? Most boards protect forms with CAPTCHA, terms vary per employer,
and a wrong answer on a real application can't be undone. JobPilot therefore stops before the final click; the
**Authorized automation** mode applies only to providers that declare `supports_submit` (currently the sandbox).

Field mapping uses, in order: your answer bank (answers you gave before), your profile (name, email, phone,
links, location), and your *application facts* (e.g. "Work authorization", "Notice period"). Required questions it
cannot answer from verified data are **never guessed** — the application moves to *Needs your input*.

Automation always runs in a fresh, isolated browser context, blocks navigation to private addresses, and stops when
it detects a CAPTCHA, MFA or login wall.

## AI providers

| Type | Notes |
|---|---|
| `openai_compatible` | `POST {base_url}/chat/completions` (+ `/embeddings` if an embedding model is set). Works with OpenAI, NVIDIA NIM (Nemotron), OpenRouter, Together, Groq, Ollama, vLLM, LM Studio… `response_format=json_object` is used when supported, with automatic fallback. |
| `anthropic` | Official Anthropic SDK (Messages API). Default model `claude-opus-5-5`. Server-side refusal fallback is enabled for models that support it. No embeddings — TF-IDF similarity is used instead. |

Per provider you can set model, base URL, timeout, max tokens, temperature (OpenAI-compatible only), default and
fallback roles, and prices per million tokens for cost estimates. Usage (requests, tokens, errors) is tracked.

**What the AI is used for:** optional resume-parsing assistance (every value must be found in your resume),
rephrasing summaries/bullets (fact-checked), cover letters (fact-checked, unverified sentences removed), match
explanations, and embeddings for similarity. With no provider, deterministic equivalents are used.
