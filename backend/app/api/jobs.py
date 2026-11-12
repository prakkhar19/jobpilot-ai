from __future__ import annotations

import json
import uuid
from typing import Literal

from fastapi import APIRouter, Query, Response
from sqlalchemy import and_, func, or_, select

from app.adapters.job_sources import ADAPTERS, SourceError, get_adapter
from app.agents.runner import enqueue_run
from app.api.deps import DB, CurrentUser, get_owned_or_404
from app.core.config import get_settings
from app.core.errors import DomainError
from app.models import Application, Job, JobMatch, JobSource, SavedJob
from app.schemas.jobs import (
    DiscoverIn,
    ImportManualIn,
    ImportUrlIn,
    JobDetail,
    JobOut,
    JobPage,
    MatchOut,
    RequirementOut,
    SavedIn,
    SourceIn,
    SourceOut,
    SourceUpdate,
)
from app.security.crypto import encrypt
from app.services import discovery
from app.services.audit import audit
from app.services.match_service import ai_match_summary, get_prefs, match_jobs

router = APIRouter(prefix="/api", tags=["jobs"])


# ----------------------------------------------------------------------------------------- sources

@router.get("/sources/catalog")
def sources_catalog() -> dict:
    cat = discovery.source_catalog()
    if not get_settings().demo_mode:
        cat["supported"] = [s for s in cat["supported"] if s["kind"] != "demo"]
    return cat


def _source_out(src: JobSource) -> SourceOut:
    out = SourceOut.model_validate(src)
    out.has_credentials = bool(src.credentials_encrypted)
    return out


def _clean_credentials(kind: str, creds: dict[str, str] | None) -> dict[str, str]:
    allowed = {f["key"] for f in ADAPTERS[kind].credential_fields}
    return {k: str(v).strip()[:500] for k, v in (creds or {}).items() if k in allowed and str(v).strip()}


@router.get("/sources", response_model=list[SourceOut])
def list_sources(db: DB, user: CurrentUser) -> list[SourceOut]:
    rows = db.scalars(select(JobSource).where(JobSource.user_id == user.id).order_by(JobSource.created_at)).all()
    return [_source_out(r) for r in rows]


@router.post("/sources", response_model=SourceOut, status_code=201)
def create_source(body: SourceIn, db: DB, user: CurrentUser) -> SourceOut:
    if body.kind == "demo" and not get_settings().demo_mode:
        raise DomainError("The demo board is disabled on this installation.")
    creds = _clean_credentials(body.kind, body.credentials)
    missing = [f["label"] for f in ADAPTERS[body.kind].credential_fields if f["key"] not in creds]
    if missing:
        raise DomainError(f"Missing: {', '.join(missing)}.")
    ident = body.identifier.strip() or ADAPTERS[body.kind].identifier_default
    if not ident:
        raise DomainError("Enter an identifier for this source.")
    try:
        check = get_adapter(body.kind, creds).validate_source_access(ident)
    except SourceError as exc:
        raise DomainError(str(exc)) from exc
    if not check.ok:
        raise DomainError(check.message)
    if db.scalar(select(JobSource.id).where(JobSource.user_id == user.id, JobSource.kind == body.kind,
                                            JobSource.identifier == ident)):
        raise DomainError("This source is already configured.", status_code=409)
    src = JobSource(user_id=user.id, kind=body.kind, identifier=ident,
                    display_name=body.display_name or check.display_name or ident, enabled=body.enabled,
                    credentials_encrypted=encrypt(json.dumps(creds)) if creds else "")
    db.add(src)
    audit(db, user.id, "source.created", target_type="job_source", target_id=src.id, data={"kind": body.kind})
    db.commit()
    return _source_out(src)


@router.patch("/sources/{source_id}", response_model=SourceOut)
def update_source(source_id: uuid.UUID, body: SourceUpdate, db: DB, user: CurrentUser) -> SourceOut:
    src = get_owned_or_404(db, JobSource, source_id, user, "Source")
    if body.display_name is not None:
        src.display_name = body.display_name
    if body.enabled is not None:
        src.enabled = body.enabled
    if body.credentials is not None:
        creds = discovery.source_credentials(src) | _clean_credentials(src.kind, body.credentials)
        check = get_adapter(src.kind, creds).validate_source_access(src.identifier)
        if not check.ok:
            raise DomainError(check.message)
        src.credentials_encrypted = encrypt(json.dumps(creds)) if creds else ""
        src.last_status, src.last_error = "never", ""
    db.commit()
    return _source_out(src)


@router.delete("/sources/{source_id}", status_code=204)
def delete_source(source_id: uuid.UUID, db: DB, user: CurrentUser) -> Response:
    src = get_owned_or_404(db, JobSource, source_id, user, "Source")
    db.delete(src)
    db.commit()
    return Response(status_code=204)


