"""Agent orchestration: lifecycle state machine, locks, limits, cancellation and logs.

States: IDLE → DISCOVERING → ANALYZING → MATCHING → GENERATING_RESUME → PREPARING_APPLICATION →
AWAITING_APPROVAL → (SUBMITTING → VERIFYING) → COMPLETED, or FAILED / PAUSED / CANCELLED.
"""

from __future__ import annotations

import logging
import threading
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import SessionLocal, bind_tenant
from app.core.errors import DomainError
from app.models import (
    AgentConfiguration,
    AgentExecutionLog,
    AgentTask,
    Application,
    Job,
    JobMatch,
    ResumeVersion,
    User,
)

log = logging.getLogger(__name__)

ACTIVE_STATES = {"IDLE", "DISCOVERING", "ANALYZING", "MATCHING", "GENERATING_RESUME", "PREPARING_APPLICATION",
                 "SUBMITTING", "VERIFYING"}
TERMINAL_STATES = {"COMPLETED", "FAILED", "PAUSED", "CANCELLED", "AWAITING_APPROVAL"}
STALE_AFTER = timedelta(minutes=20)


class Cancelled(Exception):
    pass


class Paused(Exception):
    pass


# ------------------------------------------------------------------------------------------- locks

_local_locks: dict[str, threading.Lock] = {}
_local_guard = threading.Lock()


class UserLock:
    """Redis lock (SET NX EX) per user so only one pipeline runs at a time; in-process fallback."""

    def __init__(self, user_id: uuid.UUID, ttl: int = 3600) -> None:
        self.key = f"lock:agent:{user_id}"
        self.ttl = ttl
        self.token = uuid.uuid4().hex
        self._redis = None
        self._local: threading.Lock | None = None

    def acquire(self) -> bool:
        if not get_settings().celery_eager:
            try:
                import redis

                self._redis = redis.Redis.from_url(get_settings().redis_url, socket_timeout=3)
                return bool(self._redis.set(self.key, self.token, nx=True, ex=self.ttl))
            except Exception:  # noqa: BLE001
                self._redis = None
        with _local_guard:
            self._local = _local_locks.setdefault(self.key, threading.Lock())
        return self._local.acquire(blocking=False)

    def release(self) -> None:
        if self._redis is not None:
            try:
                if self._redis.get(self.key) == self.token.encode():
                    self._redis.delete(self.key)
            except Exception:  # noqa: BLE001
                log.warning("Could not release agent lock %s; it will expire automatically", self.key)
        elif self._local is not None and self._local.locked():
            self._local.release()


# ------------------------------------------------------------------------------------------- enqueue

def get_config(db: Session, user_id: uuid.UUID) -> AgentConfiguration:
    cfg = db.scalar(select(AgentConfiguration).where(AgentConfiguration.user_id == user_id))
    if cfg is None:
        cfg = AgentConfiguration(user_id=user_id)
        db.add(cfg)
        db.flush()
    return cfg


def enqueue_run(db: Session, user: User, *, trigger: str = "manual", source_ids: list[str] | None = None) -> AgentTask:
    active = db.scalar(select(AgentTask).where(AgentTask.user_id == user.id, AgentTask.kind == "pipeline",
                                               AgentTask.state.in_(ACTIVE_STATES)))
    if active is not None:
        raise DomainError("The agent is already running. Wait for it to finish or cancel it.", status_code=409)
    task = AgentTask(user_id=user.id, kind="pipeline", trigger=trigger, state="IDLE",
                     stats={"source_ids": source_ids or []})
    db.add(task)
    db.commit()
    from app.workers.tasks import run_pipeline_task

    res = run_pipeline_task.apply_async(args=[str(task.id)], countdown=0)
    if not get_settings().celery_eager:
        task.celery_task_id = res.id or ""
        db.commit()
    db.refresh(task)
    return task


def request_cancel(db: Session, user: User, task: AgentTask) -> AgentTask:
    if task.state in TERMINAL_STATES:
        return task
    task.cancel_requested = True
    _log(db, task, "info", task.state, "Cancellation requested by user.")
    if task.state == "IDLE" and task.started_at is None:
        task.state = "CANCELLED"
        task.finished_at = datetime.now(UTC)
    db.commit()
    return task


# ------------------------------------------------------------------------------------------- run

def _log(db: Session, task: AgentTask, level: str, step: str, message: str, data: dict | None = None) -> None:
    db.add(AgentExecutionLog(user_id=task.user_id, task_id=task.id, level=level, step=step, message=message[:2000],
                             data=data or {}))


