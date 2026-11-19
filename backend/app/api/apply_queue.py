"""Apply Mode: the user's best unapplied jobs, one at a time, with tailored documents ready.

JobPilot never submits to job boards like Naukri or LinkedIn. This queue gets everything ready so the user can
apply on the employer's site in seconds, then records that they applied.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import func, select

from app.agents.runner import get_config
from app.api.deps import DB, CurrentUser, get_owned_or_404
from app.core.errors import DomainError
from app.models import Application, CoverLetter, Job, JobMatch, ResumeVersion, User
from app.services import applications as svc
from app.services import cover_letters, tailoring
from app.services.profiles import require_active_profile

router = APIRouter(prefix="/api", tags=["apply-queue"])

# Jobs in these application states are done (applied, closed or rejected) and leave the queue.
_DONE = svc.POST_SUBMISSION | {"rejected_by_filter"}


class QueueItem(BaseModel):
    job_id: uuid.UUID
    title: str
    company: str
    location: str
    workplace_type: str
    source_kind: str
    match_score: float
    apply_url: str
    discovered_at: str
    application_id: uuid.UUID | None = None
    resume_version_id: uuid.UUID | None = None
    cover_letter_id: uuid.UUID | None = None
    cover_letter: str = ""


class QueueOut(BaseModel):
    items: list[QueueItem]
    total: int
    applied_today: int
    min_score: float


def _latest(db: DB, model: type, user: User, job_id: uuid.UUID):  # noqa: ANN202
    return db.scalar(select(model).where(model.user_id == user.id, model.job_id == job_id)
                     .order_by(model.created_at.desc()).limit(1))


def _item(db: DB, user: User, job: Job, score: float, app: Application | None) -> QueueItem:
    rv = _latest(db, ResumeVersion, user, job.id)
    cl = _latest(db, CoverLetter, user, job.id)
    return QueueItem(
        job_id=job.id, title=job.title, company=job.company, location=job.location or "",
        workplace_type=job.workplace_type or "unknown", source_kind=job.source_kind, match_score=round(score, 1),
        apply_url=job.official_url or job.application_url or job.posting_url or "",
        discovered_at=job.discovered_at.isoformat() if job.discovered_at else "",
        application_id=app.id if app else None, resume_version_id=rv.id if rv else None,
        cover_letter_id=cl.id if cl else None, cover_letter=cl.content if cl else "",
    )


def _queue_rows(db: DB, user: User, min_score: float) -> list[tuple[Job, float, Application | None]]:
    rows = db.execute(
        select(Job, JobMatch.overall_score, Application)
        .join(JobMatch, (JobMatch.job_id == Job.id) & (JobMatch.user_id == user.id))
        .outerjoin(Application, (Application.job_id == Job.id) & (Application.user_id == user.id))
        .where(Job.user_id == user.id, Job.hidden.is_(False), Job.status != "expired", Job.duplicate_of_id.is_(None),
               JobMatch.overall_score >= min_score)
    ).all()
    rows = [(j, s, a) for j, s, a in rows if a is None or a.status not in _DONE]
    now = datetime.now(UTC)
    return sorted(rows, key=lambda r: (-(r[1] + _freshness_bonus(r[0], now)), -(r[0].discovered_at or now).timestamp()))


def _freshness_bonus(job: Job, now: datetime) -> float:
    """Early applicants get far more replies, so new postings move up and old ones (often filled) move down."""
    seen = job.posted_at or job.discovered_at
    if seen is None:
        return 0.0
    if seen.tzinfo is None:
        seen = seen.replace(tzinfo=UTC)
    age_days = (now - seen).total_seconds() / 86400
    if age_days <= 2:
        return 10.0
    if age_days <= 7:
        return 5.0
    if age_days > 21:
        return -10.0
    return 0.0


@router.get("/apply-queue", response_model=QueueOut)
def apply_queue(db: DB, user: CurrentUser, limit: int = Query(default=50, ge=1, le=200)) -> QueueOut:
    cfg = get_config(db, user.id)
    rows = _queue_rows(db, user, cfg.min_match_score)
    try:
        tz = ZoneInfo(cfg.timezone or "UTC")
    except ZoneInfoNotFoundError:
        tz = ZoneInfo("UTC")
    start = datetime.now(tz).replace(hour=0, minute=0, second=0, microsecond=0)
    applied_today = db.scalar(select(func.count(Application.id)).where(Application.user_id == user.id,
                                                                       Application.submitted_at >= start)) or 0
    return QueueOut(items=[_item(db, user, j, s, a) for j, s, a in rows[:limit]], total=len(rows),
                    applied_today=applied_today, min_score=cfg.min_match_score)


@router.post("/apply-queue/{job_id}/prepare", response_model=QueueItem)
def prepare(job_id: uuid.UUID, db: DB, user: CurrentUser) -> QueueItem:
    """Create the tailored resume and cover letter for this job if they don't exist yet."""
    job = get_owned_or_404(db, Job, job_id, user, "Job")
    profile = require_active_profile(db, user)
    cfg = get_config(db, user.id)
    if _latest(db, ResumeVersion, user, job.id) is None:
        tailoring.generate_resume(db, user, profile, job, template=cfg.resume_template, use_llm=cfg.use_llm)
    if _latest(db, CoverLetter, user, job.id) is None:
        cover_letters.generate(db, user, profile, job, use_llm=cfg.use_llm)
    app, _ = svc.get_or_create(db, user, job)
    if app.status in ("discovered", "shortlisted"):
        svc.event(db, app, "documents_ready", "Tailored resume and cover letter prepared.", to_status="resume_generated")
    db.commit()
    match = db.scalar(select(JobMatch).where(JobMatch.user_id == user.id, JobMatch.job_id == job.id))
    return _item(db, user, job, match.overall_score if match else 0.0, app)


@router.post("/apply-queue/{job_id}/applied", status_code=204)
def applied(job_id: uuid.UUID, db: DB, user: CurrentUser) -> None:
    """The user applied on the employer's site themselves: record it and attach the documents they used."""
    job = get_owned_or_404(db, Job, job_id, user, "Job")
    app, _ = svc.get_or_create(db, user, job)
    if app.status in svc.POST_SUBMISSION:
        raise DomainError("This application is already marked as submitted.", status_code=409)
    rv = _latest(db, ResumeVersion, user, job.id)
    cl = _latest(db, CoverLetter, user, job.id)
    if rv is not None and app.resume_version_id is None:
        app.resume_version_id = rv.id
    if cl is not None and app.cover_letter_id is None:
        app.cover_letter_id = cl.id
    db.flush()
    svc.mark_submitted(db, user, app, "Applied on the employer's site from Apply Mode.")
