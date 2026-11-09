from __future__ import annotations

from app.cli import main
from tests.conftest import ApiClient


def test_seed_demo_creates_ready_candidate(app, live_server, capsys):
    assert main(["seed-demo", "demo@example.com", "Demo-Password-123"]) == 0
    c = ApiClient(app)
    r = c.post("/api/auth/login", json={"email": "demo@example.com", "password": "Demo-Password-123"})
    assert r.status_code == 200
    me = r.json()["user"]
    assert me["onboarding_completed"] is True
    prof = c.get("/api/profiles/active").json()
    assert prof["status"] == "approved" and prof["full_name"] == "Avery Demo"
    assert c.get("/api/jobs").json()["total"] >= 2  # eager discovery ran


def test_reset_password_cli(client, capsys):
    assert main(["reset-password", "alex@example.com"]) == 0
    assert "/reset-password?token=" in capsys.readouterr().out
    assert main(["reset-password", "nobody@example.com"]) == 1


def test_list_users_and_set_role(client, other_client, capsys):
    assert main(["set-role", "blair@example.com", "admin"]) == 0
    assert main(["list-users"]) == 0
    out = capsys.readouterr().out
    assert "blair@example.com\tadmin" in out