class PipelineContext:
    def __init__(self, db: Session, task: AgentTask, user: User, cfg: AgentConfiguration) -> None:
        self.db, self.task, self.user, self.cfg = db, task, user, cfg

    def state(self, new: str, message: str = "") -> None:
        self.check()
        self.task.state = new
        self.task.heartbeat_at = datetime.now(UTC)
        _log(self.db, self.task, "info", new, message or f"Entering {new}")
        self.db.commit()

    def info(self, message: str, data: dict | None = None, level: str = "info") -> None:
        _log(self.db, self.task, level, self.task.state, message, data)
        self.task.heartbeat_at = datetime.now(UTC)
        self.db.commit()

    def check(self) -> None:
        self.db.refresh(self.task)
        self.db.refresh(self.cfg)
        if self.task.cancel_requested:
            raise Cancelled()
        if self.cfg.paused and self.task.trigger == "schedule":
            raise Paused()


def _today_start() -> datetime:
    now = datetime.now(UTC)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def run_pipeline(task_id: str, *, step_hook: Callable[[str], None] | None = None) -> str:
    """Execute a pipeline task. Safe to call from Celery or synchronously."""
    from app.services import applications as app_svc
    from app.services import cover_letters, discovery, tailoring
    from app.services.audit import notify
    from app.services.match_service import match_jobs
    from app.services.profiles import get_active_profile

    db = SessionLocal()
    try:
        task = db.get(AgentTask, uuid.UUID(task_id))
        if task is None or task.state not in ("IDLE",):
            return task.state if task else "MISSING"
        user = db.get(User, task.user_id)
        if user is None or not user.is_active:
            task.state = "FAILED"
            task.error = "User not found or inactive"
            db.commit()
            return task.state
        bind_tenant(db, user.id)
        cfg = get_config(db, user.id)
        lock = UserLock(user.id)
        if not lock.acquire():
            task.state, task.error, task.finished_at = "FAILED", "Another run is in progress.", datetime.now(UTC)
            db.commit()
            return task.state
        ctx = PipelineContext(db, task, user, cfg)
        stats: dict = {"source_ids": task.stats.get("source_ids", [])}
        try:
            task.started_at = datetime.now(UTC)
            task.attempt += 1
            db.commit()
            profile = get_active_profile(db, user)

            # 1. Discovery (bounded by the daily discovery limit)
            ctx.state("DISCOVERING", "Searching configured job sources.")
            discovered_today = db.scalar(select(func.count(Job.id)).where(
                Job.user_id == user.id, Job.discovered_at >= _today_start(), Job.duplicate_of_id.is_(None))) or 0
            remaining = max(0, cfg.daily_discovery_limit - discovered_today)
            if remaining == 0:
                ctx.info(f"Daily discovery limit ({cfg.daily_discovery_limit}) reached; skipping discovery.")
                dstats = None
            else:
                source_ids = [uuid.UUID(s) for s in stats["source_ids"]] or None
                dstats = discovery.discover(db, user, cfg, source_ids=source_ids, limit=remaining,
                                            respect_interval=task.trigger == "schedule")
                stats["discovery"] = dstats.as_dict()
                ctx.info(f"Found {dstats.new} new job(s) from {dstats.sources_checked} source(s); "
                         f"{dstats.filtered_out} filtered out, {dstats.duplicates} duplicate(s), "
                         f"{dstats.expired} expired.", {"filtered_examples": dstats.filter_samples})
                for err in dstats.errors:
                    ctx.info(f"Source error: {err}", level="warning")
            if step_hook:
                step_hook("DISCOVERING")

            # 2. Find official company postings for jobs from alerts/aggregators, then analyse.
            ctx.state("ANALYZING", "Finding official company postings and extracting requirements.")
            from app.services.company_resolver import resolve_pending

            found = resolve_pending(db, user.id, limit=25)
            stats["official_postings_found"] = found
            if found:
                ctx.info(f"Found the official company posting for {found} job(s) — apply directly with the employer.")
            from app.services.jd_analysis import analyze_job

            pending = db.scalars(select(Job).where(Job.user_id == user.id, Job.analyzed_at.is_(None),
                                                   Job.status != "expired").limit(500)).all()
            for j in pending:
                analyze_job(db, j)
            db.commit()
            stats["analyzed"] = len(pending)
            ctx.info(f"Analysed {len(pending)} job description(s).")

            # 3. Matching
            ctx.state("MATCHING", "Scoring jobs against your profile.")
            if profile is None:
                ctx.info("No approved profile — skipping matching and document generation.", level="warning")
                task.state = "COMPLETED"
                task.stats = stats
                task.finished_at = datetime.now(UTC)
                db.commit()
                return task.state
            unmatched = db.scalars(
                select(Job.id).outerjoin(JobMatch, (JobMatch.job_id == Job.id) & (JobMatch.user_id == user.id))
                .where(Job.user_id == user.id, Job.status != "expired", Job.duplicate_of_id.is_(None),
                       (JobMatch.id.is_(None)) | (JobMatch.profile_version != profile.version))
                .limit(500)
            ).all()
            matches = match_jobs(db, user, list(unmatched)) if unmatched else []
            qualified = sorted([m for m in matches if m.overall_score >= cfg.min_match_score],
                               key=lambda m: -m.overall_score)
            stats["matched"] = len(matches)
            stats["qualified"] = len(qualified)
            if cfg.alert_on_new_matches and dstats is not None and dstats.new_job_ids:
                stats["alerts_sent"] = send_new_match_alerts(db, user, cfg, dstats.new_job_ids, qualified)
            ctx.info(f"Scored {len(matches)} job(s); {len(qualified)} meet your minimum score of {cfg.min_match_score:g}.")

            # 4. Document generation (bounded by the daily preparation limit)
            prepared_today = db.scalar(select(func.count(ResumeVersion.id)).where(
                ResumeVersion.user_id == user.id, ResumeVersion.created_at >= _today_start(),
                ResumeVersion.job_id.is_not(None))) or 0
            budget = max(0, cfg.max_preparations_per_day - prepared_today)
            generated: list[uuid.UUID] = []
            if cfg.auto_generate_documents and qualified and budget:
                ctx.state("GENERATING_RESUME", f"Tailoring documents for up to {budget} top job(s).")
                for m in qualified:
                    if len(generated) >= budget:
                        break
                    ctx.check()
                    job = db.get(Job, m.job_id)
                    if job is None or db.scalar(select(ResumeVersion.id).where(ResumeVersion.user_id == user.id,
                                                                               ResumeVersion.job_id == job.id)):
                        continue
                    try:
                        tailoring.generate_resume(db, user, profile, job, template=cfg.resume_template,
                                                  use_llm=cfg.use_llm)
                        cover_letters.generate(db, user, profile, job, use_llm=cfg.use_llm)
                        generated.append(job.id)
                        ctx.info(f"Generated resume and cover letter for {job.title} at {job.company}.")
                    except DomainError as exc:
                        ctx.info(f"Could not generate documents for {job.title}: {exc.message}", level="warning")
            elif qualified and not budget:
                ctx.info(f"Daily preparation limit ({cfg.max_preparations_per_day}) reached.")
            stats["documents_generated"] = len(generated)

            # 5. Application preparation (never submits in review/assisted modes)
            prepared: list[Application] = []
            if cfg.auto_prepare_applications and generated:
                ctx.state("PREPARING_APPLICATION", "Preparing applications for your review.")
                for job_id in generated:
                    ctx.check()
                    job = db.get(Job, job_id)
                    try:
                        application = app_svc.prepare(db, user, job, mode=cfg.application_mode, actor="agent")
                        prepared.append(application)
                        ctx.info(f"Prepared application for {job.title} at {job.company} "
                                 f"(status: {application.status}).")
                    except DomainError as exc:
                        ctx.info(f"Could not prepare application for {job.title}: {exc.message}", level="warning")
            stats["applications_prepared"] = len(prepared)

            # 6. Authorised automation: only for explicitly authorised, fully verified, supported cases.
            submitted = 0
            if cfg.application_mode == "authorized" and cfg.authorized_automation_ack_at and prepared:
                eligible = [a for a in prepared if app_svc.auto_submit_blockers(db, user, a, cfg) == []]
                if eligible:
                    ctx.state("SUBMITTING", f"Submitting {len(eligible)} authorised application(s).")
                    for a in eligible:
                        ctx.check()
                        result = app_svc.submit(db, user, a, actor="agent")
                        submitted += 1 if result.status == "submitted" else 0
                    ctx.state("VERIFYING", "Verifying submissions.")
                    ctx.info(f"{submitted} application(s) submitted and verified.")
            stats["submitted"] = submitted

            awaiting = [a for a in prepared if a.status in ("awaiting_approval", "needs_input")]
            final = "AWAITING_APPROVAL" if awaiting else "COMPLETED"
            if awaiting:
                notify(db, user.id, f"{len(awaiting)} application(s) need your review",
                       "The agent prepared applications that are waiting for your approval.", kind="approval",
                       link="/applications?status=awaiting_approval")
            if dstats and dstats.new:
                notify(db, user.id, f"{dstats.new} new job(s) discovered",
                       f"{len(qualified)} meet your minimum match score.", kind="discovery", link="/jobs/recommended")
            task.state = final
            task.stats = stats
            task.finished_at = datetime.now(UTC)
            cfg.last_run_at = task.finished_at
            _log(db, task, "info", final, "Run finished.", stats)
            db.commit()
            return task.state
        except Cancelled:
            db.rollback()
            task.state, task.finished_at, task.stats = "CANCELLED", datetime.now(UTC), stats
            _log(db, task, "info", "CANCELLED", "Run cancelled.")
            db.commit()
            return task.state
        except Paused:
            db.rollback()
            task.state, task.finished_at, task.stats = "PAUSED", datetime.now(UTC), stats
            _log(db, task, "info", "PAUSED", "Agent paused; run stopped.")
            db.commit()
            return task.state
        except Exception as exc:  # noqa: BLE001
            log.exception("Pipeline failed")
            db.rollback()
            task = db.get(AgentTask, uuid.UUID(task_id))
            task.state, task.error, task.finished_at = "FAILED", f"{type(exc).__name__}: {exc}"[:2000], datetime.now(UTC)
            task.stats = stats
            _log(db, task, "error", "FAILED", f"Run failed: {type(exc).__name__}: {exc}"[:2000])
            from app.services.audit import notify as _notify

            _notify(db, task.user_id, "Agent run failed", str(exc)[:500], kind="error", link="/agent")
            db.commit()
            return "FAILED"
        finally:
            lock.release()
    finally:
        db.close()


