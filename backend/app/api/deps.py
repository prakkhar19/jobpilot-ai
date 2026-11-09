"""Shared FastAPI dependencies: DB session, current user, CSRF, tenant binding."""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import SessionLocal, bind_tenant
from app.core.errors import not_found
from app.models import User, UserSession
from app.security.tokens import constant_time_equals, csrf_for_session, hash_token

SESSION_COOKIE = "jp_session"
CSRF_COOKIE = "jp_csrf"
CSRF_HEADER = "x-csrf-token"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}

def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


DB = Annotated[Session, Depends(get_db)]


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def resolve_session(db: Session, token: str | None) -> tuple[UserSession, User] | None:
    if not token or len(token) > 200:
        return None
    sess = db.scalar(select(UserSession).where(UserSession.token_hash == hash_token(token)))
    if sess is None or sess.revoked_at is not None:
        return None
    now = datetime.now(UTC)
    s = get_settings()
    if _aware(sess.expires_at) < now:
        return None
    if _aware(sess.last_seen_at) < now - timedelta(hours=s.session_idle_timeout_hours):
        return None
    user = db.get(User, sess.user_id)
    if user is None or not user.is_active:
        return None
    if now - _aware(sess.last_seen_at) > timedelta(minutes=5):
        sess.last_seen_at = now
        db.commit()
    return sess, user


def get_current_user(request: Request, db: DB) -> User:
    token = request.cookies.get(SESSION_COOKIE)
    resolved = resolve_session(db, token)
    if resolved is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    sess, user = resolved
    if request.method not in SAFE_METHODS:
        header = request.headers.get(CSRF_HEADER, "")
        expected = csrf_for_session(token or "")
        if not header or not constant_time_equals(header, expected):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "CSRF token missing or invalid")
    request.state.user_id = user.id
    request.state.session_id = sess.id
    # From here on, every ORM query on this session is restricted to this user's rows.
    bind_tenant(db, user.id)
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_admin(user: CurrentUser) -> User:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Administrator role required")
    return user


AdminUser = Annotated[User, Depends(require_admin)]


def get_owned_or_404[T](db: Session, model: type[T], obj_id: uuid.UUID, user: User, what: str = "Resource") -> T:
    obj = db.get(model, obj_id)
    if obj is None or getattr(obj, "user_id", None) != user.id:
        raise not_found(what)
    return obj


def client_ip(request: Request) -> str:
    return (request.client.host if request.client else "")[:64]
