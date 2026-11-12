"""Common interface for job sources."""

from __future__ import annotations

import html
import re
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import UTC, datetime
from urllib import robotparser
from urllib.parse import urlsplit

from bs4 import BeautifulSoup

from app.core.config import get_settings
from app.security.ssrf import FetchResult, SafeHttpClient, UnsafeURLError


class SourceError(Exception):
    pass


@dataclass
class NormalizedJob:
    source_kind: str
    external_id: str
    company: str
    title: str
    location: str = ""
    workplace_type: str = "unknown"  # remote | hybrid | onsite | unknown
    employment_type: str = ""
    department: str = ""
    description_text: str = ""
    salary_min: float | None = None
    salary_max: float | None = None
    salary_currency: str = ""
    salary_text: str = ""
    posted_at: datetime | None = None
    application_url: str = ""
    posting_url: str = ""
    is_demo: bool = False
    expires_at: datetime | None = None


@dataclass
class SearchCriteria:
    keywords: list[str] = field(default_factory=list)
    target_roles: list[str] = field(default_factory=list)
    excluded_keywords: list[str] = field(default_factory=list)
    locations: list[str] = field(default_factory=list)
    countries: list[str] = field(default_factory=list)
    workplace_types: list[str] = field(default_factory=list)
    employment_types: list[str] = field(default_factory=list)
    experience_levels: list[str] = field(default_factory=list)
    salary_min: float | None = None
    include_companies: list[str] = field(default_factory=list)
    exclude_companies: list[str] = field(default_factory=list)
    industries: list[str] = field(default_factory=list)
    required_technologies: list[str] = field(default_factory=list)
    posted_within_days: int | None = None
    limit: int = 200


@dataclass
class SourceCheck:
    ok: bool
    message: str
    display_name: str = ""
    job_count: int | None = None


class JobSourceAdapter(ABC):
    kind: str = ""
    label: str = ""
    description: str = ""
    identifier_help: str = ""
    # Whether the listing is complete (so jobs missing from it can be marked expired).
    complete_listing: bool = True
    # Minimum minutes between automatic checks of one source (respects each provider's usage rules).
    min_interval_minutes: int = 15
    # When True the interval also applies to manual runs (the provider's usage rules require it).
    strict_interval: bool = False
    # Credentials the user must supply, e.g. [{"key": "app_id", "label": "App ID", "secret": False}].
    credential_fields: list[dict] = []
    identifier_default: str = ""
    attribution: str = ""

    def __init__(self, client: SafeHttpClient | None = None, credentials: dict[str, str] | None = None) -> None:
        self._client = client
        self.credentials = credentials or {}

    @property
    def client(self) -> SafeHttpClient:
        if self._client is None:
            self._client = SafeHttpClient()
        return self._client

    def get(self, url: str, **kw) -> FetchResult:  # noqa: ANN003
        try:
            res = self.client.get(url, **kw)
        except UnsafeURLError as exc:
            raise SourceError(f"URL not allowed: {exc}") from exc
        except Exception as exc:  # noqa: BLE001 - network failures become source errors
            raise SourceError(f"Could not reach {urlsplit(url).hostname}: {type(exc).__name__}") from exc
        if res.status_code == 429:
            raise SourceError("The source is rate limiting requests. Try again later.")
        return res

    @abstractmethod
    def validate_source_access(self, identifier: str) -> SourceCheck: ...

    @abstractmethod
    def discover_jobs(self, identifier: str, criteria: SearchCriteria) -> list[NormalizedJob]: ...

    @abstractmethod
    def fetch_job_details(self, identifier: str, external_id: str) -> NormalizedJob | None: ...

    @abstractmethod
    def normalize_job(self, raw: dict, identifier: str) -> NormalizedJob: ...

    def check_job_status(self, identifier: str, external_id: str) -> str:
        """Return 'active', 'expired' or 'unknown'."""
        try:
            return "active" if self.fetch_job_details(identifier, external_id) is not None else "expired"
        except SourceError:
            return "unknown"


# ---------------------------------------------------------------------------------- helpers

def html_to_text(raw: str) -> str:
    if not raw:
        return ""
    if "&lt;" in raw and "<" not in raw:
        raw = html.unescape(raw)
    soup = BeautifulSoup(raw, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    for li in soup.find_all("li"):
        li.insert_before("\n• ")
    for br in soup.find_all("br"):
        br.replace_with("\n")
    for block in soup.find_all(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "tr", "section"]):
        block.insert_before("\n")
        block.insert_after("\n")
    text = soup.get_text()
    text = re.sub(r"[ \t ]+", " ", text)
    text = re.sub(r"\n\s*\n\s*(\n\s*)+", "\n\n", text)
    lines = [ln.strip() for ln in text.split("\n")]
    return "\n".join(lines).strip()[:60000]


def infer_workplace(*texts: str, is_remote: bool | None = None) -> str:
    joined = " ".join(t for t in texts if t).lower()
    if "hybrid" in joined:
        return "hybrid"
    if is_remote or re.search(r"\bremote\b|work from home|anywhere", joined):
        return "remote"
    if re.search(r"\bon[- ]?site\b|in[- ]office|onsite", joined):
        return "onsite"
    return "unknown"


def parse_dt(value: object) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, int | float):
        ts = value / 1000 if value > 1e11 else value
        return datetime.fromtimestamp(ts, UTC)
    try:
        from dateutil import parser as dparser

        dt = dparser.isoparse(str(value))
        return dt if dt.tzinfo else dt.replace(tzinfo=UTC)
    except (ValueError, OverflowError):
        return None


_robots_cache: dict[str, tuple[float, robotparser.RobotFileParser | None]] = {}


def robots_allows(client: SafeHttpClient, url: str) -> bool:
    """Honour robots.txt for HTML scraping (not used for official public JSON APIs)."""
    parts = urlsplit(url)
    base = f"{parts.scheme}://{parts.netloc}"
    cached = _robots_cache.get(base)
    if cached is None or time.time() - cached[0] > 3600:
        rp: robotparser.RobotFileParser | None = robotparser.RobotFileParser()
        try:
            res = client.get(f"{base}/robots.txt")
            if res.status_code in (401, 403):
                rp.disallow_all = True  # type: ignore[union-attr]
            elif res.status_code >= 400:
                rp = None  # no robots.txt => allowed
            else:
                rp.parse(res.text.splitlines())  # type: ignore[union-attr]
        except Exception:  # noqa: BLE001
            rp = None
        _robots_cache[base] = (time.time(), rp)
        cached = _robots_cache[base]
    rp = cached[1]
    if rp is None:
        return True
    return rp.can_fetch(get_settings().outbound_user_agent.split("/")[0], url)
