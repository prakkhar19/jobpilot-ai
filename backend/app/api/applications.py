from __future__ import annotations

import uuid

from fastapi import APIRouter, Query, Response
from fastapi.responses import FileResponse
from sqlalchemy import func, select

from app.adapters.application_providers import PROVIDERS
from app.adapters.application_providers.base import normalize_label
from app.api.deps import DB, CurrentUser, get_owned_or_404
from app.core.config import get_settings
from app.core.errors import DomainError
from app.models import (
    Application,
    ApplicationEvent,
    CoverLetter,
    Interview,
    Job,
    ResumeVersion,
    ScreeningAnswer,
)
from app.schemas.applications import (
    AnswerIn,
    AnswerOut,
    AnswersIn,
    ApplicationEventOut,
    ApplicationOut,
    ApplicationUpdate,
    InterviewIn,
    InterviewOut,
    MarkSubmittedIn,
    PrepareIn,
    StatusIn,
    TrackIn,
)
from app.security.uploads import resolve_within
from app.services import applications as svc

router = APIRouter(prefix="/api", tags=["applications"])


def _out(db: DB, app: Application, job: Job | None = None) -> ApplicationOut:
    job = job or db.get(Job, app.job_id)
    out = ApplicationOut.model_validate(app)
    if job:
        out.company, out.job_title, out.job_url = job.company, job.title, job.application_url or job.posting_url
        out.source_kind, out.is_demo = job.source_kind, job.is_demo
    p = PROVIDERS.get(app.provider)
    out.provider_capabilities = p.capabilities() if p else {}
    return out


@router.get("/applications/statuses")
def statuses() -> dict:
    return {"statuses": [{"key": k, "label": svc.STATUS_LABELS[k]} for k in svc.STATUSES],
            "manual": sorted(svc.MANUAL_STATUSES),
            "providers": [p.capabilities() for p in PROVIDERS.values()]}


