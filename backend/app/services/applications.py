"""Application lifecycle: preparation, missing-information handling, approval, submission, tracking.

Safety rules enforced here (not just in the UI):
* one application per (user, job) — unique constraint + idempotent operations;
* nothing is submitted without approval, except in Authorized Automation mode for providers that support it,
  when every required answer is verified and the match score passes the user's threshold;
* unknown screening answers are never guessed — the application stops in ``needs_input``;
* CAPTCHA / login walls stop automation (HumanActionRequired);
* every step is recorded as an ApplicationEvent.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.adapters.application_providers import (
    PROVIDERS,
    FormField,
    HumanActionRequired,
    ProviderError,
    provider_for_job,
)
from app.adapters.application_providers.base import normalize_label
from app.core.config import get_settings
from app.core.database import SessionLocal, bind_tenant
from app.core.errors import DomainError
from app.documents.render import render_letter_pdf
from app.models import (
    AgentConfiguration,
    Application,
    ApplicationEvent,
    CoverLetter,
    Job,
    JobMatch,
    ResumeVersion,
    ScreeningAnswer,
    User,
)
from app.security.uploads import resolve_within, store_bytes
from app.services.audit import audit, notify
from app.services.profiles import profile_to_dict, require_active_profile

log = logging.getLogger(__name__)

STATUSES = [
    "discovered", "shortlisted", "rejected_by_filter", "resume_generated", "needs_input", "awaiting_approval",
    "ready_to_submit", "submitting", "submitted", "under_review", "assessment", "interview_scheduled",
    "interview_completed", "rejected", "withdrawn", "offer_received",
]
STATUS_LABELS = {
    "discovered": "Discovered", "shortlisted": "Shortlisted", "rejected_by_filter": "Rejected by filter",
    "resume_generated": "Resume generated", "needs_input": "Needs your input", "awaiting_approval": "Awaiting approval",
    "ready_to_submit": "Ready to submit", "submitting": "Submitting", "submitted": "Submitted",
    "under_review": "Under review", "assessment": "Assessment", "interview_scheduled": "Interview scheduled",
    "interview_completed": "Interview completed", "rejected": "Rejected", "withdrawn": "Withdrawn",
    "offer_received": "Offer received",
}
PRE_SUBMISSION = {"discovered", "shortlisted", "rejected_by_filter", "resume_generated", "needs_input",
                  "awaiting_approval", "ready_to_submit"}
POST_SUBMISSION = {"submitted", "under_review", "assessment", "interview_scheduled", "interview_completed",
                   "rejected", "offer_received", "withdrawn"}
# Statuses a user may set manually through the tracker.
MANUAL_STATUSES = {"discovered", "shortlisted", "rejected_by_filter", "under_review", "assessment",
                   "interview_scheduled", "interview_completed", "rejected", "withdrawn", "offer_received"}


def event(db: Session, app: Application, event_type: str, message: str = "", *, actor: str = "user",
          to_status: str | None = None, data: dict | None = None) -> None:
    from_status = app.status
    if to_status is not None:
        app.status = to_status
    db.add(ApplicationEvent(user_id=app.user_id, application_id=app.id, event_type=event_type,
                            from_status=from_status, to_status=app.status, actor=actor, message=message[:2000],
                            data=data or {}))


def get_or_create(db: Session, user: User, job: Job, *, actor: str = "user") -> tuple[Application, bool]:
    app = db.scalar(select(Application).where(Application.user_id == user.id, Application.job_id == job.id))
    if app is not None:
        return app, False
    match = db.scalar(select(JobMatch).where(JobMatch.user_id == user.id, JobMatch.job_id == job.id))
    app = Application(user_id=user.id, job_id=job.id, status="discovered",
                      match_score=match.overall_score if match else None, provider=provider_for_job(job).key)
    db.add(app)
    db.flush()
    event(db, app, "created", f"Tracking started for {job.title} at {job.company}.", actor=actor)
    return app, True


def _answer_bank(db: Session, user: User) -> dict[str, str]:
    return {r.question_key: r.answer for r in db.scalars(select(ScreeningAnswer).where(ScreeningAnswer.user_id == user.id))}


def _latest_documents(db: Session, user: User, job: Job) -> tuple[ResumeVersion | None, CoverLetter | None]:
    rv = db.scalar(select(ResumeVersion).where(ResumeVersion.user_id == user.id, ResumeVersion.job_id == job.id)
                   .order_by(ResumeVersion.created_at.desc()))
    cl = db.scalar(select(CoverLetter).where(CoverLetter.user_id == user.id, CoverLetter.job_id == job.id)
                   .order_by(CoverLetter.created_at.desc()))
    return rv, cl


def prepare(db: Session, user: User, job: Job, *, mode: str = "review", actor: str = "user",
            generate_missing: bool = True) -> Application:
    """Create/refresh an application draft: documents, form inspection, field mapping, missing info."""
    from app.services import cover_letters, tailoring

    if mode not in ("review", "assisted", "authorized"):
        raise DomainError("Invalid application mode.")
    if job.status == "expired":
        raise DomainError("This job is no longer open.")
    profile = require_active_profile(db, user)
    app, _ = get_or_create(db, user, job, actor=actor)
    if app.status in POST_SUBMISSION or app.status == "submitting":
        raise DomainError(f"This application is already {STATUS_LABELS[app.status].lower()}.", status_code=409)
    app.mode = mode
    cfg = db.scalar(select(AgentConfiguration).where(AgentConfiguration.user_id == user.id))
    rv, cl = _latest_documents(db, user, job)
    if rv is None and generate_missing:
        rv = tailoring.generate_resume(db, user, profile, job, template=cfg.resume_template if cfg else "classic",
                                       use_llm=cfg.use_llm if cfg else True)
        event(db, app, "resume_generated", f"Tailored resume v{rv.version_number} generated.", actor=actor,
              to_status="resume_generated" if app.status in ("discovered", "shortlisted") else None)
    if cl is None and generate_missing:
        cl = cover_letters.generate(db, user, profile, job, use_llm=cfg.use_llm if cfg else True)
    if rv is None:
        raise DomainError("Generate a tailored resume first.")
    app.resume_version_id = rv.id
    app.cover_letter_id = cl.id if cl else None
    match = db.scalar(select(JobMatch).where(JobMatch.user_id == user.id, JobMatch.job_id == job.id))
    app.match_score = match.overall_score if match else app.match_score

    provider = provider_for_job(job)
    app.provider = provider.key
    fields: list[FormField] = []
    if provider.supports_inspection:
        try:
            fields = provider.inspect_fields(job)
        except ProviderError as exc:
            event(db, app, "inspection_failed", f"Could not read the application form: {exc}", actor=actor)
            app.last_error = str(exc)[:1000]
    app.form_fields = [f.as_dict() for f in fields]
    answers, missing = provider.map_candidate_data(fields, profile_to_dict(profile), _answer_bank(db, user),
                                                   existing=app.answers)
    app.answers = answers
    app.missing_fields = missing
    app.approved_at = None
    new_status = "needs_input" if missing else "awaiting_approval"
    event(db, app, "prepared",
          f"Application prepared via {provider.label}. "
          + (f"{len(missing)} required question(s) need your answer." if missing else "Ready for your review."),
          actor=actor, to_status=new_status, data={"provider": provider.key, "fields": len(fields), "mode": mode})
    audit(db, user.id, "application.prepared", target_type="application", target_id=app.id)
    db.commit()
    db.refresh(app)
    return app


def provide_answers(db: Session, user: User, app: Application, answers: dict[str, str], *, save: bool = True) -> Application:
    if app.status not in ("needs_input", "awaiting_approval", "ready_to_submit"):
        raise DomainError("Answers can only be changed before submission.", status_code=409)
    fields = {f["name"]: f for f in app.form_fields or []}
    merged = dict(app.answers or {})
    for name, value in answers.items():
        value = str(value).strip()
        if name not in fields:
            raise DomainError(f"Unknown field '{name}'.")
        opts = fields[name].get("options") or []
        if value and opts and value not in opts:
            raise DomainError(f"'{value}' is not a valid option for '{fields[name]['label']}'.")
        if value:
            merged[name] = {"value": value, "source": "user"}
            if save:
                key = normalize_label(fields[name]["label"])
                row = db.scalar(select(ScreeningAnswer).where(ScreeningAnswer.user_id == user.id,
                                                              ScreeningAnswer.question_key == key))
                if row is None:
                    db.add(ScreeningAnswer(user_id=user.id, question_key=key, question_text=fields[name]["label"],
                                           answer=value))
                else:
                    row.answer = value
        else:
            merged.pop(name, None)
    app.answers = merged
    app.missing_fields = [f for f in app.form_fields if f.get("required") and not (merged.get(f["name"]) or {}).get("value")]
    if app.status == "ready_to_submit":
        app.approved_at = None  # answers changed → re-approval required
    new = "needs_input" if app.missing_fields else "awaiting_approval"
    event(db, app, "answers_updated", f"{len(answers)} answer(s) provided.", to_status=new)
    db.commit()
    db.refresh(app)
    return app


def approve(db: Session, user: User, app: Application) -> Application:
    if app.status != "awaiting_approval":
        raise DomainError(
            "Answer the remaining required questions first." if app.status == "needs_input"
            else f"Cannot approve an application that is {STATUS_LABELS.get(app.status, app.status).lower()}.",
            status_code=409)
    if app.resume_version_id is None:
        raise DomainError("Attach a resume before approving.")
    app.approved_at = datetime.now(UTC)
    event(db, app, "approved", "You approved this application for submission.", to_status="ready_to_submit")
    audit(db, user.id, "application.approved", target_type="application", target_id=app.id)
    db.commit()
    db.refresh(app)
    return app


def auto_submit_blockers(db: Session, user: User, app: Application, cfg: AgentConfiguration | None) -> list[str]:
    """Reasons an application may NOT be submitted automatically by the agent."""
    reasons = []
    provider = PROVIDERS.get(app.provider)
    if cfg is None or cfg.application_mode != "authorized" or cfg.authorized_automation_ack_at is None:
        reasons.append("Authorized automation is not enabled.")
    if provider is None or not provider.supports_submit:
        reasons.append(f"{provider.label if provider else app.provider} does not support automated submission.")
    if app.missing_fields:
        reasons.append("Required answers are missing.")
    if any((v or {}).get("source") not in ("profile", "facts", "answer_bank", "user", "document")
           for v in (app.answers or {}).values()):
        reasons.append("Some answers are not verified.")
    threshold = cfg.min_match_score if cfg else 60
    if app.match_score is None or app.match_score < threshold:
        reasons.append(f"Match score is below your threshold ({threshold:g}).")
    if app.status in POST_SUBMISSION:
        reasons.append("Already submitted.")
    return reasons


def submit(db: Session, user: User, app: Application, *, actor: str = "user") -> Application:
    """Queue an automated submission (idempotent). Requires approval unless authorised automation applies."""
    if app.status in POST_SUBMISSION:
        return app  # idempotent: never submit twice
    if app.status == "submitting" or app.busy:
        raise DomainError("A submission is already in progress.", status_code=409)
    provider = PROVIDERS.get(app.provider)
    if provider is None or not provider.supports_submit:
        raise DomainError(f"{provider.label if provider else 'This site'} does not support automated submission. "
                          "Open the application page, submit it yourself, then click 'Mark as submitted'.", status_code=422)
    cfg = db.scalar(select(AgentConfiguration).where(AgentConfiguration.user_id == user.id))
    threshold = cfg.min_match_score if cfg else 60.0
    if actor == "agent":
        blockers = auto_submit_blockers(db, user, app, cfg)
        if blockers:
            raise DomainError("; ".join(blockers), status_code=409)
    else:
        if app.status != "ready_to_submit" or app.approved_at is None:
            raise DomainError("Approve the application before submitting.", status_code=409)
        if app.match_score is not None and app.match_score < threshold:
            raise DomainError(f"The match score ({app.match_score:.0f}) is below your eligibility threshold "
                              f"({threshold:g}). Lower the threshold in Settings to submit anyway.", status_code=409)
    if app.missing_fields:
        raise DomainError("Required answers are missing.", status_code=409)
    app.busy = True
    event(db, app, "submission_queued", "Submission queued.", actor=actor, to_status="submitting")
    db.commit()
    from app.workers.tasks import submit_application_task

    submit_application_task.apply_async(args=[str(app.id)], kwargs={"actor": actor})
    db.refresh(app)
    return app


def _document_paths(db: Session, app: Application) -> dict[str, str]:
    s = get_settings()
    files: dict[str, str] = {}
    rv = db.get(ResumeVersion, app.resume_version_id) if app.resume_version_id else None
    if rv and rv.pdf_path:
        files["resume"] = str(resolve_within(s.generated_dir, rv.pdf_path))
    cl = db.get(CoverLetter, app.cover_letter_id) if app.cover_letter_id else None
    if cl and rv:
        rel = store_bytes(s.generated_dir, app.user_id, render_letter_pdf(cl.content, rv.content.get("header") or {}), ".pdf")
        files["cover_letter"] = str(resolve_within(s.generated_dir, rel))
    return files


def _private_hosts_for(job: Job) -> set[str]:
    from urllib.parse import urlsplit

    if job.is_demo:
        return {(urlsplit(get_settings().internal_base_url).hostname or "").lower()}
    return set()


def run_submission(application_id: str, *, actor: str = "user") -> str:
    """Worker entry point: fill, submit and verify with Playwright."""
    from app.adapters.application_providers.browser import isolated_page

    db = SessionLocal()
    try:
        app = db.get(Application, uuid.UUID(application_id))
        if app is None:
            return "missing"
        bind_tenant(db, app.user_id)
        if app.status in POST_SUBMISSION:
            app.busy = False
            db.commit()
            return app.status
        job = db.get(Job, app.job_id)
        provider = PROVIDERS[app.provider]
        fields = [FormField(**f) for f in app.form_fields or []]
        app.submit_attempts += 1
        try:
            files = _document_paths(db, app)
            with isolated_page(_private_hosts_for(job)) as page:
                result = provider.submit_application(page, job, fields, app.answers or {}, files)
            shot = store_bytes(get_settings().screenshots_dir, app.user_id, result.screenshot, ".png") if result.screenshot else ""
            app.confirmation_text = result.confirmation_text
            app.confirmation_screenshot = shot
            app.submitted_at = datetime.now(UTC)
            app.submitted_by = actor
            app.last_error = ""
            event(db, app, "submitted", f"Submitted and verified. Confirmation: {result.confirmation_text}",
                  actor=actor, to_status="submitted", data={"confirmation": result.confirmation_text})
            notify(db, app.user_id, f"Application submitted: {job.title} at {job.company}",
                   f"Confirmation: {result.confirmation_text}", kind="submission", link=f"/applications/{app.id}")
            audit(db, app.user_id, "application.submitted", target_type="application", target_id=app.id,
                  data={"actor": actor, "provider": provider.key})
        except HumanActionRequired as exc:
            app.last_error = str(exc)
            event(db, app, "human_action_required", str(exc), actor="system", to_status="ready_to_submit")
            notify(db, app.user_id, "Action needed to finish an application", str(exc), kind="approval",
                   link=f"/applications/{app.id}")
        except Exception as exc:  # noqa: BLE001
            log.exception("Submission failed")
            app.last_error = f"{type(exc).__name__}: {exc}"[:1000]
            event(db, app, "submission_failed", f"Submission failed: {app.last_error}", actor="system",
                  to_status="ready_to_submit")
            notify(db, app.user_id, "Application submission failed", app.last_error, kind="error",
                   link=f"/applications/{app.id}")
        finally:
            app.busy = False
            db.commit()
        return app.status
    finally:
        db.close()


def run_inspection(application_id: str) -> str:
    """Worker entry point for assisted mode: fill the form and capture a screenshot, without submitting."""
    from app.adapters.application_providers.browser import isolated_page

    db = SessionLocal()
    try:
        app = db.get(Application, uuid.UUID(application_id))
        if app is None:
            return "missing"
        bind_tenant(db, app.user_id)
        job = db.get(Job, app.job_id)
        provider = PROVIDERS[app.provider]
        fields = [FormField(**f) for f in app.form_fields or []]
        try:
            with isolated_page(_private_hosts_for(job)) as page:
                fill = provider.prepare_application(page, job, fields, app.answers or {}, _document_paths(db, app))
            if fill.screenshot:
                app.preparation_screenshot = store_bytes(get_settings().screenshots_dir, app.user_id, fill.screenshot, ".png")
            event(db, app, "assisted_fill", f"{fill.message} Filled {len(fill.filled)} field(s); "
                  f"{len(fill.skipped)} left for you.", actor="system",
                  data={"filled": fill.filled, "skipped": fill.skipped})
            app.last_error = ""
        except (ProviderError, HumanActionRequired) as exc:
            app.last_error = str(exc)
            event(db, app, "assisted_fill_failed", str(exc), actor="system")
        except Exception as exc:  # noqa: BLE001
            log.exception("Assisted fill failed")
            app.last_error = f"{type(exc).__name__}: {exc}"[:1000]
            event(db, app, "assisted_fill_failed", app.last_error, actor="system")
        finally:
            app.busy = False
            db.commit()
        return "ok"
    finally:
        db.close()


def start_assisted_fill(db: Session, user: User, app: Application) -> Application:
    provider = PROVIDERS.get(app.provider)
    if provider is None or not provider.supports_fill:
        raise DomainError("Assisted form filling is not available for this site.", status_code=422)
    if app.status not in ("awaiting_approval", "ready_to_submit", "needs_input"):
        raise DomainError("Prepare the application first.", status_code=409)
    if app.busy:
        raise DomainError("A browser task is already running for this application.", status_code=409)
    app.busy = True
    event(db, app, "assisted_fill_queued", "Opening the application form to pre-fill it (it will not be submitted).")
    db.commit()
    from app.workers.tasks import inspect_application_task

    inspect_application_task.apply_async(args=[str(app.id)])
    db.refresh(app)
    return app


def mark_submitted(db: Session, user: User, app: Application, note: str = "", submitted_on: date | None = None) -> Application:
    if app.status in POST_SUBMISSION:
        raise DomainError("This application is already marked as submitted.", status_code=409)
    app.submitted_at = datetime.combine(submitted_on, datetime.min.time(), UTC) if submitted_on else datetime.now(UTC)
    app.submitted_by = "user"
    app.confirmation_text = note[:2000]
    event(db, app, "submitted_manually", note or "You submitted this application yourself.", to_status="submitted")
    audit(db, user.id, "application.marked_submitted", target_type="application", target_id=app.id)
    db.commit()
    db.refresh(app)
    return app


def update_status(db: Session, user: User, app: Application, status: str, note: str = "") -> Application:
    if status not in MANUAL_STATUSES:
        raise DomainError(f"Status '{status}' cannot be set manually.")
    if status in POST_SUBMISSION - {"withdrawn"} and app.status in PRE_SUBMISSION:
        raise DomainError("Mark the application as submitted first.", status_code=409)
    if app.status == status:
        return app
    event(db, app, "status_changed", note or f"Status changed to {STATUS_LABELS[status]}.", to_status=status)
    db.commit()
    db.refresh(app)
    return app
