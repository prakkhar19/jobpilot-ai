"""Find the official company posting for a job discovered elsewhere.

Jobs from job-alert emails (LinkedIn, Naukri…) or aggregators (Adzuna, Remotive…) usually have only a snippet
and point to a third-party site. Many companies run their own careers board on Greenhouse, Lever or Ashby,
whose public APIs allow automated access. This resolver looks for the company's board and the same role on it.
When found, the job gets the full official description and the company's own application URL, so the user
applies directly with the employer (and JobPilot can inspect/pre-fill that form).
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.adapters.job_sources import SearchCriteria, SourceError
from app.adapters.job_sources.ashby import AshbyAdapter
from app.adapters.job_sources.base import NormalizedJob
from app.adapters.job_sources.greenhouse import GreenhouseAdapter
from app.adapters.job_sources.lever import LeverAdapter
from app.data.company_directory import COMPANY_BOARDS
from app.models import Job
from app.security.ssrf import SafeHttpClient

log = logging.getLogger(__name__)

RESOLVABLE_SOURCES = {"email_alerts", "adzuna", "remotive", "arbeitnow", "manual"}
_PLATFORMS = {"greenhouse": GreenhouseAdapter, "lever": LeverAdapter, "ashby": AshbyAdapter}
_SUFFIX = re.compile(r"\b(inc|llc|ltd|limited|pvt|private|gmbh|corp|corporation|co|technologies|technology|tech|labs|"
                     r"software|solutions|systems|india|global|group|hq|the)\b\.?", re.IGNORECASE)
_TITLE_STOP = {"the", "and", "of", "for", "a", "an", "-", "–", "remote", "hybrid", "onsite", "i", "ii", "iii", "with"}

# board listings cached per process: (platform, token) -> (fetched_at, jobs | None)
_cache: dict[tuple[str, str], tuple[float, list[NormalizedJob] | None]] = {}
_CACHE_SECONDS = 1800


def company_key(name: str) -> str:
    n = _SUFFIX.sub(" ", (name or "").lower())
    return re.sub(r"[^a-z0-9]+", "", n)


def candidate_tokens(company: str) -> list[str]:
    """Plausible board identifiers for a company name, most likely first."""
    base = _SUFFIX.sub(" ", (company or "").lower()).strip()
    words = re.findall(r"[a-z0-9]+", base)
    if not words:
        return []
    out = ["".join(words), "-".join(words)]
    if len(words) > 1:
        out.append(words[0])
    full = re.findall(r"[a-z0-9]+", (company or "").lower())
    out.append("".join(full))
    return list(dict.fromkeys(t for t in out if len(t) >= 2))


def _title_tokens(t: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9+#]+", (t or "").lower()) if w not in _TITLE_STOP}


def title_similarity(a: str, b: str) -> float:
    ta, tb = _title_tokens(a), _title_tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def _board_jobs(client: SafeHttpClient, platform: str, token: str) -> list[NormalizedJob] | None:
    key = (platform, token)
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < _CACHE_SECONDS:
        return hit[1]
    try:
        jobs = _PLATFORMS[platform](client).discover_jobs(token, SearchCriteria())
    except SourceError:
        jobs = None
    _cache[key] = (time.time(), jobs)
    return jobs


@dataclass
class Resolution:
    platform: str
    token: str
    job: NormalizedJob
    similarity: float


def _location_ok(a: str, b: str) -> bool:
    if not a or not b:
        return True
    la, lb = a.lower(), b.lower()
    if "remote" in la and "remote" in lb:
        return True
    first = re.split(r"[,(/;]", la)[0].strip()
    return not first or first in lb or re.split(r"[,(/;]", lb)[0].strip() in la


def find_official_posting(company: str, title: str, location: str = "", *, client: SafeHttpClient | None = None,
                          min_similarity: float = 0.6) -> Resolution | None:
    own = client is None
    client = client or SafeHttpClient()
    try:
        ck = company_key(company)
        if not ck:
            return None
        boards: list[tuple[str, str]] = [(p, t) for p, t in COMPANY_BOARDS if company_key(t) == ck]
        for tok in candidate_tokens(company):
            for p in ("greenhouse", "lever", "ashby"):
                if (p, tok) not in boards:
                    boards.append((p, tok))
        best: Resolution | None = None
        for platform, token in boards[:12]:
            jobs = _board_jobs(client, platform, token)
            if not jobs:
                continue
            # Make sure the board really belongs to this company (name check where the API gives one).
            if platform == "greenhouse" and jobs and company_key(jobs[0].company) not in (ck, company_key(token)):
                if not company_key(jobs[0].company).startswith(ck[:5]):
                    continue
            for j in jobs:
                sim = title_similarity(title, j.title)
                if sim >= min_similarity and _location_ok(location, j.location) and (best is None or sim > best.similarity):
                    best = Resolution(platform, token, j, sim)
            if best and best.similarity >= 0.99:
                break
        return best
    finally:
        if own:
            client.close()


def resolve_job(db: Session, job: Job, *, client: SafeHttpClient | None = None) -> bool:
    """Attach the official company posting to ``job``. Returns True if one was found."""
    job.official_checked_at = datetime.now(UTC)
    res = find_official_posting(job.company, job.title, job.location, client=client)
    if res is None:
        return False
    official = res.job
    job.official_source = f"{res.platform}:{official.external_id}"[:300]
    job.official_url = official.application_url or official.posting_url
    job.application_url = job.official_url
    snippet_only = job.source_kind in ("email_alerts", "adzuna")
    if official.description_text and (snippet_only or len(official.description_text) > len(job.description_text)):
        job.description_text = official.description_text
        job.analyzed_at = None  # re-analyse with the full description
    if official.location and not job.location:
        job.location = official.location
    if job.workplace_type == "unknown":
        job.workplace_type = official.workplace_type
    return True


def resolve_pending(db: Session, user_id, limit: int = 25) -> int:  # noqa: ANN001
    from sqlalchemy import select

    jobs = db.scalars(
        select(Job).where(Job.user_id == user_id, Job.source_kind.in_(RESOLVABLE_SOURCES), Job.official_checked_at.is_(None),
                          Job.status != "expired", Job.duplicate_of_id.is_(None))
        .order_by(Job.discovered_at.desc()).limit(limit)
    ).all()
    found = 0
    with SafeHttpClient() as client:
        for job in jobs:
            try:
                found += resolve_job(db, job, client=client)
            except Exception:  # noqa: BLE001 - one bad lookup must not stop the run
                log.exception("Company resolution failed")
    db.commit()
    return found