@router.post("/sources/{source_id}/test")
def test_source(source_id: uuid.UUID, db: DB, user: CurrentUser) -> dict:
    src = get_owned_or_404(db, JobSource, source_id, user, "Source")
    try:
        check = get_adapter(src.kind, discovery.source_credentials(src)).validate_source_access(src.identifier)
    except SourceError as exc:
        return {"ok": False, "message": str(exc)}
    return {"ok": check.ok, "message": check.message, "job_count": check.job_count}


# --------------------------------------------------------------------------------------- discovery

@router.post("/jobs/discover", status_code=202)
def discover_now(body: DiscoverIn, db: DB, user: CurrentUser) -> dict:
    """Run discovery → analysis → matching now, as a background agent task."""
    if not db.scalar(select(JobSource.id).where(JobSource.user_id == user.id, JobSource.enabled.is_(True))):
        raise DomainError("Add at least one job source first (Discover Jobs → Sources).")
    task = enqueue_run(db, user, trigger="manual", source_ids=[str(s) for s in body.source_ids or []])
    return {"task_id": str(task.id), "state": task.state}


@router.post("/jobs/import-url", response_model=JobDetail, status_code=201)
def import_url(body: ImportUrlIn, db: DB, user: CurrentUser) -> JobDetail:
    job = discovery.import_from_url(db, user, str(body.url))
    _try_match(db, user, job)
    return _detail(db, user, job)


@router.post("/jobs/import-manual", response_model=JobDetail, status_code=201)
def import_manual(body: ImportManualIn, db: DB, user: CurrentUser) -> JobDetail:
    job = discovery.import_manual(db, user, **body.model_dump())
    _try_match(db, user, job)
    return _detail(db, user, job)


def _try_match(db: DB, user: CurrentUser, job: Job) -> None:
    try:
        match_jobs(db, user, [job.id], use_embeddings=False)
    except DomainError:
        pass  # no approved profile yet — job is still imported


@router.post("/jobs/rematch")
def rematch(db: DB, user: CurrentUser) -> dict:
    matches = match_jobs(db, user)
    return {"matched": len(matches)}


# -------------------------------------------------------------------------------------------- jobs

def _row_to_out(job: Job, score: float | None, rec: str | None, saved: bool, app: Application | None) -> JobOut:
    out = JobOut.model_validate(job)
    out.match_score = score
    out.recommendation = rec
    out.saved = saved
    out.application_status = app.status if app else None
    out.application_id = app.id if app else None
    return out


@router.get("/jobs", response_model=JobPage)
def list_jobs(
    db: DB,
    user: CurrentUser,
    view: Literal["all", "recommended", "saved", "hidden", "expired"] = "all",
    q: str = Query(default="", max_length=200),
    source_kind: str = "",
    workplace_type: str = "",
    min_score: float | None = Query(default=None, ge=0, le=100),
    sort: Literal["score", "newest", "company", "title"] = "newest",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> JobPage:
    stmt = (
        select(Job, JobMatch.overall_score, JobMatch.recommendation, SavedJob.id, Application)
        .outerjoin(JobMatch, and_(JobMatch.job_id == Job.id, JobMatch.user_id == user.id))
        .outerjoin(SavedJob, and_(SavedJob.job_id == Job.id, SavedJob.user_id == user.id))
        .outerjoin(Application, and_(Application.job_id == Job.id, Application.user_id == user.id))
        .where(Job.user_id == user.id)
    )
    if view == "hidden":
        stmt = stmt.where(Job.hidden.is_(True))
    elif view == "expired":
        stmt = stmt.where(Job.status == "expired")
    else:
        stmt = stmt.where(Job.hidden.is_(False), Job.status != "expired")
    if view == "saved":
        stmt = stmt.where(SavedJob.id.is_not(None))
    if view == "recommended":
        stmt = stmt.where(JobMatch.overall_score >= get_prefs(db, user).min_match_score)
        if sort == "newest":
            sort = "score"
    if q.strip():
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(Job.title).like(like), func.lower(Job.company).like(like),
                              func.lower(Job.location).like(like)))
    if source_kind:
        stmt = stmt.where(Job.source_kind == source_kind)
    if workplace_type:
        stmt = stmt.where(Job.workplace_type == workplace_type)
    if min_score is not None:
        stmt = stmt.where(JobMatch.overall_score >= min_score)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    order = {
        "score": [JobMatch.overall_score.desc().nulls_last(), Job.discovered_at.desc()],
        "newest": [Job.discovered_at.desc()],
        "company": [Job.company.asc(), Job.title.asc()],
        "title": [Job.title.asc()],
    }[sort]
    rows = db.execute(stmt.order_by(*order).offset((page - 1) * page_size).limit(page_size)).all()
    items = [_row_to_out(j, s, r, sid is not None, a) for j, s, r, sid, a in rows]
    return JobPage(items=items, total=total, page=page, page_size=page_size)


