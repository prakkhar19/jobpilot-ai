"""Ashby public Job Posting API (https://developers.ashbyhq.com/docs/public-job-posting-api) — no auth required."""

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

API = "https://api.ashbyhq.com/posting-api/job-board"
_NAME_RE = re.compile(r"^[A-Za-z0-9_\-.%]{1,100}$")


def board_name(identifier: str) -> str:
    ident = identifier.strip().rstrip("/")
    m = re.search(r"jobs\.ashbyhq\.com/([A-Za-z0-9_\-.%]+)", ident)
    if m:
        ident = m.group(1)
    if not _NAME_RE.match(ident):
        raise SourceError("Enter an Ashby job board name, e.g. 'acme' from jobs.ashbyhq.com/acme")
    return ident


class AshbyAdapter(JobSourceAdapter):
    kind = "ashby"
    label = "Ashby job board"
    description = "Public Ashby Job Posting API. Add a board name (jobs.ashbyhq.com/<name>)."
    identifier_help = "Board name, e.g. 'acme' or a jobs.ashbyhq.com URL"

    def _fetch(self, name: str) -> dict:
        res = self.get(f"{API}/{name}", params={"includeCompensation": "true"})
        if res.status_code == 404:
            raise SourceError(f"Ashby board '{name}' not found.")
        if res.status_code != 200:
            raise SourceError(f"Ashby returned HTTP {res.status_code}.")
        return res.json()

    def validate_source_access(self, identifier: str) -> SourceCheck:
        name = board_name(identifier)
        try:
            data = self._fetch(name)
        except SourceError as exc:
            return SourceCheck(False, str(exc))
        return SourceCheck(True, "Board found.", display_name=name, job_count=len(data.get("jobs", [])))

    def discover_jobs(self, identifier: str, criteria: SearchCriteria) -> list[NormalizedJob]:
        name = board_name(identifier)
        data = self._fetch(name)
        return [self.normalize_job(j, name) for j in data.get("jobs", []) if j.get("isListed", True)]

    def fetch_job_details(self, identifier: str, external_id: str) -> NormalizedJob | None:
        name = board_name(identifier)
        pid = external_id.split(":")[-1]
        for j in self._fetch(name).get("jobs", []):
            if str(j.get("id")) == pid and j.get("isListed", True):
                return self.normalize_job(j, name)
        return None

    def normalize_job(self, raw: dict, identifier: str) -> NormalizedJob:
        comp = raw.get("compensation") or {}
        location = raw.get("location") or ""
        secondary = [s.get("location", "") for s in raw.get("secondaryLocations") or [] if isinstance(s, dict)]
        if secondary:
            location = ", ".join([location, *secondary])
        wp = (raw.get("workplaceType") or "").lower().replace("-", "")
        workplace = {"remote": "remote", "hybrid": "hybrid", "onsite": "onsite"}.get(wp) or infer_workplace(
            location, is_remote=raw.get("isRemote")
        )
        smin = smax = None
        currency = ""
        for comp_tier in comp.get("summaryComponents") or []:
            if comp_tier.get("compensationType") == "Salary":
                smin, smax = comp_tier.get("minValue"), comp_tier.get("maxValue")
                currency = comp_tier.get("currencyCode") or ""
        return NormalizedJob(
            source_kind=self.kind,
            external_id=f"{identifier}:{raw.get('id')}",
            company=identifier.replace("-", " ").title(),
            title=(raw.get("title") or "").strip(),
            location=location,
            workplace_type=workplace,
            employment_type=raw.get("employmentType") or "",
            department=raw.get("department") or raw.get("team") or "",
            description_text=raw.get("descriptionPlain") or html_to_text(raw.get("descriptionHtml") or ""),
            salary_min=smin,
            salary_max=smax,
            salary_currency=currency,
            salary_text=comp.get("compensationTierSummary") or "",
            posted_at=parse_dt(raw.get("publishedAt")),
            application_url=raw.get("applyUrl") or raw.get("jobUrl") or "",
            posting_url=raw.get("jobUrl") or "",
        )
