"""Celery tasks."""

from __future__ import annotations

import logging
import socket
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select

from app.core.config import get_settings
from app.core.database import SessionLocal, bind_tenant
from app.models import AgentExecutionLog, Job, User, WorkerHeartbeat
from app.workers.celery_app import celery_app

log = logging.getLogger(__name__)


def _beat(name: str, info: dict | None = None) -> None:
    try:
        with SessionLocal() as db:
            row = db.get(WorkerHeartbeat, name)
            if row is None:
                row = WorkerHeartbeat(name=name)
                db.add(row)
            row.last_seen_at = datetime.now(UTC)
            row.info = (info or {}) | {"host": socket.gethostname()}
            db.commit()
    except Exception:  # noqa: BLE001
        log.warning("Could not write heartbeat %s", name)


@celery_app.task(name="jobpilot.run_pipeline", bind=True, max_retries=0)
def run_pipeline_task(self, task_id: str) -> str:  # noqa: ANN001
    from app.agents.runner import run_pipeline

    _beat("worker", {"last_task": "pipeline"})
    return run_pipeline(task_id)


@celery_app.task(name="jobpilot.submit_application", bind=True, autoretry_for=(ConnectionError, TimeoutError),
                 retry_backoff=30, retry_backoff_max=600, max_retries=3)
def submit_application_task(self, application_id: str, actor: str = "user") -> str:  # noqa: ANN001
    from app.services.applications import run_submission

    _beat("worker", {"last_task": "submit"})
    return run_submission(application_id, actor=actor)


@celery_app.task(name="jobpilot.inspect_application", bind=True, max_retries=1)
def inspect_application_task(self, application_id: str) -> str:  # noqa: ANN001
    from app.services.applications import run_inspection

    _beat("worker", {"last_task": "inspect"})
    return run_inspection(application_id)


@celery_app.task(name="jobpilot.agent_tick")
def agent_tick() -> dict:
    from app.agents.runner import tick

    # Beat dispatched this task (scheduler alive) and a worker executed it (worker alive).
    _beat("scheduler", {"last_tick": datetime.now(UTC).isoformat()})
    _beat("worker", {"last_task": "agent_tick"})
    return tick()


@celery_app.task(name="jobpilot.scheduler_heartbeat")
def scheduler_heartbeat() -> None:
    _beat("scheduler")
    _beat("worker", {"last_task": "heartbeat"})


@celery_app.task(name="jobpilot.ping")
def ping() -> str:
    _beat("worker")
    return "pong"


@celery_app.task(name="jobpilot.verify_jobs")
def verify_jobs() -> int:
    """Re-check that active jobs older than a day are still open (bounded per run)."""
    from app.services.discovery import verify_job

    checked = 0
    cutoff = datetime.now(UTC) - timedelta(days=1)
    with SessionLocal() as db:
        jobs = db.scalars(select(Job).where(Job.status == "active", Job.source_kind.in_(["greenhouse", "lever", "ashby"]),
                                            Job.last_verified_at < cutoff).limit(200)).all()
        for job in jobs:
            user = db.get(User, job.user_id)
            if user is None:
                continue
            verify_job(db, user, job)
            checked += 1
        db.commit()
    return checked


@celery_app.task(name="jobpilot.weekly_reports")
def weekly_reports() -> int:
    from app.services.analytics import weekly_report
    from app.services.audit import notify

    sent = 0
    with SessionLocal() as db:
        for user in db.scalars(select(User).where(User.is_active.is_(True))).all():
            bind_tenant(db, user.id)
            rep = weekly_report(db, user)
            notify(db, user.id, "Your weekly job search report", rep["text"], kind="report", link="/analytics")
            bind_tenant(db, None)
            sent += 1
        db.commit()
    return sent


@celery_app.task(name="jobpilot.retention")
def retention() -> int:
    days = get_settings().data_retention_days_logs
    cutoff = datetime.now(UTC) - timedelta(days=days)
    with SessionLocal() as db:
        res = db.execute(delete(AgentExecutionLog).where(AgentExecutionLog.created_at < cutoff))
        db.commit()
        return res.rowcount or 0
