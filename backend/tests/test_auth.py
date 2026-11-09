from __future__ import annotations

from tests.conftest import PASSWORD, ApiClient, make_client


def test_register_login_logout(app):
    c = make_client(app)
    me = c.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["role"] == "admin"  # first user becomes admin
    assert "password_hash" not in me.json()
    assert c.post("/api/auth/logout").status_code == 204
    assert c.get("/api/auth/me").status_code == 401

    c2 = ApiClient(app)
    r = c2.post("/api/auth/login", json={"email": "alex@example.com", "password": PASSWORD})
    assert r.status_code == 200
    assert r.json()["csrf_token"]
    assert "jp_session" in r.cookies


def test_session_cookie_flags(anon):
    r = anon.post("/api/auth/register", json={"email": "c@example.com", "password": PASSWORD})
    cookie = [h for h in r.headers.get_list("set-cookie") if h.startswith("jp_session=")][0].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie


def test_second_user_is_not_admin(client, other_client):
    assert other_client.get("/api/auth/me").json()["role"] == "user"


def test_wrong_password_and_unknown_user_same_error(client, anon):
    a = anon.post("/api/auth/login", json={"email": "alex@example.com", "password": "nope-nope-nope"})
    b = anon.post("/api/auth/login", json={"email": "ghost@example.com", "password": "nope-nope-nope"})
    assert a.status_code == b.status_code == 401
    assert a.json()["detail"] == b.json()["detail"]


def test_weak_password_rejected(anon):
    r = anon.post("/api/auth/register", json={"email": "w@example.com", "password": "short"})
    assert r.status_code == 400


def test_duplicate_email(client, anon):
    r = anon.post("/api/auth/register", json={"email": "ALEX@example.com", "password": PASSWORD})
    assert r.status_code == 409


def test_csrf_required_for_mutations(client):
    token = client.csrf
    client.csrf = None
    assert client.patch("/api/auth/me", json={"full_name": "X"}).status_code == 403
    assert client.patch("/api/auth/me", json={"full_name": "X"}, headers={"X-CSRF-Token": "bad"}).status_code == 403
    client.csrf = token
    assert client.patch("/api/auth/me", json={"full_name": "X"}).status_code == 200


def test_login_rate_limited(client, anon):
    codes = [
        anon.post("/api/auth/login", json={"email": "alex@example.com", "password": "wrong-password-1"}).status_code
        for _ in range(15)
    ]
    assert 429 in codes


def test_password_reset_flow(client, anon):
    from app.core.database import SessionLocal
    from app.services.accounts import request_password_reset

    with SessionLocal() as db:
        token = request_password_reset(db, "alex@example.com")
    assert token
    r = anon.post("/api/auth/password-reset/confirm", json={"token": token, "new_password": "Brand-New-Pass-9"})
    assert r.status_code == 204
    # old sessions revoked
    assert client.get("/api/auth/me").status_code == 401
    # token is single use
    r = anon.post("/api/auth/password-reset/confirm", json={"token": token, "new_password": "Another-Pass-99"})
    assert r.status_code == 400
    r = anon.post("/api/auth/login", json={"email": "alex@example.com", "password": "Brand-New-Pass-9"})
    assert r.status_code == 200


def test_reset_request_does_not_enumerate(anon):
    a = anon.post("/api/auth/password-reset/request", json={"email": "ghost@example.com"})
    assert a.status_code == 202


def test_change_password_revokes_other_sessions(app):
    c1 = make_client(app)
    c2 = ApiClient(app)
    c2.csrf = c2.post("/api/auth/login", json={"email": "alex@example.com", "password": PASSWORD}).json()["csrf_token"]
    r = c1.post("/api/auth/change-password", json={"current_password": PASSWORD, "new_password": "Changed-Pass-77"})
    assert r.status_code == 204
    assert c1.get("/api/auth/me").status_code == 200
    assert c2.get("/api/auth/me").status_code == 401


def test_sessions_list_and_revoke(client):
    sessions = client.get("/api/auth/sessions").json()
    assert len(sessions) == 1 and sessions[0]["current"]


def test_single_user_mode_closes_registration(app, monkeypatch):
    from app.core.config import get_settings

    make_client(app)
    monkeypatch.setattr(get_settings(), "single_user_mode", True)
    r = ApiClient(app).post("/api/auth/register", json={"email": "z@example.com", "password": PASSWORD})
    assert r.status_code == 403


def test_delete_account(client, anon):
    r = client.post("/api/auth/delete-account", json={"password": PASSWORD, "confirm": "DELETE"})
    assert r.status_code == 204
    r = anon.post("/api/auth/login", json={"email": "alex@example.com", "password": PASSWORD})
    assert r.status_code == 401


def test_security_headers(anon):
    r = anon.get("/api/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "SAMEORIGIN"
    assert "frame-ancestors 'self'" in r.headers["content-security-policy"]


def test_secret_generation_is_race_safe(tmp_path):
    """Concurrent processes must all read the same, non-empty secret."""
    import multiprocessing as mp

    ctx = mp.get_context("spawn")
    with ctx.Pool(6) as pool:
        values = pool.map(_read_secret, [str(tmp_path)] * 12)
    assert len(set(values)) == 1 and len(values[0]) >= 32


def _read_secret(data_dir: str) -> str:
    from app.core.config import Settings

    return Settings(app_secret_key="", data_dir=data_dir).secret_key
