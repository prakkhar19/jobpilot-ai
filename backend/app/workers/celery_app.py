"""Celery application: background worker + beat schedule."""

from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from app.core.config import get_settings

settings = get_settings()

celery_app = Celery("jobpilot", broker=settings.redis_url, include=["app.workers.tasks"])
celery_app.conf.update(
    task_always_eager=settings.celery_eager,
    task_eager_propagates=False,
    task_ignore_result=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=50,
    worker_hijack_root_logger=False,
    broker_connection_retry_on_startup=True,
    timezone="UTC",
    task_time_limit=60 * 60,
    task_soft_time_limit=55 * 60,
    beat_schedule={
        "agent-tick": {"task": "jobpilot.agent_tick", "schedule": 60.0},
        "heartbeat-scheduler": {"task": "jobpilot.scheduler_heartbeat", "schedule": 30.0},
        "verify-jobs": {"task": "jobpilot.verify_jobs", "schedule": 6 * 3600.0},
        "weekly-report": {"task": "jobpilot.weekly_reports", "schedule": crontab(day_of_week="mon", hour=8, minute=0)},
        "retention": {"task": "jobpilot.retention", "schedule": crontab(hour=3, minute=30)},
    },
)
