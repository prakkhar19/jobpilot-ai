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
from app.adapters.job_sources.greenhouse import GreenhouseAdapter
from app.adapters.job_sources.lever import LeverAdapter

ADAPTERS: dict[str, type[JobSourceAdapter]] = {
    a.kind: a for a in (GreenhouseAdapter, LeverAdapter, AshbyAdapter, CareerPageAdapter, DemoAdapter)
}

# Platforms that are NOT automated. Users can still import individual postings by pasting the text/URL.
UNSUPPORTED_PLATFORMS = {
    "linkedin": "LinkedIn prohibits automated scraping; there is no public jobs API. Import postings manually.",
    "indeed": "Indeed's terms prohibit scraping and its publisher API is closed to new users. Import manually.",
    "naukri": "No public API; automated access is not permitted. Import postings manually.",
    "wellfound": "No public API; automated access is not permitted. Import postings manually.",
    "instahyre": "No public API; automated access is not permitted. Import postings manually.",
    "foundit": "No public API; automated access is not permitted. Import postings manually.",
    "glassdoor": "No public API; automated access is not permitted. Import postings manually.",
}


def get_adapter(kind: str) -> JobSourceAdapter:
    if kind not in ADAPTERS:
        raise SourceError(f"Unsupported source type '{kind}'")
    return ADAPTERS[kind]()


__all__ = ["ADAPTERS", "UNSUPPORTED_PLATFORMS", "JobSourceAdapter", "NormalizedJob", "SearchCriteria",
           "SourceCheck", "SourceError", "get_adapter"]