def _detail(db: DB, user: CurrentUser, job: Job) -> JobDetail:
    match = db.scalar(select(JobMatch).where(JobMatch.user_id == user.id, JobMatch.job_id == job.id))
    saved = db.scalar(select(SavedJob.id).where(SavedJob.user_id == user.id, SavedJob.job_id == job.id))
    app = db.scalar(select(Application).where(Application.user_id == user.id, Application.job_id == job.id))
    base = _row_to_out(job, match.overall_score if match else None, match.recommendation if match else None,
                       saved is not None, app)
    return JobDetail(
        **base.model_dump(),
        description_text=job.description_text,
        requirements=[RequirementOut.model_validate(r) for r in job.requirements],
        match=MatchOut.model_validate(match) if match else None,
    )


@router.get("/jobs/{job_id}", response_model=JobDetail)
def get_job(job_id: uuid.UUID, db: DB, user: CurrentUser) -> JobDetail:
    return _detail(db, user, get_owned_or_404(db, Job, job_id, user, "Job"))


@router.post("/jobs/{job_id}/match", response_model=JobDetail)
def match_job(job_id: uuid.UUID, db: DB, user: CurrentUser) -> JobDetail:
    job = get_owned_or_404(db, Job, job_id, user, "Job")
    match_jobs(db, user, [job.id])
    return _detail(db, user, job)


@router.post("/jobs/{job_id}/ai-summary")
def job_ai_summary(job_id: uuid.UUID, db: DB, user: CurrentUser) -> dict:
    job = get_owned_or_404(db, Job, job_id, user, "Job")
    return {"summary": ai_match_summary(db, user, job)}


@router.post("/jobs/{job_id}/find-official", response_model=JobDetail)
def find_official(job_id: uuid.UUID, db: DB, user: CurrentUser) -> JobDetail:
    """Look for the same job on the company's own careers board (Greenhouse/Lever/Ashby)."""
    from app.services.company_resolver import resolve_job

    job = get_owned_or_404(db, Job, job_id, user, "Job")
    found = resolve_job(db, job)
    db.commit()
    if found:
        _try_match(db, user, job)
    detail = _detail(db, user, job)
    if not found:
        raise DomainError("No matching posting was found on this company's own careers board. Apply via the "
                          "original link.", status_code=404)
    return detail


@router.post("/jobs/{job_id}/verify", response_model=JobDetail)
def verify(job_id: uuid.UUID, db: DB, user: CurrentUser) -> JobDetail:
    job = get_owned_or_404(db, Job, job_id, user, "Job")
    discovery.verify_job(db, user, job)
    db.commit()
    return _detail(db, user, job)


@router.post("/jobs/{job_id}/hide", response_model=JobOut)
def hide(job_id: uuid.UUID, db: DB, user: CurrentUser, hidden: bool = True) -> JobOut:
    job = get_owned_or_404(db, Job, job_id, user, "Job")
    job.hidden = hidden
    db.commit()
    return JobOut.model_validate(job)


@router.put("/jobs/{job_id}/save", status_code=204)
def save_job(job_id: uuid.UUID, body: SavedIn, db: DB, user: CurrentUser) -> Response:
    get_owned_or_404(db, Job, job_id, user, "Job")
    row = db.scalar(select(SavedJob).where(SavedJob.user_id == user.id, SavedJob.job_id == job_id))
    if row is None:
        db.add(SavedJob(user_id=user.id, job_id=job_id, note=body.note))
    else:
        row.note = body.note
    db.commit()
    return Response(status_code=204)


@router.delete("/jobs/{job_id}/save", status_code=204)
def unsave_job(job_id: uuid.UUID, db: DB, user: CurrentUser) -> Response:
    row = db.scalar(select(SavedJob).where(SavedJob.user_id == user.id, SavedJob.job_id == job_id))
    if row:
        db.delete(row)
        db.commit()
    return Response(status_code=204)


@router.delete("/jobs/{job_id}", status_code=204)
def delete_job(job_id: uuid.UUID, db: DB, user: CurrentUser) -> Response:
    job = get_owned_or_404(db, Job, job_id, user, "Job")
    app = db.scalar(select(Application).where(Application.user_id == user.id, Application.job_id == job.id))
    if app is not None and app.status not in ("discovered", "shortlisted", "rejected_by_filter", "withdrawn"):
        raise DomainError("This job has an application in progress or submitted. Hide the job instead, or "
                          "withdraw the application first — application history is kept for your records.",
                          status_code=409)
    db.delete(job)
    db.commit()
    return Response(status_code=204)
