"""Job discovery: run adapters, filter, normalise, deduplicate, persist, re-verify."""

from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.adapters.job_sources import (
    ADAPTERS,
    UNSUPPORTED_PLATFORMS,
    NormalizedJob,
    SearchCriteria,
    SourceError,
    get_adapter,
)
from app.adapters.job_sources.base import html_to_text
from app.core.errors import DomainError
from app.data.regions import open_to_india
from app.models import AgentConfiguration, Job, JobSource, User
from app.security.crypto import decrypt
from app.services.jd_analysis import analyze_job, detect_seniority
from app.services.skills import extract_skills, skill_key

log = logging.getLogger(__name__)


def criteria_from_config(cfg: AgentConfiguration | None, limit: int | None = None) -> SearchCriteria:
    if cfg is None:
        return SearchCriteria()
    return SearchCriteria(
        keywords=list(cfg.keywords or []),
        target_roles=list(cfg.target_roles or []),
        excluded_keywords=list(cfg.excluded_keywords or []),
        locations=list(cfg.locations or []),
        countries=list(cfg.countries or []),
        workplace_types=list(cfg.workplace_types or []),
        employment_types=list(cfg.employment_types or []),
        experience_levels=list(cfg.experience_levels or []),
        salary_min=cfg.salary_min,
        include_companies=list(cfg.include_companies or []),
        exclude_companies=list(cfg.exclude_companies or []),
        industries=list(cfg.industries or []),
        required_technologies=list(cfg.required_technologies or []),
        posted_within_days=cfg.posted_within_days,
        limit=limit or cfg.daily_discovery_limit,
    )


_ROLE_STOP = {"engineer", "developer", "and", "the", "of", "senior", "junior", "sr", "jr", "lead", "-"}
# Spelling variants that should compare equal ("Full-Stack" = "Fullstack" = "Full Stack", "Back End" = "Backend").
_ROLE_SYNONYMS = [
    (r"full[\s-]*stack", "fullstack"), (r"back[\s-]*end", "backend"), (r"front[\s-]*end", "frontend"),
    (r"dev[\s-]*ops", "devops"), (r"gen(?:erative)?[\s-]*ai", "genai"), (r"artificial[\s-]+intelligence", "ai"),
    (r"machine[\s-]+learning", "ml"), (r"\bai[\s/-]*ml\b", "ai ml"), (r"\bsde\b|software development engineer", "software engineer"),
]
# AI roles are named many ways; an "LLM Engineer" search should also find "AI Engineer", "GenAI Engineer"…
_AI_FAMILY = {"llm", "llms", "ai", "genai", "ml", "nlp"}


def _norm_role(text: str) -> str:
    t = text.lower()
    for pattern, repl in _ROLE_SYNONYMS:
        t = re.sub(pattern, repl, t)
    return t


def _role_matches(title: str, role: str) -> bool:
    t = _norm_role(title)
    r = _norm_role(role).strip()
    if not r:
        return False
    if r in t:
        return True
    # Token match: all distinctive tokens of the role appear in the title, plus one "type" token if present.
    toks = [w for w in re.findall(r"[a-z0-9+#.]+", r)]
    core = [w for w in toks if w not in _ROLE_STOP]
    kind = [w for w in toks if w in ("engineer", "developer")]
    title_toks = set(re.findall(r"[a-z0-9+#.]+", t))
    has_kind = any(k in t for k in ("engineer", "developer", "scientist")) if kind else True
    if core and set(core) <= _AI_FAMILY:
        return has_kind and bool(title_toks & _AI_FAMILY)
    has_core = all(re.search(rf"(?<![a-z]){re.escape(w)}", t) for w in core) if core else True
    return has_core and has_kind


