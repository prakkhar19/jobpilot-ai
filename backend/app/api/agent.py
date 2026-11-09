from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Query, Response
from sqlalchemy import func, select, update

from app.agents.runner import ACTIVE_STATES, enqueue_run, get_config, request_cancel
from app.api.deps import DB, CurrentUser, get_owned_or_404
from app.core.errors import DomainError
from app.documents.render import TEMPLATES
from app.models import AgentExecutionLog, AgentTask, AuditLog, Notification
from app.schemas.agent import AgentConfigIn, AgentConfigOut, AgentLogOut, AgentTaskOut, NotificationOut
from app.services.analytics import summary, weekly_report
from app.services.audit import audit
from app.services.matching import DEFAULT_WEIGHTS, normalize_weights

router = APIRouter(prefix="/api", tags=["agent"])


def _cfg_out(cfg) -> AgentConfigOut:  # noqa: ANN001
    out = AgentConfigOut.model_validate(cfg)
    out.effective_weights = normalize_weights(cfg.matching_weights)
    return out


@router.get("/agent/config", response_model=AgentConfigOut)
def get_agent_config(db: DB, user: CurrentUser) -> AgentConfigOut:
    cfg = get_config(db, user.id)
    db.commit()
    return _cfg_out(cfg)


@router.put("/agent/config", response_model=AgentConfigOut)
def put_agent_config(body: AgentConfigIn, db: DB, user: CurrentUser) -> AgentConfigOut:
    cfg = get_config(db, user.id)
    if body.resume_template not in TEMPLATES:
        raise DomainError("Unknown resume template.")
    unknown = set(body.matching_weights) - set(DEFAULT_WEIGHTS)
    if unknown:
        raise DomainError(f"Unknown matching weight(s): {', '.join(sorted(unknown))}")
    if body.application_mode == "authorized" and not (body.acknowledge_authorized_automation or cfg.authorized_automation_ack_at):
        raise DomainError("Authorized automation requires explicit acknowledgement.")
    data = body.model_dump(exclude={"acknowledge_authorized_automation"})
    schedule_changed = any(getattr(cfg, k) != data[k] for k in ("enabled", "frequency_hours", "run_days"))
    for k, v in data.items():
        setattr(cfg, k, v)
    if body.application_mode == "authorized" and body.acknowledge_authorized_automation and not cfg.authorized_automation_ack_at:
        cfg.authorized_automation_ack_at = datetime.now(UTC)
        audit(db, user.id, "agent.authorized_automation_enabled")
    if body.application_mode != "authorized":
        cfg.authorized_automation_ack_at = None
    if schedule_changed:
        cfg.next_run_at = None
    audit(db, user.id, "agent.config_updated")
    db.commit()
    return _cfg_out(cfg)


@router.post("/agent/run", response_model=AgentTaskOut, status_code=202)
def run_now(db: DB, user: CurrentUser) -> AgentTaskOut:
    return AgentTaskOut.model_validate(enqueue_run(db, user, trigger="manual"))


@router.post("/agent/pause", response_model=AgentConfigOut)
def pause(db: DB, user: CurrentUser) -> AgentConfigOut:
    cfg = get_config(db, user.id)
    cfg.paused = True
    running = db.scalars(select(AgentTask).where(AgentTask.user_id == user.id, AgentTask.state.in_(ACTIVE_STATES))).all()
    for t in running:
        request_cancel(db, user, t)
    db.commit()
    return _cfg_out(cfg)


@router.post("/agent/resume", response_model=AgentConfigOut)
def resume(db: DB, user: CurrentUser) -> AgentConfigOut:
    cfg = get_config(db, user.id)
    cfg.paused = False
    cfg.next_run_at = None
    db.commit()
    return _cfg_out(cfg)


@router.get("/agent/tasks", response_model=list[AgentTaskOut])
def tasks(db: DB, user: CurrentUser, limit: int = Query(default=30, ge=1, le=200)) -> list[AgentTaskOut]:
    rows = db.scalars(select(AgentTask).where(AgentTask.user_id == user.id).order_by(AgentTask.created_at.desc())
                      .limit(limit)).all()
    return [AgentTaskOut.model_validate(r) for r in rows]


@router.get("/agent/tasks/{task_id}", response_model=AgentTaskOut)
def task_detail(task_id: uuid.UUID, db: DB, user: CurrentUser) -> AgentTaskOut:
    return AgentTaskOut.model_validate(get_owned_or_404(db, AgentTask, task_id, user, "Task"))


@router.post("/agent/tasks/{task_id}/cancel", response_model=AgentTaskOut)
def cancel(task_id: uuid.UUID, db: DB, user: CurrentUser) -> AgentTaskOut:
    task = get_owned_or_404(db, AgentTask, task_id, user, "Task")
    return AgentTaskOut.model_validate(request_cancel(db, user, task))


@router.get("/agent/logs", response_model=list[AgentLogOut])
def logs(db: DB, user: CurrentUser, task_id: uuid.UUID | None = None, level: str = "",
         limit: int = Query(default=200, ge=1, le=1000)) -> list[AgentLogOut]:
    q = select(AgentExecutionLog).where(AgentExecutionLog.user_id == user.id)
    if task_id:
        q = q.where(AgentExecutionLog.task_id == task_id)
    if level:
        q = q.where(AgentExecutionLog.level == level)
    rows = db.scalars(q.order_by(AgentExecutionLog.created_at.desc()).limit(limit)).all()
    return [AgentLogOut.model_validate(r) for r in rows]


# ---------------------------------------------------------------------------------- notifications

@router.get("/notifications", response_model=dict)
def notifications(db: DB, user: CurrentUser, unread_only: bool = False,
                  limit: int = Query(default=50, ge=1, le=200)) -> dict:
    q = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        q = q.where(Notification.read_at.is_(None))
    rows = db.scalars(q.order_by(Notification.created_at.desc()).limit(limit)).all()
    unread = db.scalar(select(func.count(Notification.id)).where(Notification.user_id == user.id,
                                                                 Notification.read_at.is_(None))) or 0
    return {"items": [NotificationOut.model_validate(r).model_dump(mode="json") for r in rows], "unread": unread}


@router.post("/notifications/{nid}/read", status_code=204)
def mark_read(nid: uuid.UUID, db: DB, user: CurrentUser) -> Response:
    n = get_owned_or_404(db, Notification, nid, user, "Notification")
    n.read_at = n.read_at or datetime.now(UTC)
    db.commit()
    return Response(status_code=204)


@router.post("/notifications/read-all", status_code=204)
def mark_all_read(db: DB, user: CurrentUser) -> Response:
    db.execute(update(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))
               .values(read_at=datetime.now(UTC)))
    db.commit()
    return Response(status_code=204)


# -------------------------------------------------------------------------------------- analytics

@router.get("/analytics/summary")
def analytics_summary(db: DB, user: CurrentUser) -> dict:
    return summary(db, user)


@router.get("/analytics/weekly-report")
def analytics_weekly(db: DB, user: CurrentUser) -> dict:
    return weekly_report(db, user)


@router.get("/audit-log")
def audit_log(db: DB, user: CurrentUser, limit: int = Query(default=100, ge=1, le=500)) -> list[dict]:
    rows = db.scalars(select(AuditLog).where(AuditLog.user_id == user.id).order_by(AuditLog.created_at.desc()).limit(limit)).all()
    return [{"id": str(r.id), "action": r.action, "target_type": r.target_type, "target_id": r.target_id,
             "ip_address": r.ip_address, "data": r.data, "created_at": r.created_at.isoformat()} for r in rows]