@router.get("/applications", response_model=dict)
def list_applications(db: DB, user: CurrentUser, status: str = "", q: str = Query(default="", max_length=200),
                      page: int = Query(default=1, ge=1), page_size: int = Query(default=25, ge=1, le=100)) -> dict:
    stmt = select(Application, Job).join(Job, Job.id == Application.job_id).where(Application.user_id == user.id)
    if status:
        stmt = stmt.where(Application.status.in_(status.split(",")))
    if q.strip():
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(func.lower(Job.company).like(like) | func.lower(Job.title).like(like))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(stmt.order_by(Application.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [_out(db, a, j).model_dump(mode="json") for a, j in rows], "total": total, "page": page,
            "page_size": page_size}


@router.post("/applications/track", response_model=ApplicationOut, status_code=201)
def track(body: TrackIn, db: DB, user: CurrentUser) -> ApplicationOut:
    job = get_owned_or_404(db, Job, body.job_id, user, "Job")
    app, created = svc.get_or_create(db, user, job)
    if created and body.status == "shortlisted":
        svc.event(db, app, "status_changed", "Shortlisted.", to_status="shortlisted")
    db.commit()
    return _out(db, app, job)


@router.post("/applications/prepare", response_model=ApplicationOut, status_code=201)
def prepare(body: PrepareIn, db: DB, user: CurrentUser) -> ApplicationOut:
    job = get_owned_or_404(db, Job, body.job_id, user, "Job")
    return _out(db, svc.prepare(db, user, job, mode=body.mode), job)


@router.get("/applications/{app_id}", response_model=ApplicationOut)
def get_application(app_id: uuid.UUID, db: DB, user: CurrentUser) -> ApplicationOut:
    return _out(db, get_owned_or_404(db, Application, app_id, user, "Application"))


@router.patch("/applications/{app_id}", response_model=ApplicationOut)
def update_application(app_id: uuid.UUID, body: ApplicationUpdate, db: DB, user: CurrentUser) -> ApplicationOut:
    app = get_owned_or_404(db, Application, app_id, user, "Application")
    if body.notes is not None:
        app.notes = body.notes
    if body.follow_up_date is not None:
        app.follow_up_date = body.follow_up_date
    if body.clear_follow_up:
        app.follow_up_date = None
    for field, model in (("resume_version_id", ResumeVersion), ("cover_letter_id", CoverLetter)):
        value = getattr(body, field)
        if value is not None:
            if app.status not in svc.PRE_SUBMISSION:
                raise DomainError("Documents cannot be changed after submission.", status_code=409)
            doc = get_owned_or_404(db, model, value, user, "Document")
            if getattr(doc, "job_id", None) not in (None, app.job_id):
                raise DomainError("That document was generated for a different job.")
            setattr(app, field, value)
            if app.status == "ready_to_submit":
                app.approved_at = None
                svc.event(db, app, "documents_changed", "Documents changed — approval required again.",
                          to_status="awaiting_approval")
    db.commit()
    return _out(db, app)


@router.post("/applications/{app_id}/refresh", response_model=ApplicationOut)
def refresh(app_id: uuid.UUID, db: DB, user: CurrentUser) -> ApplicationOut:
    app = get_owned_or_404(db, Application, app_id, user, "Application")
    job = db.get(Job, app.job_id)
    return _out(db, svc.prepare(db, user, job, mode=app.mode), job)


@router.post("/applications/{app_id}/answers", response_model=ApplicationOut)
def answers(app_id: uuid.UUID, body: AnswersIn, db: DB, user: CurrentUser) -> ApplicationOut:
    app = get_owned_or_404(db, Application, app_id, user, "Application")
    return _out(db, svc.provide_answers(db, user, app, body.answers, save=body.save_to_answer_bank))


@router.post("/applications/{app_id}/approve", response_model=ApplicationOut)
def approve(app_id: uuid.UUID, db: DB, user: CurrentUser) -> ApplicationOut:
    app = get_owned_or_404(db, Application, app_id, user, "Application")
    return _out(db, svc.approve(db, user, app))


@router.post("/applications/{app_id}/submit", response_model=ApplicationOut, status_code=202)
def submit(app_id: uuid.UUID, db: DB, user: CurrentUser) -> ApplicationOut:
    app = get_owned_or_404(db, Application, app_id, user, "Application")
    return _out(db, svc.submit(db, user, app, actor="user"))


@router.post("/applications/{app_id}/assisted-fill", response_model=ApplicationOut, status_code=202)
def assisted_fill(app_id: uuid.UUID, db: DB, user: CurrentUser) -> ApplicationOut:
    app = get_owned_or_404(db, Application, app_id, user, "Application")
    return _out(db, svc.start_assisted_fill(db, user, app))


@router.post("/applications/{app_id}/mark-submitted", response_model=ApplicationOut)
def mark_submitted(app_id: uuid.UUID, body: MarkSubmittedIn, db: DB, user: CurrentUser) -> ApplicationOut:
    app = get_owned_or_404(db, Application, app_id, user, "Application")
    return _out(db, svc.mark_submitted(db, user, app, body.note, body.submitted_on))


@router.post("/applications/{app_id}/status", response_model=ApplicationOut)
def set_status(app_id: uuid.UUID, body: StatusIn, db: DB, user: CurrentUser) -> ApplicationOut:
    app = get_owned_or_404(db, Application, app_id, user, "Application")
    return _out(db, svc.update_status(db, user, app, body.status, body.note))


@router.get("/applications/{app_id}/events", response_model=list[ApplicationEventOut])
def events(app_id: uuid.UUID, db: DB, user: CurrentUser) -> list[ApplicationEventOut]:
    get_owned_or_404(db, Application, app_id, user, "Application")
    rows = db.scalars(select(ApplicationEvent).where(ApplicationEvent.application_id == app_id,
                                                     ApplicationEvent.user_id == user.id)
                      .order_by(ApplicationEvent.created_at)).all()
    return [ApplicationEventOut.model_validate(r) for r in rows]


@router.get("/applications/{app_id}/screenshot/{which}")
def screenshot(app_id: uuid.UUID, which: str, db: DB, user: CurrentUser) -> FileResponse:
    app = get_owned_or_404(db, Application, app_id, user, "Application")
    rel = {"preparation": app.preparation_screenshot, "confirmation": app.confirmation_screenshot}.get(which)
    if not rel:
        raise DomainError("No screenshot available.", status_code=404)
    return FileResponse(resolve_within(get_settings().screenshots_dir, rel), media_type="image/png")


@router.delete("/applications/{app_id}", status_code=204)
def delete_application(app_id: uuid.UUID, db: DB, user: CurrentUser) -> Response:
    app = get_owned_or_404(db, Application, app_id, user, "Application")
    if app.status in svc.POST_SUBMISSION - {"withdrawn"}:
        raise DomainError("Submitted applications are kept for your records. Set the status to Withdrawn instead.",
                          status_code=409)
    db.delete(app)
    db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------------------------- interviews

def _iv_out(db: DB, iv: Interview) -> InterviewOut:
    out = InterviewOut.model_validate(iv)
    app = db.get(Application, iv.application_id)
    job = db.get(Job, app.job_id) if app else None
    if job:
        out.company, out.job_title = job.company, job.title
    return out


@router.get("/interviews", response_model=list[InterviewOut])
def list_interviews(db: DB, user: CurrentUser, application_id: uuid.UUID | None = None) -> list[InterviewOut]:
    q = select(Interview).where(Interview.user_id == user.id)
    if application_id:
        q = q.where(Interview.application_id == application_id)
    rows = db.scalars(q.order_by(Interview.scheduled_at.desc().nulls_last())).all()
    return [_iv_out(db, r) for r in rows]


@router.post("/interviews", response_model=InterviewOut, status_code=201)
def create_interview(body: InterviewIn, db: DB, user: CurrentUser) -> InterviewOut:
    app = get_owned_or_404(db, Application, body.application_id, user, "Application")
    if app.status in svc.PRE_SUBMISSION:
        raise DomainError("Mark the application as submitted before adding interviews.", status_code=409)
    iv = Interview(user_id=user.id, **body.model_dump())
    db.add(iv)
    db.flush()
    target = "interview_completed" if body.status == "completed" else "interview_scheduled"
    if app.status not in ("offer_received", "rejected", "withdrawn"):
        svc.event(db, app, "interview_added", f"Interview ({body.kind.replace('_', ' ')}) added.", to_status=target)
    db.commit()
    return _iv_out(db, iv)


@router.put("/interviews/{iv_id}", response_model=InterviewOut)
def update_interview(iv_id: uuid.UUID, body: InterviewIn, db: DB, user: CurrentUser) -> InterviewOut:
    iv = get_owned_or_404(db, Interview, iv_id, user, "Interview")
    if body.application_id != iv.application_id:
        raise DomainError("Cannot move an interview to another application.")
    for k, v in body.model_dump().items():
        setattr(iv, k, v)
    app = db.get(Application, iv.application_id)
    if body.status == "completed" and app.status == "interview_scheduled":
        svc.event(db, app, "interview_completed", "Interview completed.", to_status="interview_completed")
    db.commit()
    return _iv_out(db, iv)


@router.delete("/interviews/{iv_id}", status_code=204)
def delete_interview(iv_id: uuid.UUID, db: DB, user: CurrentUser) -> Response:
    iv = get_owned_or_404(db, Interview, iv_id, user, "Interview")
    db.delete(iv)
    db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------------------------ answer bank

@router.get("/screening-answers", response_model=list[AnswerOut])
def list_answers(db: DB, user: CurrentUser) -> list[AnswerOut]:
    rows = db.scalars(select(ScreeningAnswer).where(ScreeningAnswer.user_id == user.id)
                      .order_by(ScreeningAnswer.question_text)).all()
    return [AnswerOut.model_validate(r) for r in rows]


@router.post("/screening-answers", response_model=AnswerOut, status_code=201)
def upsert_answer(body: AnswerIn, db: DB, user: CurrentUser) -> AnswerOut:
    key = normalize_label(body.question_text)
    row = db.scalar(select(ScreeningAnswer).where(ScreeningAnswer.user_id == user.id, ScreeningAnswer.question_key == key))
    if row is None:
        row = ScreeningAnswer(user_id=user.id, question_key=key, question_text=body.question_text, answer=body.answer)
        db.add(row)
    else:
        row.answer, row.question_text = body.answer, body.question_text
    db.commit()
    return AnswerOut.model_validate(row)


@router.delete("/screening-answers/{answer_id}", status_code=204)
def delete_answer(answer_id: uuid.UUID, db: DB, user: CurrentUser) -> Response:
    row = get_owned_or_404(db, ScreeningAnswer, answer_id, user, "Answer")
    db.delete(row)
    db.commit()
    return Response(status_code=204)
