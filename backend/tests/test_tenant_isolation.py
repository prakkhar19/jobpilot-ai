from __future__ import annotations

from sqlalchemy import select

from app.core.database import SessionLocal, bind_tenant
from app.models import Job, User
from tests.conftest import import_job, upload_and_approve


def test_cross_tenant_access_returns_404(client, other_client):
    prof = upload_and_approve(client)
    job = import_job(client)
    rv = client.post("/api/resume-versions", json={"job_id": job["id"], "use_llm": False}).json()
    cl = client.post("/api/cover-letters", json={"job_id": job["id"], "use_llm": False}).json()
    rid = client.get("/api/resumes").json()[0]["id"]
    app_ = client.post("/api/applications/track", json={"job_id": job["id"]}).json()
    client.post("/api/ai-providers", json={"name": "k", "provider": "openai_compatible", "model": "m",
                                           "api_key": "sk-secret-abcdef123456"})
    provider_id = client.get("/api/ai-providers").json()[0]["id"]

    gets = [f"/api/profiles/{prof['id']}", f"/api/jobs/{job['id']}", f"/api/resume-versions/{rv['id']}",
            f"/api/resume-versions/{rv['id']}/download/pdf", f"/api/cover-letters/{cl['id']}",
            f"/api/resumes/{rid}/download", f"/api/applications/{app_['id']}", f"/api/applications/{app_['id']}/events"]
    for url in gets:
        assert other_client.get(url).status_code == 404, url
    mutations = [
        ("put", f"/api/profiles/{prof['id']}", {"json": {"full_name": "Hacker"}}),
        ("post", f"/api/profiles/{prof['id']}/approve", {}),
        ("delete", f"/api/jobs/{job['id']}", {}),
        ("put", f"/api/cover-letters/{cl['id']}", {"json": {"content": "x" * 50}}),
        ("post", f"/api/applications/{app_['id']}/status", {"json": {"status": "withdrawn"}}),
        ("delete", f"/api/ai-providers/{provider_id}", {}),
        ("post", f"/api/ai-providers/{provider_id}/test", {}),
        ("post", "/api/resume-versions", {"json": {"job_id": job["id"], "use_llm": False}}),
    ]
    for method, url, kw in mutations:
        assert getattr(other_client, method)(url, **kw).status_code in (404, 409), url
    # listings are empty for the other user
    for url in ("/api/jobs", "/api/applications"):
        assert other_client.get(url).json()["total"] == 0
    for url in ("/api/resumes", "/api/profiles", "/api/resume-versions", "/api/cover-letters", "/api/ai-providers"):
        assert other_client.get(url).json() == [], url
    # owner still sees everything intact
    assert client.get(f"/api/profiles/{prof['id']}").json()["full_name"] == "Jordan Rivera"


def test_orm_tenant_hook_filters_unscoped_queries(client, other_client):
    upload_and_approve(client)
    import_job(client)
    with SessionLocal() as db:
        owner = db.scalar(select(User).where(User.email == "alex@example.com"))
        other = db.scalar(select(User).where(User.email == "blair@example.com"))
        assert len(db.scalars(select(Job)).all()) == 1  # unbound session sees all (system use)
        bind_tenant(db, other.id)
        assert db.scalars(select(Job)).all() == []  # query with no WHERE clause still isolated
        bind_tenant(db, owner.id)
        assert len(db.scalars(select(Job)).all()) == 1


def test_api_keys_encrypted_and_never_returned(client):
    secret = "sk-supersecret-value-123456"
    client.post("/api/ai-providers", json={"name": "k", "provider": "openai_compatible", "model": "m", "api_key": secret})
    listing = client.get("/api/ai-providers")
    assert secret not in listing.text
    from app.models import AIProviderConfiguration

    with SessionLocal() as db:
        row = db.scalars(select(AIProviderConfiguration)).one()
        assert secret not in row.api_key_encrypted and row.api_key_encrypted
    export = client.get("/api/account/export")
    assert export.status_code == 200 and secret.encode() not in export.content


def test_secret_redaction_in_logs():
    from app.core.logging import redact

    out = redact("Authorization: Bearer abcdefghijklmnop api_key=sk-live-1234567890 password=hunter2hunter2")
    assert "abcdefghijklmnop" not in out and "sk-live-1234567890" not in out and "hunter2" not in out


def test_admin_endpoints_require_admin(client, other_client):
    assert client.get("/api/admin/users").status_code == 200
    assert other_client.get("/api/admin/users").status_code == 403


def test_account_deletion_removes_all_data(client, other_client):
    from tests.conftest import PASSWORD

    upload_and_approve(client)
    import_job(client)
    assert client.post("/api/auth/delete-account", json={"password": PASSWORD, "confirm": "DELETE"}).status_code == 204
    with SessionLocal() as db:
        assert db.scalars(select(Job)).all() == []
    assert other_client.get("/api/auth/me").status_code == 200  # other users unaffected
