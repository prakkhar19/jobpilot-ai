from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Response
from sqlalchemy import text

from app.api.deps import DB
from app.core.config import get_settings

router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("")
def liveness() -> dict:
    return {"status": "ok", "time": datetime.now(UTC).isoformat()}


@router.get("/ready")
def readiness(db: DB, response: Response) -> dict:
    checks: dict[str, str] = {}
    try:
        db.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:  # noqa: BLE001
        checks["database"] = f"error: {type(exc).__name__}"
    if get_settings().environment != "test":
        try:
            import redis

            redis.Redis.from_url(get_settings().redis_url, socket_timeout=2).ping()
            checks["redis"] = "ok"
        except Exception as exc:  # noqa: BLE001
            checks["redis"] = f"error: {type(exc).__name__}"
    ok = all(v == "ok" for v in checks.values())
    if not ok:
        response.status_code = 503
    return {"status": "ok" if ok else "degraded", "checks": checks}
