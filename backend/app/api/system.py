"""Account data export, diagnostics and administration."""

from __future__ import annotations

import platform
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Response
from sqlalchemy import func, select, text

from app.adapters.application_providers import PROVIDERS
from app.adapters.job_sources import UNSUPPORTED_PLATFORMS
from app.api.deps import DB, AdminUser, CurrentUser
from app.core.config import get_settings
from app.core.errors import DomainError
from app.models import AgentTask, AIProviderConfiguration, JobSource, User, WorkerHeartbeat
from app.services.accounts import revoke_all_sessions
from app.services.audit import audit
from app.services.export import export_user

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/account/export")
def export(db: DB, user: CurrentUser) -> Response:
    data = export_user(db, user)
    audit(db, user.id, "account.exported")
    db.commit()
    name = f"jobpilot-export-{datetime.now(UTC).strftime('%Y%m%d')}.zip"
    return Response(data, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{name}"'})


def _hb(db: DB, name: str) -> dict:
    row = db.get(WorkerHeartbeat, name)
    if row is None:
        return {"status": "unknown", "last_seen_at": None}
    seen = row.last_seen_at if row.last_seen_at.tzinfo else row.last_seen_at.replace(tzinfo=UTC)
    age = (datetime.now(UTC) - seen).total_seconds()
    return {"status": "ok" if age < 180 else "stale", "last_seen_at": seen.isoformat(), "age_seconds": int(age)}


@router.get("/diagnostics")
def diagnostics(db: DB, user: CurrentUser) -> dict:
    s = get_settings()
    checks: dict = {}
    try:
        db.execute(text("SELECT 1"))
        checks["database"] = {"status": "ok"}
    except Exception as exc:  # noqa: BLE001
        checks["database"] = {"status": "error", "detail": type(exc).__name__}
    if s.environment != "test":
        try:
            import redis

            redis.Redis.from_url(s.redis_url, socket_timeout=2).ping()
            checks["redis"] = {"status": "ok"}
        except Exception as exc:  # noqa: BLE001
            checks["redis"] = {"status": "error", "detail": type(exc).__name__}
    checks["worker"] = _hb(db, "worker")
    checks["scheduler"] = _hb(db, "scheduler")
    sources = db.scalars(select(JobSource).where(JobSource.user_id == user.id)).all()
    providers = db.scalars(select(AIProviderConfiguration).where(AIProviderConfiguration.user_id == user.id)).all()
    since = datetime.now(UTC) - timedelta(days=7)
    failed = db.scalars(select(AgentTask).where(AgentTask.user_id == user.id, AgentTask.state == "FAILED",
                                                AgentTask.created_at >= since).order_by(AgentTask.created_at.desc()).limit(10)).all()
    return {
        "version": "0.1.0",
        "environment": s.environment,
        "python": platform.python_version(),
        "checks": checks,
        "connectors": [{"id": str(x.id), "kind": x.kind, "name": x.display_name, "enabled": x.enabled,
                        "last_status": x.last_status, "last_error": x.last_error,
                        "last_checked_at": x.last_checked_at.isoformat() if x.last_checked_at else None} for x in sources],
        "ai_providers": [{"id": str(p.id), "name": p.name, "provider": p.provider, "model": p.model, "enabled": p.enabled,
                          "errors": p.total_errors, "last_error": p.last_error} for p in providers],
        "recent_failures": [{"id": str(t.id), "error": t.error, "created_at": t.created_at.isoformat()} for t in failed],
        "application_providers": [p.capabilities() for p in PROVIDERS.values()],
        "unsupported_platforms": [{"platform": k, "reason": v} for k, v in UNSUPPORTED_PLATFORMS.items()],
        "settings": {"demo_mode": s.demo_mode, "single_user_mode": s.single_user_mode,
                     "registration": s.allow_registration, "cookie_secure": s.cookie_secure,
                     "max_upload_mb": s.max_upload_mb},
    }


@router.get("/admin/users")
def admin_users(db: DB, admin: AdminUser) -> list[dict]:
    rows = db.scalars(select(User).order_by(User.created_at)).all()
    return [{"id": str(u.id), "email": u.email, "full_name": u.full_name, "role": u.role, "is_active": u.is_active,
             "created_at": u.created_at.isoformat(), "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None}
            for u in rows]


@router.post("/admin/users/{user_id}/active", status_code=204)
def admin_set_active(user_id: uuid.UUID, db: DB, admin: AdminUser, active: bool = True) -> Response:
    if user_id == admin.id:
        raise DomainError("You cannot deactivate your own account.")
    target = db.get(User, user_id)
    if target is None:
        raise DomainError("User not found", status_code=404)
    target.is_active = active
    if not active:
        revoke_all_sessions(db, target.id)
    audit(db, admin.id, "admin.user_active_changed", target_type="user", target_id=user_id, data={"active": active})
    db.commit()
    return Response(status_code=204)


@router.get("/admin/stats")
def admin_stats(db: DB, admin: AdminUser) -> dict:
    return {"users": db.scalar(select(func.count(User.id))) or 0}
