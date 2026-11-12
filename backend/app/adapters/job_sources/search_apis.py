"""Keyword search APIs: they search across many employers by role and location, so the user does not need
to add individual companies."""

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


def _queries(criteria: SearchCriteria, cap: int = 5) -> list[str]:
    q = [r for r in criteria.target_roles if r.strip()] or [k for k in criteria.keywords if k.strip()]
    return q[:cap]


class AdzunaAdapter(JobSourceAdapter):
    """Adzuna Jobs API (https://developer.adzuna.com). Aggregates listings from thousands of job sites.
    Free API key required; Adzuna's terms permit personal job search use."""

    kind = "adzuna"
    label = "Adzuna (search thousands of job sites)"
    description = ("Searches Adzuna, which aggregates listings from thousands of job sites, by your target roles and "
                   "locations. Needs a free API key from developer.adzuna.com. Listings are provided by Adzuna.")
    identifier_help = "Two-letter country code, e.g. in, gb, us, de, ca, au, sg"
    identifier_default = "in"
    credential_fields = [{"key": "app_id", "label": "Adzuna App ID", "secret": False},
                         {"key": "app_key", "label": "Adzuna App Key", "secret": True}]
    complete_listing = False
    min_interval_minutes = 30
    attribution = "Jobs by Adzuna"
    strict_interval = True

    def _country(self, identifier: str) -> str:
        c = identifier.strip().lower()
        if not re.fullmatch(r"[a-z]{2}", c):
            raise SourceError("Enter a two-letter country code, e.g. 'in' or 'gb'.")
        return c

    def _auth(self) -> dict[str, str]:
        app_id, app_key = self.credentials.get("app_id", ""), self.credentials.get("app_key", "")
        if not app_id or not app_key:
            raise SourceError("Adzuna needs an App ID and App Key (free at developer.adzuna.com).")
        return {"app_id": app_id, "app_key": app_key}

    def _search(self, country: str, params: dict) -> list[dict]:
        res = self.get(f"https://api.adzuna.com/v1/api/jobs/{country}/search/1",
                       params=self._auth() | {"content-type": "application/json"} | params)
        if res.status_code in (401, 403):
            raise SourceError("Adzuna rejected the API credentials.")
        if res.status_code == 404:
            raise SourceError(f"Adzuna does not support country '{country}'.")
        if res.status_code != 200:
            raise SourceError(f"Adzuna returned HTTP {res.status_code}.")
        return res.json().get("results", [])

    def validate_source_access(self, identifier: str) -> SourceCheck:
        try:
            country = self._country(identifier)
            results = self._search(country, {"results_per_page": 1, "what": "engineer"})
        except SourceError as exc:
            return SourceCheck(False, str(exc))
        return SourceCheck(True, "Adzuna connected.", display_name=f"Adzuna ({country.upper()})",
                           job_count=len(results))

    def discover_jobs(self, identifier: str, criteria: SearchCriteria) -> list[NormalizedJob]:
        country = self._country(identifier)
        queries = _queries(criteria)
        if not queries:
            raise SourceError("Set target roles in Settings so Adzuna knows what to search for.")
        wheres = [w for w in criteria.locations if w.strip() and w.lower() != "remote"][:3] or [""]
        seen: dict[str, NormalizedJob] = {}
        for what in queries:
            for where in wheres:
                params = {"what": what, "results_per_page": 50, "sort_by": "date"}
                if where:
                    params["where"] = where
                for raw in self._search(country, params):
                    job = self.normalize_job(raw, country)
                    seen.setdefault(job.external_id, job)
        return list(seen.values())

    def fetch_job_details(self, identifier: str, external_id: str) -> NormalizedJob | None:
        return None  # Adzuna has no stable per-job endpoint in its documented API

    def check_job_status(self, identifier: str, external_id: str) -> str:
        return "unknown"

    def normalize_job(self, raw: dict, identifier: str) -> NormalizedJob:
        loc = (raw.get("location") or {}).get("display_name", "")
        desc = html_to_text(raw.get("description") or "")
        return NormalizedJob(
            source_kind=self.kind, external_id=f"{identifier}:{raw.get('id')}",
            company=(raw.get("company") or {}).get("display_name", "") or "Unknown company",
            title=html_to_text(raw.get("title") or ""), location=loc,
            workplace_type=infer_workplace(loc, raw.get("title", ""), desc),
            employment_type=" ".join(x for x in (raw.get("contract_time"), raw.get("contract_type")) if x).replace("_", "-"),
            description_text=desc + "\n\n(Snippet provided by Adzuna — open the posting for the full description.)",
            salary_min=raw.get("salary_min"), salary_max=raw.get("salary_max"),
            salary_text="Estimated by Adzuna" if str(raw.get("salary_is_predicted")) == "1" else "",
            posted_at=parse_dt(raw.get("created")),
            application_url=raw.get("redirect_url", ""), posting_url=raw.get("redirect_url", ""),
        )


