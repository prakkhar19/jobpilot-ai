"""Greenhouse public Job Board API (https://developers.greenhouse.io/job-board.html) — no auth required."""

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

API = "https://boards-api.greenhouse.io/v1/boards"
_TOKEN_RE = re.compile(r"^[A-Za-z0-9_\-]{1,100}$")


def board_token(identifier: str) -> str:
    ident = identifier.strip().rstrip("/")
    m = re.search(r"greenhouse\.io/(?:embed/job_board\?for=)?([A-Za-z0-9_\-]+)", ident)
    if m and m.group(1) not in ("v1", "boards", "embed"):
        ident = m.group(1)
    if not _TOKEN_RE.match(ident):
        raise SourceError("Enter a Greenhouse board token, e.g. 'acme' from boards.greenhouse.io/acme")
    return ident.lower()


class GreenhouseAdapter(JobSourceAdapter):
    kind = "greenhouse"
    label = "Greenhouse job board"
    description = "Public Greenhouse Job Board API. Add a company's board token (boards.greenhouse.io/<token>)."
    identifier_help = "Board token, e.g. 'gitlab' or a boards.greenhouse.io URL"

    def validate_source_access(self, identifier: str) -> SourceCheck:
        token = board_token(identifier)
        res = self.get(f"{API}/{token}")
        if res.status_code == 404:
            return SourceCheck(False, f"No Greenhouse board named '{token}'.")
        if res.status_code != 200:
            return SourceCheck(False, f"Greenhouse returned HTTP {res.status_code}.")
        name = res.json().get("name") or token
        jobs = self.get(f"{API}/{token}/jobs")
        count = len(jobs.json().get("jobs", [])) if jobs.status_code == 200 else None
        return SourceCheck(True, "Board found.", display_name=name, job_count=count)

    def discover_jobs(self, identifier: str, criteria: SearchCriteria) -> list[NormalizedJob]:
        token = board_token(identifier)
        res = self.get(f"{API}/{token}/jobs", params={"content": "true"})
        if res.status_code == 404:
            raise SourceError(f"Greenhouse board '{token}' not found.")
        if res.status_code != 200:
            raise SourceError(f"Greenhouse returned HTTP {res.status_code}.")
        company = token
        meta = self.get(f"{API}/{token}")
        if meta.status_code == 200:
            company = meta.json().get("name") or token
        return [self.normalize_job(j | {"_company": company}, token) for j in res.json().get("jobs", [])]

    def fetch_job_details(self, identifier: str, external_id: str) -> NormalizedJob | None:
        token = board_token(identifier)
        job_id = external_id.split(":")[-1]
        if not job_id.isdigit():
            raise SourceError("Invalid Greenhouse job id")
        res = self.get(f"{API}/{token}/jobs/{job_id}")
        if res.status_code == 404:
            return None
        if res.status_code != 200:
            raise SourceError(f"Greenhouse returned HTTP {res.status_code}.")
        return self.normalize_job(res.json(), token)

    def normalize_job(self, raw: dict, identifier: str) -> NormalizedJob:
        location = (raw.get("location") or {}).get("name", "")
        description = html_to_text(raw.get("content") or "")
        depts = ", ".join(d.get("name", "") for d in raw.get("departments") or [] if d.get("name"))
        url = raw.get("absolute_url") or f"https://job-boards.greenhouse.io/{identifier}/jobs/{raw.get('id')}"
        employment = ""
        for md in raw.get("metadata") or []:
            if isinstance(md, dict) and "employment" in str(md.get("name", "")).lower():
                employment = str(md.get("value") or "")
        return NormalizedJob(
            source_kind=self.kind,
            external_id=f"{identifier}:{raw.get('id')}",
            company=raw.get("_company") or raw.get("company_name") or identifier,
            title=(raw.get("title") or "").strip(),
            location=location,
            workplace_type=infer_workplace(location, raw.get("title", "")),
            employment_type=employment,
            department=depts,
            description_text=description,
            posted_at=parse_dt(raw.get("first_published") or raw.get("updated_at")),
            application_url=url,
            posting_url=url,
        )