def filter_reasons(job: NormalizedJob, c: SearchCriteria) -> list[str]:
    """Return the reasons a job fails the criteria (empty list = keep)."""
    reasons: list[str] = []
    title_l = job.title.lower()
    text_l = f"{job.title}\n{job.description_text}".lower()
    now = datetime.now(UTC)
    if job.expires_at and job.expires_at < now:
        reasons.append("posting has expired")
    if c.target_roles or c.keywords:
        role_ok = any(_role_matches(job.title, r) for r in c.target_roles) if c.target_roles else False
        kw_ok = any(k.lower() in text_l for k in c.keywords if k.strip()) if c.keywords else False
        if not (role_ok or kw_ok):
            reasons.append("title/keywords do not match your target roles")
    if any(k.lower() in text_l for k in c.excluded_keywords if k.strip()):
        reasons.append("contains an excluded keyword")
    if c.workplace_types and job.workplace_type != "unknown" and job.workplace_type not in c.workplace_types:
        reasons.append(f"work style is {job.workplace_type}")
    if c.locations or c.countries:
        loc_l = job.location.lower()
        wanted = [x.lower() for x in c.locations + c.countries if x.strip()]
        remote_wanted = not c.workplace_types or "remote" in c.workplace_types
        if "india" in [x.lower().strip() for x in c.countries]:
            # Region mode: anywhere in India (WFO/hybrid), or remote roles open to people in India.
            verdict = open_to_india(job.location, job.workplace_type, job.description_text)
            is_remote = job.workplace_type == "remote" or "remote" in loc_l
            if verdict is False or (is_remote and not remote_wanted):
                reasons.append(f"location '{job.location}' is not open to candidates in India")
        else:
            remote_ok = job.workplace_type == "remote" and remote_wanted
            if loc_l and not remote_ok and not any(w in loc_l for w in wanted):
                reasons.append(f"location '{job.location}' is not in your preferred locations")
    if c.employment_types and job.employment_type:
        et = job.employment_type.lower().replace("-", " ")
        if not any(x.lower().replace("-", " ") in et for x in c.employment_types):
            reasons.append(f"employment type is {job.employment_type}")
    if c.experience_levels:
        level = detect_seniority(job.title)
        if level and level not in c.experience_levels:
            reasons.append(f"seniority is {level}")
    if c.salary_min and job.salary_max and job.salary_max < c.salary_min:
        reasons.append("salary below your minimum")
    company_l = job.company.lower()
    if c.include_companies and not any(x.lower() in company_l for x in c.include_companies if x.strip()):
        reasons.append("company not in your include list")
    if any(x.lower() in company_l for x in c.exclude_companies if x.strip()):
        reasons.append("company is excluded")
    if c.industries and not any(x.lower() in text_l for x in c.industries if x.strip()):
        reasons.append("industry keywords not found")
    if c.required_technologies:
        present = {skill_key(s) for s in extract_skills(job.description_text)}
        missing = [t for t in c.required_technologies if skill_key(t) not in present and t.lower() not in text_l]
        if missing:
            reasons.append(f"missing required technologies: {', '.join(missing)}")
    if c.posted_within_days and job.posted_at and job.posted_at < now - timedelta(days=c.posted_within_days):
        reasons.append("posted too long ago")
    if not job.title or not title_l.strip():
        reasons.append("posting has no title")
    return reasons


def dedupe_key(company: str, title: str, location: str) -> str:
    def norm(s: str) -> str:
        s = re.sub(r"\(.*?\)", "", s.lower())
        s = re.sub(r"\b(inc|llc|ltd|gmbh|corp|corporation|co|limited|plc|the)\b\.?", "", s)
        return re.sub(r"[^a-z0-9]+", " ", s).strip()

    loc = norm(location.split(",")[0].split(";")[0]) if location else ""
    return f"{norm(company)}|{norm(title)}|{loc}"[:300]


@dataclass
class UpsertResult:
    job: Job
    created: bool
    duplicate: bool


def upsert_job(db: Session, user: User, nj: NormalizedJob, source: JobSource | None) -> UpsertResult:
    now = datetime.now(UTC)
    existing = db.scalar(
        select(Job).where(Job.user_id == user.id, Job.source_kind == nj.source_kind, Job.external_id == nj.external_id)
    )
    fields = dict(
        company=nj.company[:300], title=nj.title[:300], location=nj.location[:300], workplace_type=nj.workplace_type,
        employment_type=nj.employment_type[:40], department=nj.department[:200], salary_min=nj.salary_min,
        salary_max=nj.salary_max, salary_currency=nj.salary_currency[:10], salary_text=nj.salary_text[:300],
        description_text=nj.description_text, posted_at=nj.posted_at, application_url=nj.application_url[:1000],
        posting_url=nj.posting_url[:1000], is_demo=nj.is_demo,
    )
    if existing is not None:
        changed = existing.description_text != nj.description_text or existing.title != nj.title
        for k, v in fields.items():
            setattr(existing, k, v)
        existing.last_verified_at = now
        existing.status = "active"
        if changed:
            existing.analyzed_at = None
        return UpsertResult(existing, False, existing.duplicate_of_id is not None)
    key = dedupe_key(nj.company, nj.title, nj.location)
    dup = db.scalar(
        select(Job).where(Job.user_id == user.id, Job.dedupe_key == key, Job.duplicate_of_id.is_(None),
                          Job.status != "expired")
    )
    job = Job(
        user_id=user.id, source_id=source.id if source else None, source_kind=nj.source_kind,
        external_id=nj.external_id[:300], dedupe_key=key, discovered_at=now, last_verified_at=now,
        status="active", seniority=detect_seniority(nj.title), duplicate_of_id=dup.id if dup else None,
        hidden=dup is not None, **fields,
    )
    db.add(job)
    db.flush()
    return UpsertResult(job, True, dup is not None)