def send_new_match_alerts(db: Session, user: User, cfg: AgentConfiguration, new_job_ids: list[str],
                          qualified: list[JobMatch]) -> int:
    """Instant alerts for newly discovered jobs that pass the user's threshold (freshest first)."""
    from app.services.audit import notify
    from app.services.mailer import send_email, smtp_configured

    new_ids = {uuid.UUID(j) for j in new_job_ids}
    fresh = [m for m in qualified if m.job_id in new_ids and m.recommendation in ("strong_match", "good_match")]
    if not fresh:
        return 0
    jobs = {m.job_id: db.get(Job, m.job_id) for m in fresh}
    fresh.sort(key=lambda m: (-(m.overall_score or 0)))
    lines = []
    for m in fresh[:10]:
        j = jobs[m.job_id]
        notify(db, user.id, f"New match {m.overall_score:.0f}: {j.title} at {j.company}",
               f"{j.location or 'Location not stated'} — apply early for the best chance.", kind="match",
               link=f"/jobs/{j.id}")
        lines.append(f"- {m.overall_score:.0f}/100  {j.title} at {j.company} ({j.location}) — {j.posting_url}")
    if cfg.email_alerts and smtp_configured():
        base = get_settings().public_base_url.rstrip("/")
        send_email(user.email, f"JobPilot: {len(fresh)} new matching job(s)",
                   "New jobs matching your profile:\n\n" + "\n".join(lines) + f"\n\nReview them: {base}/jobs/recommended\n")
    return len(fresh[:10])


