"""Company career pages that publish schema.org JobPosting structured data (JSON-LD).

Only pages permitted by robots.txt are fetched. Pages without JobPosting markup are reported as
unsupported rather than scraped heuristically.
"""

from __future__ import annotations

import hashlib
import json
import re
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup

from app.adapters.job_sources.base import (
    JobSourceAdapter,
    NormalizedJob,
    SearchCriteria,
    SourceCheck,
    SourceError,
    html_to_text,
    infer_workplace,
    parse_dt,
    robots_allows,
)
from app.security.ssrf import UnsafeURLError, validate_url

MAX_FOLLOW = 25
_LINK_HINT = re.compile(r"(?i)/(jobs?|careers?|positions?|openings?|vacanc|roles?)/")


def _iter_jsonld(soup: BeautifulSoup):  # noqa: ANN202
    for tag in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            data = json.loads(tag.string or tag.get_text() or "")
        except (json.JSONDecodeError, TypeError):
            continue
        stack = data if isinstance(data, list) else [data]
        while stack:
            item = stack.pop()
            if isinstance(item, list):
                stack.extend(item)
            elif isinstance(item, dict):
                if "@graph" in item:
                    stack.extend(item["@graph"] if isinstance(item["@graph"], list) else [item["@graph"]])
                t = item.get("@type")
                types = t if isinstance(t, list) else [t]
                if "JobPosting" in types:
                    yield item
                for v in item.values():
                    if isinstance(v, (dict, list)) and v is not item.get("@graph"):
                        if isinstance(v, dict) and v.get("@type") == "JobPosting":
                            yield v


def _location(item: dict) -> str:
    locs = item.get("jobLocation")
    locs = locs if isinstance(locs, list) else [locs] if locs else []
    out = []
    for loc in locs:
        addr = (loc or {}).get("address") if isinstance(loc, dict) else None
        if isinstance(addr, dict):
            out.append(", ".join(x for x in (addr.get("addressLocality"), addr.get("addressRegion"),
                                             _country(addr.get("addressCountry"))) if x))
        elif isinstance(addr, str):
            out.append(addr)
    return "; ".join(o for o in out if o)


def _country(c: object) -> str:
    if isinstance(c, dict):
        return str(c.get("name") or "")
    return str(c or "")


class CareerPageAdapter(JobSourceAdapter):
    kind = "career_page"
    label = "Company career page (schema.org JobPosting)"
    description = (
        "Any careers page or job posting page that publishes schema.org JobPosting JSON-LD (most modern ATSs and "
        "Google-for-Jobs-enabled sites do). robots.txt is respected."
    )
    identifier_help = "Full URL of the careers page or a job posting, e.g. https://example.com/careers"
    complete_listing = False

    def _page(self, url: str) -> tuple[str, BeautifulSoup]:
        try:
            validate_url(url)
        except UnsafeURLError as exc:
            raise SourceError(f"URL not allowed: {exc}") from exc
        if not robots_allows(self.client, url):
            raise SourceError("This page disallows automated access in robots.txt.")
        res = self.get(url, headers={"Accept": "text/html,application/xhtml+xml"})
        if res.status_code == 404:
            raise SourceError("Page not found (404).")
        if res.status_code >= 400:
            raise SourceError(f"The page returned HTTP {res.status_code}.")
        ctype = res.headers.get("content-type", "")
        if "html" not in ctype and "xml" not in ctype:
            raise SourceError("The URL is not an HTML page.")
        return res.url, BeautifulSoup(res.text, "html.parser")

    def _postings(self, url: str, soup: BeautifulSoup) -> list[NormalizedJob]:
        return [self.normalize_job(item | {"_url": url}, urlsplit(url).netloc) for item in _iter_jsonld(soup)]

    def validate_source_access(self, identifier: str) -> SourceCheck:
        try:
            url, soup = self._page(identifier.strip())
        except SourceError as exc:
            return SourceCheck(False, str(exc))
        jobs = self._postings(url, soup)
        title = (soup.title.string.strip() if soup.title and soup.title.string else urlsplit(url).netloc)[:200]
        if jobs:
            return SourceCheck(True, "Structured job postings found.", display_name=title, job_count=len(jobs))
        links = self._job_links(url, soup)
        if links:
            return SourceCheck(True, f"Found {len(links)} job links; postings will be read from each link that "
                               "publishes structured data.", display_name=title, job_count=None)
        return SourceCheck(False, "No schema.org JobPosting data or job links were found on this page. "
                           "This site is not supported automatically — use 'Import job' to paste postings instead.")

    def _job_links(self, url: str, soup: BeautifulSoup) -> list[str]:
        host = urlsplit(url).netloc
        seen: list[str] = []
        for a in soup.find_all("a", href=True):
            href = urljoin(url, a["href"]).split("#")[0]
            if urlsplit(href).netloc == host and _LINK_HINT.search(urlsplit(href).path + "/") and href != url:
                if href not in seen:
                    seen.append(href)
        return seen[:MAX_FOLLOW]

    def discover_jobs(self, identifier: str, criteria: SearchCriteria) -> list[NormalizedJob]:
        url, soup = self._page(identifier.strip())
        jobs = self._postings(url, soup)
        if not jobs:
            for link in self._job_links(url, soup):
                try:
                    lurl, lsoup = self._page(link)
                except SourceError:
                    continue
                jobs.extend(self._postings(lurl, lsoup))
        return jobs

    def fetch_job_details(self, identifier: str, external_id: str) -> NormalizedJob | None:
        url = external_id.split("|", 1)[-1]
        try:
            final, soup = self._page(url)
        except SourceError as exc:
            if "404" in str(exc):
                return None
            raise
        postings = self._postings(final, soup)
        return postings[0] if postings else None

    def normalize_job(self, raw: dict, identifier: str) -> NormalizedJob:
        url = raw.get("url") or raw.get("_url") or ""
        org = raw.get("hiringOrganization")
        company = (org.get("name") if isinstance(org, dict) else str(org or "")) or identifier
        salary = raw.get("baseSalary") or {}
        smin = smax = None
        currency = ""
        if isinstance(salary, dict):
            currency = salary.get("currency") or ""
            val = salary.get("value") or {}
            if isinstance(val, dict):
                smin, smax = val.get("minValue"), val.get("maxValue") or val.get("value")
        ident = raw.get("identifier")
        ext = ident.get("value") if isinstance(ident, dict) else (ident if isinstance(ident, str) else "")
        ext = ext or hashlib.sha1(f"{url}|{raw.get('title')}".encode()).hexdigest()[:16]  # noqa: S324 - id only
        location = _location(raw)
        remote = str(raw.get("jobLocationType", "")).upper() == "TELECOMMUTE"
        valid_through = parse_dt(raw.get("validThrough"))
        emp = raw.get("employmentType")
        return NormalizedJob(
            source_kind=self.kind,
            external_id=f"{ext}|{url}"[:300],
            company=str(company)[:300],
            title=str(raw.get("title") or "").strip()[:300],
            location=location or ("Remote" if remote else ""),
            workplace_type="remote" if remote else infer_workplace(location),
            employment_type=", ".join(emp) if isinstance(emp, list) else str(emp or ""),
            description_text=html_to_text(str(raw.get("description") or "")),
            salary_min=float(smin) if isinstance(smin, (int, float)) else None,
            salary_max=float(smax) if isinstance(smax, (int, float)) else None,
            salary_currency=currency,
            posted_at=parse_dt(raw.get("datePosted")),
            application_url=url,
            posting_url=url,
            expires_at=valid_through,
        )
