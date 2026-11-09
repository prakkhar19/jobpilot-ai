from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import select

from app.api.deps import CSRF_COOKIE, DB, SESSION_COOKIE, CurrentUser, client_ip, resolve_session
from app.core.config import get_settings
from app.core.errors import DomainError
from app.core.ratelimit import limiter
from app.models import UserSession
from app.schemas.auth import (
    AuthStatus,
    ChangePasswordIn,
    DeleteAccountIn,
    LoginIn,
    RegisterIn,
    ResetConfirmIn,
    ResetRequestIn,
    SessionOut,
    UserOut,
    UserUpdate,
)
from app.security.passwords import verify_password
from app.security.tokens import csrf_for_session
from app.services import accounts
from app.services.audit import audit

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _set_cookies(response: Response, token: str) -> str:
    s = get_settings()
    csrf = csrf_for_session(token)
    max_age = s.session_ttl_hours * 3600
    response.set_cookie(
        SESSION_COOKIE, token, max_age=max_age, httponly=True, secure=s.cookie_secure, samesite="lax", path="/"
    )
    response.set_cookie(
        CSRF_COOKIE, csrf, max_age=max_age, httponly=False, secure=s.cookie_secure, samesite="strict", path="/"
    )
    return csrf


def _clear_cookies(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")


def _wrap(exc: DomainError) -> HTTPException:
    return HTTPException(exc.status_code, exc.message)


@router.get("/status", response_model=AuthStatus)
def auth_status(request: Request, db: DB) -> AuthStatus:
    s = get_settings()
    token = request.cookies.get(SESSION_COOKIE)
    resolved = resolve_session(db, token)
    return AuthStatus(
        user=UserOut.model_validate(resolved[1]) if resolved else None,
        csrf_token=csrf_for_session(token) if resolved and token else None,
        registration_open=accounts.registration_open(db),
        single_user_mode=s.single_user_mode,
        demo_mode=s.demo_mode,
    )


@router.post("/register", response_model=AuthStatus, status_code=201)
def register(body: RegisterIn, request: Request, response: Response, db: DB) -> AuthStatus:
    ip = client_ip(request)
    if not limiter.hit(f"register:{ip}", get_settings().rate_limit_register_per_hour, 3600):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many registrations. Try again later.")
    try:
        user = accounts.register(db, body.email, body.password, body.full_name, ip)
    except DomainError as exc:
        raise _wrap(exc) from exc
    token = accounts.create_session(db, user, ip, request.headers.get("user-agent", ""))
    csrf = _set_cookies(response, token)
    return AuthStatus(
        user=UserOut.model_validate(user),
        csrf_token=csrf,
        registration_open=accounts.registration_open(db),
        single_user_mode=get_settings().single_user_mode,
        demo_mode=get_settings().demo_mode,
    )


@router.post("/login", response_model=AuthStatus)
def login(body: LoginIn, request: Request, response: Response, db: DB) -> AuthStatus:
    ip = client_ip(request)
    s = get_settings()
    if not limiter.hit(f"login:{ip}", s.rate_limit_login_per_minute, 60) or not limiter.hit(
        f"login-email:{body.email.lower()}", s.rate_limit_login_per_minute, 60
    ):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many login attempts. Try again in a minute.")
    try:
        user = accounts.authenticate(db, body.email, body.password, ip)
    except DomainError as exc:
        raise _wrap(exc) from exc
    token = accounts.create_session(db, user, ip, request.headers.get("user-agent", ""))
    csrf = _set_cookies(response, token)
    return AuthStatus(
        user=UserOut.model_validate(user),
        csrf_token=csrf,
        registration_open=accounts.registration_open(db),
        single_user_mode=s.single_user_mode,
        demo_mode=s.demo_mode,
    )


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: DB, user: CurrentUser) -> Response:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        accounts.revoke_session(db, token)
    response = Response(status_code=204)
    _clear_cookies(response)
    return response


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)


@router.patch("/me", response_model=UserOut)
def update_me(body: UserUpdate, db: DB, user: CurrentUser) -> UserOut:
    if body.full_name is not None:
        user.full_name = body.full_name.strip()
    if body.onboarding_completed is not None:
        user.onboarding_completed = body.onboarding_completed
    db.commit()
    return UserOut.model_validate(user)


@router.post("/change-password", status_code=204)
def change_password(body: ChangePasswordIn, request: Request, db: DB, user: CurrentUser) -> Response:
    try:
        accounts.change_password(db, user, body.current_password, body.new_password, request.state.session_id)
    except DomainError as exc:
        raise _wrap(exc) from exc
    return Response(status_code=204)


@router.post("/password-reset/request", status_code=202)
def password_reset_request(body: ResetRequestIn, request: Request, db: DB) -> dict:
    if not limiter.hit(f"reset:{client_ip(request)}", 5, 3600):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many reset requests.")
    accounts.request_password_reset(db, body.email)
    # Same response whether or not the account exists (no account enumeration).
    return {
        "detail": "If an account exists for that email, a reset link has been sent. "
        "Self-hosted without email? An administrator can run `make reset-password EMAIL=...`."
    }


@router.post("/password-reset/confirm", status_code=204)
def password_reset_confirm(body: ResetConfirmIn, db: DB) -> Response:
    try:
        accounts.confirm_password_reset(db, body.token, body.new_password)
    except DomainError as exc:
        raise _wrap(exc) from exc
    return Response(status_code=204)


@router.get("/sessions", response_model=list[SessionOut])
def list_sessions(request: Request, db: DB, user: CurrentUser) -> list[SessionOut]:
    rows = db.scalars(
        select(UserSession)
        .where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None))
        .order_by(UserSession.last_seen_at.desc())
    ).all()
    out = []
    for r in rows:
        item = SessionOut.model_validate(r)
        item.current = r.id == request.state.session_id
        out.append(item)
    return out


@router.delete("/sessions/{session_id}", status_code=204)
def revoke_session(session_id: str, request: Request, db: DB, user: CurrentUser) -> Response:
    import uuid as _uuid
    from datetime import UTC, datetime

    try:
        sid = _uuid.UUID(session_id)
    except ValueError as exc:
        raise HTTPException(404, "Session not found") from exc
    row = db.get(UserSession, sid)
    if row is None or row.user_id != user.id:
        raise HTTPException(404, "Session not found")
    row.revoked_at = datetime.now(UTC)
    db.commit()
    return Response(status_code=204)


@router.post("/sessions/revoke-others", status_code=204)
def revoke_other_sessions(request: Request, db: DB, user: CurrentUser) -> Response:
    accounts.revoke_all_sessions(db, user.id, except_id=request.state.session_id)
    db.commit()
    return Response(status_code=204)


@router.post("/delete-account", status_code=204)
def delete_account(body: DeleteAccountIn, request: Request, db: DB, user: CurrentUser) -> Response:
    if body.confirm != "DELETE":
        raise HTTPException(400, "Type DELETE to confirm account deletion.")
    if not verify_password(user.password_hash, body.password):
        raise HTTPException(400, "Password is incorrect.")
    audit(db, user.id, "account.delete_requested", ip=client_ip(request))
    db.commit()
    db.info["tenant_id"] = None
    accounts.delete_account(db, user)
    response = Response(status_code=204)
    _clear_cookies(response)
    return response