@dataclass
class DiscoveryStats:
    sources_checked: int = 0
    fetched: int = 0
    new: int = 0
    updated: int = 0
    duplicates: int = 0
    filtered_out: int = 0
    expired: int = 0
    skipped_recent: int = 0
    errors: list[str] = field(default_factory=list)
    new_job_ids: list[str] = field(default_factory=list)
    filter_samples: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {k: getattr(self, k) for k in ("sources_checked", "fetched", "new", "updated", "duplicates",
                                               "filtered_out", "expired", "skipped_recent", "errors")} | {"new_jobs": len(self.new_job_ids)}


def source_credentials(source: JobSource) -> dict[str, str]:
    if not source.credentials_encrypted:
        return {}
    import json

    return json.loads(decrypt(source.credentials_encrypted))


def run_source(db: Session, user: User, source: JobSource, criteria: SearchCriteria, stats: DiscoveryStats,
               remaining: int, *, respect_interval: bool = True) -> int:
    """Discover from one source. Returns how many new jobs were added."""
    adapter = get_adapter(source.kind, source_credentials(source))
    now = datetime.now(UTC)
    last = source.last_checked_at
    if (respect_interval or adapter.strict_interval) and last is not None and source.last_status == "ok":
        last = last if last.tzinfo else last.replace(tzinfo=UTC)
        if now - last < timedelta(minutes=adapter.min_interval_minutes):
            stats.skipped_recent += 1
            return 0
    stats.sources_checked += 1
    try:
        jobs = adapter.discover_jobs(source.identifier, criteria)
    except SourceError as exc:
        source.last_status, source.last_error, source.last_checked_at = "error", str(exc)[:1000], now
        stats.errors.append(f"{source.display_name or source.identifier}: {exc}")
        return 0
    stats.fetched += len(jobs)
    seen_ids: set[str] = set()
    added = 0
    for nj in jobs:
        seen_ids.add(nj.external_id)
        reasons = filter_reasons(nj, criteria)
        if reasons:
            stats.filtered_out += 1
            if len(stats.filter_samples) < 10:
                stats.filter_samples.append(f"{nj.title} @ {nj.company}: {reasons[0]}")
            # Keep existing records fresh even if they no longer match filters.
            continue
        if added >= remaining:
            break
        res = upsert_job(db, user, nj, source)
        if res.created:
            if res.duplicate:
                stats.duplicates += 1
            else:
                stats.new += 1
                added += 1
                stats.new_job_ids.append(str(res.job.id))
        else:
            stats.updated += 1
    if adapter.complete_listing:
        # Jobs from this source that disappeared from the complete listing are no longer open.
        stale = db.scalars(
            select(Job).where(Job.user_id == user.id, Job.source_id == source.id, Job.status == "active")
        ).all()
        for job in stale:
            if job.external_id not in seen_ids:
                job.status = "expired"
                job.last_verified_at = now
                stats.expired += 1
    source.last_status, source.last_error, source.last_checked_at = "ok", "", now
    source.jobs_found = len(jobs)
    return added


def discover(db: Session, user: User, cfg: AgentConfiguration | None, *, source_ids: list | None = None,
             limit: int | None = None, respect_interval: bool = True) -> DiscoveryStats:
    criteria = criteria_from_config(cfg, limit)
    stats = DiscoveryStats()
    q = select(JobSource).where(JobSource.user_id == user.id, JobSource.enabled.is_(True))
    if source_ids:
        q = q.where(JobSource.id.in_(source_ids))
    remaining = criteria.limit
    for source in db.scalars(q).all():
        if remaining <= 0:
            break
        remaining -= run_source(db, user, source, criteria, stats, remaining, respect_interval=respect_interval)
        db.commit()
    return stats