# ------------------------------------------------------------------------------------------- scheduler

def is_due(cfg: AgentConfiguration, now: datetime) -> bool:
    if not cfg.enabled or cfg.paused:
        return False
    if cfg.next_run_at is not None:
        nra = cfg.next_run_at if cfg.next_run_at.tzinfo else cfg.next_run_at.replace(tzinfo=UTC)
        if now < nra:
            return False
    try:
        local = now.astimezone(ZoneInfo(cfg.timezone or "UTC"))
    except ZoneInfoNotFoundError:
        local = now
    if cfg.run_days and local.weekday() not in cfg.run_days:
        return False
    start, end = cfg.window_start_hour, cfg.window_end_hour
    if start != end:
        in_window = start <= local.hour < end if start < end else (local.hour >= start or local.hour < end)
        if not in_window:
            return False
    return True


def tick(now: datetime | None = None) -> dict:
    """Called every minute by Celery beat: start due runs and fail stale ones."""
    now = now or datetime.now(UTC)
    started = 0
    failed_stale = 0
    with SessionLocal() as db:
        stale = db.scalars(select(AgentTask).where(AgentTask.state.in_(ACTIVE_STATES - {"IDLE"}))).all()
        for t in stale:
            hb = t.heartbeat_at or t.started_at or t.created_at
            hb = hb if hb.tzinfo else hb.replace(tzinfo=UTC)
            if now - hb > STALE_AFTER:
                t.state, t.error, t.finished_at = "FAILED", "Worker stopped responding (recovered by scheduler).", now
                _log(db, t, "error", "FAILED", t.error)
                failed_stale += 1
        db.commit()
        for cfg in db.scalars(select(AgentConfiguration).where(AgentConfiguration.enabled.is_(True),
                                                               AgentConfiguration.paused.is_(False))).all():
            if not is_due(cfg, now):
                continue
            user = db.get(User, cfg.user_id)
            if user is None or not user.is_active:
                continue
            cfg.next_run_at = now + timedelta(minutes=max(15, cfg.frequency_minutes))
            db.commit()
            try:
                enqueue_run(db, user, trigger="schedule")
                started += 1
            except DomainError:
                continue
    return {"started": started, "failed_stale": failed_stale}