class RemotiveAdapter(JobSourceAdapter):
    """Remotive public API (remote jobs). Rules: at most 4 requests/day, credit Remotive and link back."""

    kind = "remotive"
    label = "Remotive (remote jobs)"
    description = ("Remote jobs worldwide from Remotive's public API. Checked at most 4 times a day as Remotive "
                   "requests; listings are delayed 24 hours by Remotive. Jobs link back to Remotive.")
    identifier_help = "Use 'remote'"
    identifier_default = "remote"
    complete_listing = False
    min_interval_minutes = 360
    attribution = "Jobs by Remotive"
    strict_interval = True

    def validate_source_access(self, identifier: str) -> SourceCheck:
        res = self.get("https://remotive.com/api/remote-jobs", params={"limit": 1})
        if res.status_code != 200:
            return SourceCheck(False, f"Remotive returned HTTP {res.status_code}.")
        return SourceCheck(True, "Remotive reachable.", display_name="Remotive (remote jobs)")

    def discover_jobs(self, identifier: str, criteria: SearchCriteria) -> list[NormalizedJob]:
        # One request per run (all jobs) keeps us far below Remotive's "2 per minute" block threshold.
        res = self.get("https://remotive.com/api/remote-jobs")
        if res.status_code != 200:
            raise SourceError(f"Remotive returned HTTP {res.status_code}.")
        return [self.normalize_job(j, identifier) for j in res.json().get("jobs", [])]

    def fetch_job_details(self, identifier: str, external_id: str) -> NormalizedJob | None:
        return None

    def check_job_status(self, identifier: str, external_id: str) -> str:
        return "unknown"

    def normalize_job(self, raw: dict, identifier: str) -> NormalizedJob:
        region = raw.get("candidate_required_location") or "Worldwide"
        return NormalizedJob(
            source_kind=self.kind, external_id=str(raw.get("id")), company=raw.get("company_name") or "",
            title=(raw.get("title") or "").strip(), location=f"Remote ({region})", workplace_type="remote",
            employment_type=(raw.get("job_type") or "").replace("_", "-"),
            description_text=html_to_text(raw.get("description") or "") + "\n\nSource: Remotive (remotive.com)",
            salary_text=raw.get("salary") or "", posted_at=parse_dt(raw.get("publication_date")),
            application_url=raw.get("url", ""), posting_url=raw.get("url", ""),
        )


class ArbeitnowAdapter(JobSourceAdapter):
    """Arbeitnow free public job board API (mostly Europe; updated hourly)."""

    kind = "arbeitnow"
    label = "Arbeitnow (Europe, incl. visa sponsorship)"
    description = "Free public API with the newest jobs, mostly in Germany/Europe. Checked at most hourly."
    identifier_help = "Use 'europe'"
    identifier_default = "europe"
    complete_listing = False
    min_interval_minutes = 60
    attribution = "Jobs by Arbeitnow"
    strict_interval = True

    def validate_source_access(self, identifier: str) -> SourceCheck:
        res = self.get("https://www.arbeitnow.com/api/job-board-api")
        if res.status_code != 200:
            return SourceCheck(False, f"Arbeitnow returned HTTP {res.status_code}.")
        return SourceCheck(True, "Arbeitnow reachable.", display_name="Arbeitnow (Europe)",
                           job_count=len(res.json().get("data", [])))

    def discover_jobs(self, identifier: str, criteria: SearchCriteria) -> list[NormalizedJob]:
        out: list[NormalizedJob] = []
        for page in (1, 2):
            res = self.get("https://www.arbeitnow.com/api/job-board-api", params={"page": page})
            if res.status_code != 200:
                if page == 1:
                    raise SourceError(f"Arbeitnow returned HTTP {res.status_code}.")
                break
            out += [self.normalize_job(j, identifier) for j in res.json().get("data", [])]
        return out

    def fetch_job_details(self, identifier: str, external_id: str) -> NormalizedJob | None:
        return None

    def check_job_status(self, identifier: str, external_id: str) -> str:
        return "unknown"

    def normalize_job(self, raw: dict, identifier: str) -> NormalizedJob:
        remote = str(raw.get("remote")).lower() == "true"
        loc = raw.get("location") or ""
        return NormalizedJob(
            source_kind=self.kind, external_id=str(raw.get("slug")), company=raw.get("company_name") or "",
            title=(raw.get("title") or "").strip(), location=loc or ("Remote" if remote else ""),
            workplace_type="remote" if remote else infer_workplace(loc),
            employment_type=", ".join(raw.get("job_types") or []),
            description_text=html_to_text(raw.get("description") or ""),
            posted_at=parse_dt(raw.get("created_at")), application_url=raw.get("url", ""),
            posting_url=raw.get("url", ""),
        )
