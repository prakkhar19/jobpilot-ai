"""Built-in company directory: checks every verified Greenhouse/Lever/Ashby board in one source."""

from __future__ import annotations

import logging

from app.adapters.job_sources.ashby import AshbyAdapter
from app.adapters.job_sources.base import (
    JobSourceAdapter,
    NormalizedJob,
    SearchCriteria,
    SourceCheck,
    SourceError,
)
from app.adapters.job_sources.greenhouse import GreenhouseAdapter
from app.adapters.job_sources.lever import LeverAdapter
from app.data.company_directory import COMPANY_BOARDS

log = logging.getLogger(__name__)
_PLATFORMS: dict[str, type[JobSourceAdapter]] = {"greenhouse": GreenhouseAdapter, "lever": LeverAdapter,
                                                   "ashby": AshbyAdapter}


class DirectoryAdapter(JobSourceAdapter):
    kind = "directory"
    label = f"Company directory ({len(COMPANY_BOARDS)} companies)"
    description = (f"Checks the job boards of {len(COMPANY_BOARDS)} built-in tech companies (Greenhouse, Lever, "
                   "Ashby) for roles matching your target roles — no links needed.")
    identifier_help = "Use 'all'"
    identifier_default = "all"
    complete_listing = False  # a board that fails to load must not expire its jobs
    min_interval_minutes = 30

    def validate_source_access(self, identifier: str) -> SourceCheck:
        return SourceCheck(True, "Built-in directory.", display_name=self.label, job_count=None)

    def discover_jobs(self, identifier: str, criteria: SearchCriteria) -> list[NormalizedJob]:
        out: list[NormalizedJob] = []
        failures = 0
        for platform, board in COMPANY_BOARDS:
            adapter = _PLATFORMS[platform](self.client)
            try:
                out.extend(adapter.discover_jobs(board, criteria))
            except SourceError as exc:
                failures += 1
                log.info("Directory board failed", extra={"ctx": {"board": f"{platform}:{board}", "error": str(exc)}})
        if failures == len(COMPANY_BOARDS):
            raise SourceError("No company boards could be reached.")
        return out

    def fetch_job_details(self, identifier: str, external_id: str) -> NormalizedJob | None:
        return None

    def normalize_job(self, raw: dict, identifier: str) -> NormalizedJob:
        raise NotImplementedError

    def check_job_status(self, identifier: str, external_id: str) -> str:
        return "unknown"
