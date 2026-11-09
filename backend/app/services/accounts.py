"""Account lifecycle: registration, login, sessions, password reset, deletion."""

from __future__ import annotations

import logging
import shutil
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import DomainError
from app.models import AgentConfiguration, PasswordResetToken, User, UserSession
from app.security.passwords import (
    DUMMY_HASH,
    hash_password,
    needs_rehash,
    validate_password_strength,
    verify_password,
)
from app.security.tokens import hash_token, new_token
from app.services.audit import audit
from app.services.mailer import send_email, smtp_configured

log = logging.getLogger(__name__)

LOCKOUT_THRESHOLD = 8
LOCKOUT_MINUTES = 15


def registration_open(db: Session) -> bool:
    s = get_settings()
    if not s.allow_registration:
        return db.scalar(select(func.count(User.id))) == 0
    if s.single_user_mode:
        return db.scalar(select(func.count(User.id))) == 0
    return True


def register(db: Session, email: str, password: str, full_name: str, ip: str = "") -> User:
    email = email.strip().lower()
    if not registration_open(db):
        raise DomainError("Registration is closed on this installation.", status_code=403)
    problems = validate_password_strength(password)
    if problems:
        raise DomainError(" ".join(problems))
    if db.scalar(select(User.id).where(User.email == email)):
        raise DomainError("An account with this email already exists.", status_code=409)
    is_first = db.scalar(select(func.count(User.id))) == 0
    user = User(
        email=email,
        password_hash=hash_password(password),
        full_name=full_name.strip(),
        role="admin" if is_first else "user",
    )
    db.add(user)
    db.flush()
    db.add(AgentConfiguration(user_id=user.id))
    audit(db, user.id, "account.registered", ip=ip)
    db.commit()
    return user


def authenticate(db: Session, email: str, password: str, ip: str = "") -> User:
    email = email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    generic = DomainError("Invalid email or password.", status_code=401)
    if user is None:
        verify_password(DUMMY_HASH, password)  # equalise timing
        raise generic
    now = datetime.now(UTC)
    if user.locked_until and _aware(user.locked_until) > now:
        raise DomainError("Too many failed attempts. Try again later.", status_code=429)
    if not verify_password(user.password_hash, password) or not user.is_active:
        user.failed_login_count += 1
        if user.failed_login_count >= LOCKOUT_THRESHOLD:
            user.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
            user.failed_login_count = 0
        audit(db, user.id, "auth.login_failed", ip=ip)
        db.commit()
        raise generic
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = now
    audit(db, user.id, "auth.login", ip=ip)
    db.commit()
    return user


def create_session(db: Session, user: User, ip: str, user_agent: str) -> str:
    token = new_token()
    s = get_settings()
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=hash_token(token),
            expires_at=datetime.now(UTC) + timedelta(hours=s.session_ttl_hours),
            ip_address=ip[:64],
            user_agent=(user_agent or "")[:300],
        )
    )
    db.commit()
    return token


def revoke_session(db: Session, token: str) -> None:
    db.execute(
        update(UserSession)
        .where(UserSession.token_hash == hash_token(token))
        .values(revoked_at=datetime.now(UTC))
    )
    db.commit()


def revoke_all_sessions(db: Session, user_id: uuid.UUID, except_id: uuid.UUID | None = None) -> None:
    stmt = update(UserSession).where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
    if except_id:
        stmt = stmt.where(UserSession.id != except_id)
    db.execute(stmt.values(revoked_at=datetime.now(UTC)))


def change_password(db: Session, user: User, current: str, new: str, current_session_id: uuid.UUID) -> None:
    if not verify_password(user.password_hash, current):
        raise DomainError("Current password is incorrect.", status_code=400)
    problems = validate_password_strength(new)
    if problems:
        raise DomainError(" ".join(problems))
    user.password_hash = hash_password(new)
    revoke_all_sessions(db, user.id, except_id=current_session_id)
    audit(db, user.id, "account.password_changed")
    db.commit()


def request_password_reset(db: Session, email: str) -> str | None:
    """Create a reset token and deliver it. Returns the raw token only for the CLI/tests."""
    user = db.scalar(select(User).where(User.email == email.strip().lower()))
    if user is None or not user.is_active:
        return None
    token = new_token()
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=hash_token(token),
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
    )
    audit(db, user.id, "account.password_reset_requested")
    db.commit()
    s = get_settings()
    link = f"{s.public_base_url.rstrip('/')}/reset-password?token={token}"
    if smtp_configured():
        send_email(user.email, "Reset your JobPilot AI password", f"Use this link within 1 hour:\n\n{link}\n")
    elif s.password_reset_log_links and s.environment != "production":
        # Development only — never enabled in production.
        log.warning("Password reset link generated (dev mode)", extra={"ctx": {"link_path": "/reset-password"}})
        print(f"[dev] password reset link: {link}", flush=True)  # noqa: T201
    return token


def confirm_password_reset(db: Session, token: str, new_password: str) -> None:
    row = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_token(token)))
    if row is None or row.used_at is not None or _aware(row.expires_at) < datetime.now(UTC):
        raise DomainError("This reset link is invalid or has expired.")
    problems = validate_password_strength(new_password)
    if problems:
        raise DomainError(" ".join(problems))
    user = db.get(User, row.user_id)
    if user is None:
        raise DomainError("This reset link is invalid or has expired.")
    user.password_hash = hash_password(new_password)
    user.failed_login_count = 0
    user.locked_until = None
    row.used_at = datetime.now(UTC)
    revoke_all_sessions(db, user.id)
    audit(db, user.id, "account.password_reset")
    db.commit()


def delete_account(db: Session, user: User) -> None:
    """Hard-delete the user and every owned row (FK cascades) and their files."""
    s = get_settings()
    uid = user.id
    db.execute(delete(User).where(User.id == uid))
    db.commit()
    for base in (s.uploads_dir, s.generated_dir, s.screenshots_dir, s.data_dir / "browser"):
        target = (base / str(uid)).resolve()
        if target.exists() and base.resolve() in target.parents:
            shutil.rmtree(target, ignore_errors=True)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)