def verify_job(db: Session, user: User, job: Job) -> str:
    if job.source_kind in ("manual",):
        return job.status
    source = db.get(JobSource, job.source_id) if job.source_id else None
    identifier = source.identifier if source and source.kind == job.source_kind else job.external_id.split(":")[0]
    try:
        status = get_adapter(job.source_kind).check_job_status(identifier, job.external_id)
    except SourceError:
        status = "unknown"
    job.status = status if status in ("active", "expired") else job.status
    job.last_verified_at = datetime.now(UTC)
    return job.status


# ------------------------------------------------------------------------------- manual import

_PLATFORM_HOSTS = {
    "greenhouse": re.compile(r"(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io/([A-Za-z0-9_\-]+)/jobs/(\d+)"),
    "lever": re.compile(r"jobs\.(eu\.)?lever\.co/([A-Za-z0-9_\-.]+)/([A-Za-z0-9\-]{8,64})"),
    "ashby": re.compile(r"jobs\.ashbyhq\.com/([A-Za-z0-9_\-.%]+)/([A-Za-z0-9\-]{8,64})"),
}


def import_from_url(db: Session, user: User, url: str) -> Job:
    """Import a single posting from a supported URL (Greenhouse/Lever/Ashby/JSON-LD page)."""
    url = url.strip()
    low = url.lower()
    for name, note in UNSUPPORTED_PLATFORMS.items():
        if f"{name}." in low or f"{name}/" in low:
            raise DomainError(f"{name.title()} links can't be fetched automatically. {note} "
                              "Paste the job description text instead.", status_code=422)
    nj: NormalizedJob | None = None
    try:
        if m := _PLATFORM_HOSTS["greenhouse"].search(url):
            nj = get_adapter("greenhouse").fetch_job_details(m.group(1), m.group(2))
            if nj:
                meta_name = m.group(1)
                nj.company = nj.company if nj.company != meta_name else meta_name.replace("-", " ").title()
        elif m := _PLATFORM_HOSTS["lever"].search(url):
            ident = ("eu:" if m.group(1) else "") + m.group(2)
            nj = get_adapter("lever").fetch_job_details(ident, m.group(3))
        elif m := _PLATFORM_HOSTS["ashby"].search(url):
            nj = get_adapter("ashby").fetch_job_details(m.group(1), m.group(2))
        else:
            nj = get_adapter("career_page").fetch_job_details(url, url)
    except SourceError as exc:
        raise DomainError(f"Could not import this URL: {exc}", status_code=422) from exc
    if nj is None:
        raise DomainError("No job posting data was found at this URL (or it has closed). "
                          "Paste the job description text instead.", status_code=422)
    res = upsert_job(db, user, nj, None)
    analyze_job(db, res.job)
    db.commit()
    return res.job


def import_manual(db: Session, user: User, *, title: str, company: str, description: str, location: str = "",
                  url: str = "", workplace_type: str = "unknown", employment_type: str = "") -> Job:
    if "<" in description and ">" in description:
        description = html_to_text(description)
    ext = hashlib.sha256(f"{company}|{title}|{url}|{description[:500]}".encode()).hexdigest()[:24]
    nj = NormalizedJob(
        source_kind="manual", external_id=ext, company=company.strip(), title=title.strip(), location=location.strip(),
        workplace_type=workplace_type if workplace_type in ("remote", "hybrid", "onsite") else "unknown",
        employment_type=employment_type, description_text=description.strip(), application_url=url.strip(),
        posting_url=url.strip(), posted_at=None,
    )
    res = upsert_job(db, user, nj, None)
    analyze_job(db, res.job)
    db.commit()
    return res.job


def source_catalog() -> dict:
    return {
        "supported": [
            {"kind": k, "label": a.label, "description": a.description, "identifier_help": a.identifier_help,
             "identifier_default": a.identifier_default, "credential_fields": a.credential_fields,
             "min_interval_minutes": a.min_interval_minutes, "attribution": a.attribution}
            for k, a in ADAPTERS.items()
        ],
        "unsupported": [{"platform": k, "reason": v} for k, v in UNSUPPORTED_PLATFORMS.items()],
    }
