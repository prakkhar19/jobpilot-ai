"""Lever public Postings API (https://github.com/lever/postings-api) — no auth required."""

from __future__ import annotations

import re

from app.adapters.job_sources.base import (
    JobSourceAdapter,
    NormalizedJob,
    SearchCriteria,
    SourceCheck,
    SourceError,
    html_to_text,
    infer_workplace,
    parse_dt,
)

_SLUG_RE = re.compile(r"^[A-Za-z0-9_\-.]{1,100}$")


def parse_identifier(identifier: str) -> tuple[str, str]:
    """Return (api_base, company_slug). Prefix 'eu:' for Lever's EU instance."""
    ident = identifier.strip().rstrip("/")
    eu = ident.lower().startswith("eu:") or "jobs.eu.lever.co" in ident
    ident = ident[3:] if ident.lower().startswith("eu:") else ident
    m = re.search(r"jobs\.(?:eu\.)?lever\.co/([A-Za-z0-9_\-.]+)", ident)
    if m:
        ident = m.group(1)
    if not _SLUG_RE.match(ident):
        raise SourceError("Enter a Lever company slug, e.g. 'acme' from jobs.lever.co/acme")
    return ("https://api.eu.lever.co/v0/postings" if eu else "https://api.lever.co/v0/postings"), ident


class LeverAdapter(JobSourceAdapter):
    kind = "lever"
    label = "Lever job board"
    description = "Public Lever Postings API. Add a company slug (jobs.lever.co/<slug>); prefix 'eu:' for EU boards."
    identifier_help = "Company slug, e.g. 'acme', 'eu:acme', or a jobs.lever.co URL"

    def validate_source_access(self, identifier: str) -> SourceCheck:
        base, slug = parse_identifier(identifier)
        res = self.get(f"{base}/{slug}", params={"mode": "json", "limit": 1})
        if res.status_code == 404:
            return SourceCheck(False, f"No Lever board named '{slug}'.")
        if res.status_code != 200:
            return SourceCheck(False, f"Lever returned HTTP {res.status_code}.")
        return SourceCheck(True, "Board found.", display_name=slug)

    def discover_jobs(self, identifier: str, criteria: SearchCriteria) -> list[NormalizedJob]:
        base, slug = parse_identifier(identifier)
        res = self.get(f"{base}/{slug}", params={"mode": "json"})
        if res.status_code == 404:
            raise SourceError(f"Lever board '{slug}' not found.")
        if res.status_code != 200:
            raise SourceError(f"Lever returned HTTP {res.status_code}.")
        data = res.json()
        if not isinstance(data, list):
            raise SourceError("Unexpected Lever response.")
        return [self.normalize_job(p, slug) for p in data]

    def fetch_job_details(self, identifier: str, external_id: str) -> NormalizedJob | None:
        base, slug = parse_identifier(identifier)
        pid = external_id.split(":")[-1]
        if not re.fullmatch(r"[A-Za-z0-9\-]{8,64}", pid):
            raise SourceError("Invalid Lever posting id")
        res = self.get(f"{base}/{slug}/{pid}", params={"mode": "json"})
        if res.status_code == 404:
            return None
        if res.status_code != 200:
            raise SourceError(f"Lever returned HTTP {res.status_code}.")
        return self.normalize_job(res.json(), slug)

    def normalize_job(self, raw: dict, identifier: str) -> NormalizedJob:
        cats = raw.get("categories") or {}
        parts = [raw.get("descriptionPlain") or html_to_text(raw.get("description") or "")]
        for lst in raw.get("lists") or []:
            parts.append(f"\n{lst.get('text', '')}\n{html_to_text(lst.get('content') or '')}")
        if raw.get("additionalPlain"):
            parts.append(raw["additionalPlain"])
        sal = raw.get("salaryRange") or {}
        wp = (raw.get("workplaceType") or "").lower().replace("-", "")
        workplace = {"remote": "remote", "hybrid": "hybrid", "onsite": "onsite"}.get(wp) or infer_workplace(
            cats.get("location", ""), raw.get("text", "")
        )
        salary_text = ""
        if sal.get("min") or sal.get("max"):
            salary_text = f"{sal.get('currency', '')} {sal.get('min', '')}–{sal.get('max', '')} {sal.get('interval', '')}".strip()
        return NormalizedJob(
            source_kind=self.kind,
            external_id=f"{identifier}:{raw.get('id')}",
            company=identifier.replace("-", " ").title(),
            title=(raw.get("text") or "").strip(),
            location=cats.get("location") or ", ".join(cats.get("allLocations") or []),
            workplace_type=workplace,
            employment_type=cats.get("commitment") or "",
            department=cats.get("team") or cats.get("department") or "",
            description_text="\n".join(p for p in parts if p).strip(),
            salary_min=sal.get("min"),
            salary_max=sal.get("max"),
            salary_currency=sal.get("currency") or "",
            salary_text=salary_text,
            posted_at=parse_dt(raw.get("createdAt")),
            application_url=raw.get("applyUrl") or raw.get("hostedUrl") or "",
            posting_url=raw.get("hostedUrl") or "",
        )
