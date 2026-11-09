from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.core.logging import redact_mapping
from app.models import AuditLog, Notification


def audit(
    db: Session,
    user_id: uuid.UUID,
    action: str,
    *,
    target_type: str = "",
    target_id: object = "",
    ip: str = "",
    data: dict | None = None,
) -> None:
    db.add(
        AuditLog(
            user_id=user_id,
            action=action,
            target_type=target_type,
            target_id=str(target_id or ""),
            ip_address=ip,
            data=redact_mapping(data or {}),
        )
    )


def notify(db: Session, user_id: uuid.UUID, title: str, body: str = "", *, kind: str = "info", link: str = "") -> None:
    db.add(Notification(user_id=user_id, title=title[:300], body=body, kind=kind, link=link))
