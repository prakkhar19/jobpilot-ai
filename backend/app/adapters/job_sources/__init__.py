from app.adapters.job_sources.ashby import AshbyAdapter
from app.adapters.job_sources.base import (
    JobSourceAdapter,
    NormalizedJob,
    SearchCriteria,
    SourceCheck,
    SourceError,
)
from app.adapters.job_sources.career_page import CareerPageAdapter
from app.adapters.job_sources.demo import DemoAdapter
from app.adapters.job_sources.directory import DirectoryAdapter
from app.adapters.job_sources.email_alerts import EmailAlertsAdapter
from app.adapters.job_sources.greenhouse import GreenhouseAdapter
from app.adapters.job_sources.lever import LeverAdapter
from app.adapters.job_sources.search_apis import AdzunaAdapter, ArbeitnowAdapter, RemotiveAdapter

ADAPTERS: dict[str, type[JobSourceAdapter]] = {
    a.kind: a for a in (DirectoryAdapter, AdzunaAdapter, EmailAlertsAdapter, RemotiveAdapter, ArbeitnowAdapter, GreenhouseAdapter,
                         LeverAdapter, AshbyAdapter, CareerPageAdapter, DemoAdapter)
}

# Platforms whose websites are not automated (their terms forbid bots, and accounts get banned).
# Their jobs still arrive automatically through the "email_alerts" source.
_VIA_EMAIL = "Its website can't be automated, but its job-alert emails are imported automatically by the Job-alert emails source."
UNSUPPORTED_PLATFORMS = {
    "linkedin": "LinkedIn forbids bots and restricts accounts that use them. " + _VIA_EMAIL,
    "naukri": "Naukri forbids automated access. " + _VIA_EMAIL,
    "indeed": "Indeed forbids scraping. " + _VIA_EMAIL,
    "wellfound": "Wellfound has no public API. " + _VIA_EMAIL,
    "instahyre": "Instahyre has no public API. " + _VIA_EMAIL,
    "foundit": "Foundit has no public API. " + _VIA_EMAIL,
    "glassdoor": "Glassdoor forbids scraping. " + _VIA_EMAIL,
}


def get_adapter(kind: str, credentials: dict[str, str] | None = None) -> JobSourceAdapter:
    if kind not in ADAPTERS:
        raise SourceError(f"Unsupported source type '{kind}'")
    return ADAPTERS[kind](credentials=credentials)


__all__ = ["ADAPTERS", "UNSUPPORTED_PLATFORMS", "JobSourceAdapter", "NormalizedJob", "SearchCriteria",
           "SourceCheck", "SourceError", "get_adapter"]
