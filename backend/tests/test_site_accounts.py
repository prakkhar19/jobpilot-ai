"""Careers-portal accounts the extension creates, and finding their verification emails."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from email.utils import format_datetime

from sqlalchemy import select

from app.adapters.job_sources.email_alerts import (
    EmailAlertsAdapter,
    find_verification,
    verification_match_key,
)
from tests.conftest import PASSWORD, make_client


def _token(anon, email: str = "alex@example.com") -> dict:
    r = anon.post("/api/ext/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_site_account_roundtrip_encrypted_and_isolated(client, anon, app):
    h = _token(anon)
    host = "acme.wd3.myworkdayjobs.com"
    assert anon.get(f"/api/ext/site-account?host={host}", headers=h).json() == {"exists": False}
    assert anon.put("/api/ext/site-account", headers=h,
                    json={"host": host, "email": "alex@example.com", "password": "S3cret!pass"}).status_code == 204
    got = anon.get(f"/api/ext/site-account?host={host}", headers=h).json()
    assert got == {"exists": True, "email": "alex@example.com", "password": "S3cret!pass", "verified": False}

    from app.core.database import SessionLocal
    from app.models import SiteAccount

    with SessionLocal() as db:
        row = db.scalar(select(SiteAccount).where(SiteAccount.host == host))
        assert "S3cret" not in row.password_encrypted

    make_client(app, "blake@example.com", "Blake")
    other = _token(anon, "blake@example.com")
    assert anon.get(f"/api/ext/site-account?host={host}", headers=other).json() == {"exists": False}


def test_verification_without_mailbox(client, anon):
    h = _token(anon)
    assert anon.get("/api/ext/verification?host=acme.example.com", headers=h).json() == {"error": "no_mailbox"}


def test_match_key_uses_tenant_host_on_shared_platforms():
    assert verification_match_key("acme.wd3.myworkdayjobs.com") == "acme.wd3.myworkdayjobs.com"
    assert verification_match_key("careers.acme.co.in") == "acme.co.in"


class _Mailbox:
    def __init__(self, messages: list[EmailMessage]) -> None:
        self.messages = messages

    def __call__(self, host, port, timeout=None):  # noqa: ANN001 - stands in for imaplib.IMAP4_SSL
        return self

    def login(self, u, p):  # noqa: ANN001
        return "OK", []

    def select(self, box, readonly=False):  # noqa: ANN001
        assert readonly
        return "OK", [b"1"]

    def search(self, charset, *criteria):  # noqa: ANN001
        return "OK", [b" ".join(str(i + 1).encode() for i in range(len(self.messages)))]

    def fetch(self, msg_id, parts):  # noqa: ANN001
        assert "PEEK" in parts
        return "OK", [(b"1", self.messages[int(msg_id) - 1].as_bytes())]

    def logout(self):
        return "OK", []


def _mail(sender: str, subject: str, html: str, minutes_ago: int = 1) -> EmailMessage:
    m = EmailMessage()
    m["From"], m["Subject"] = sender, subject
    m["Date"] = format_datetime(datetime.now(UTC) - timedelta(minutes=minutes_ago))
    m.set_content("see html")
    m.add_alternative(html, subtype="html")
    return m


def test_find_verification_link_for_the_right_tenant(monkeypatch):
    import app.adapters.job_sources.email_alerts as ea

    box = _Mailbox([
        _mail("Workday <noreply@myworkday.com>", "Verify your account",
              '<a href="https://other.wd1.myworkdayjobs.com/activate?t=1">Verify</a>'),
        _mail("Workday <noreply@myworkday.com>", "Verify your account",
              '<a href="https://acme.wd3.myworkdayjobs.com/en-US/careers/activate/abc">Verify Account</a>'),
        _mail("Old <noreply@myworkday.com>", "Verify", '<a href="https://acme.wd3.myworkdayjobs.com/activate/old">x</a>',
              minutes_ago=90),
    ])
    monkeypatch.setattr(ea.imaplib, "IMAP4_SSL", box)
    monkeypatch.setattr(ea, "validate_url", lambda url, **k: url)
    adapter = EmailAlertsAdapter(credentials={"username": "me@gmail.com", "password": "x"})
    since = datetime.now(UTC) - timedelta(minutes=15)
    assert find_verification(adapter, "acme.wd3.myworkdayjobs.com", since)["url"].endswith("/activate/abc")
    assert find_verification(adapter, "nobody.wd5.myworkdayjobs.com", since) == {}


def test_find_verification_code(monkeypatch):
    import app.adapters.job_sources.email_alerts as ea

    box = _Mailbox([_mail("Careers <no-reply@acme.co.in>", "Confirm your email",
                          "<p>Your verification code is 482913. It expires in 10 minutes.</p>")])
    monkeypatch.setattr(ea.imaplib, "IMAP4_SSL", box)
    monkeypatch.setattr(ea, "validate_url", lambda url, **k: url)
    adapter = EmailAlertsAdapter(credentials={"username": "me@gmail.com", "password": "x"})
    res = find_verification(adapter, "careers.acme.co.in", datetime.now(UTC) - timedelta(minutes=15))
    assert res["code"] == "482913"


def test_site_accounts_listed_on_the_website(client, anon):
    h = _token(anon)
    anon.put("/api/ext/site-account", headers=h, json={"host": "careers.acme.com", "email": "alex@example.com",
                                                        "password": "Xy7!longpass"})
    rows = client.get("/api/site-accounts").json()
    assert [(r["host"], r["password"]) for r in rows] == [("careers.acme.com", "Xy7!longpass")]
