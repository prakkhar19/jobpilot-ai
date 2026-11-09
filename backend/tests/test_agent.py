from __future__ import annotations

from datetime import UTC, datetime

from app.agents.runner import is_due, tick
from app.models import AgentConfiguration
from tests.conftest import upload_and_approve


def _setup(client, **cfg_overrides) -> dict:
    upload_and_approve(client, {"Work authorization": "Yes", "Notice period": "2 weeks"})
    client.post("/api/sources", json={"kind": "demo", "identifier": "sandbox"})
    cfg = client.get("/api/agent/config").json()
    cfg.update({"target_roles": ["Machine Learning Engineer", "Data Engineer", "Backend Python Developer"],
                "min_match_score": 40} | cfg_overrides)
    r = client.put("/api/agent/config", json=cfg)
    assert r.status_code == 200, r.text
    return r.json()


def test_pipeline_runs_and_logs(client, live_server):
    _setup(client, auto_prepare_applications=True, max_preparations_per_day=2)
    task = client.post("/api/agent/run").json()
    task = client.get(f"/api/agent/tasks/{task['id']}").json()
    assert task["state"] in ("AWAITING_APPROVAL", "COMPLETED"), task
    assert task["stats"]["discovery"]["new"] == 3  # Frontend role filtered out by target roles
    assert task["stats"]["documents_generated"] <= 2
    assert task["stats"]["submitted"] == 0  # review mode never submits
    steps = {log["step"] for log in client.get("/api/agent/logs", params={"task_id": task["id"]}).json()}
    assert {"DISCOVERING", "ANALYZING", "MATCHING"} <= steps
    apps = client.get("/api/applications").json()["items"]
    assert all(a["status"] in ("awaiting_approval", "needs_input") for a in apps)
    notes = client.get("/api/notifications").json()
    assert notes["unread"] >= 1


def test_daily_discovery_limit(client, live_server):
    _setup(client, daily_discovery_limit=1, auto_generate_documents=False)
    task = client.post("/api/agent/run").json()
    assert client.get(f"/api/agent/tasks/{task['id']}").json()["stats"]["discovery"]["new"] == 1
    task2 = client.post("/api/agent/run").json()
    logs = [entry["message"] for entry in client.get("/api/agent/logs", params={"task_id": task2["id"]}).json()]
    assert any("limit" in m for m in logs)


def test_authorized_mode_requires_ack(client):
    upload_and_approve(client)
    cfg = client.get("/api/agent/config").json()
    cfg["application_mode"] = "authorized"
    assert client.put("/api/agent/config", json=cfg).status_code == 400
    cfg["acknowledge_authorized_automation"] = True
    out = client.put("/api/agent/config", json=cfg).json()
    assert out["authorized_automation_ack_at"]


def test_pause_resume(client):
    upload_and_approve(client)
    assert client.post("/api/agent/pause").json()["paused"] is True
    assert client.post("/api/agent/resume").json()["paused"] is False


def test_concurrent_runs_rejected(client, monkeypatch):
    _setup(client)
    from app.workers import tasks

    monkeypatch.setattr(tasks.run_pipeline_task, "apply_async", lambda *a, **k: type("R", (), {"id": "x"})())
    first = client.post("/api/agent/run")
    assert first.status_code == 202
    assert client.post("/api/agent/run").status_code == 409
    cancel = client.post(f"/api/agent/tasks/{first.json()['id']}/cancel").json()
    assert cancel["state"] == "CANCELLED"
    assert client.post("/api/agent/run").status_code == 202


def test_is_due_respects_schedule():
    cfg = AgentConfiguration(enabled=True, paused=False, run_days=[0], window_start_hour=9, window_end_hour=17,
                             timezone="UTC", next_run_at=None, frequency_hours=24)
    monday_10 = datetime(2026, 11, 9, 10, 0, tzinfo=UTC)  # a Monday
    assert is_due(cfg, monday_10)
    assert not is_due(cfg, monday_10.replace(hour=20))
    assert not is_due(cfg, datetime(2026, 11, 10, 10, 0, tzinfo=UTC))  # Tuesday
    cfg.paused = True
    assert not is_due(cfg, monday_10)


def test_scheduler_tick_starts_due_runs(client, live_server):
    _setup(client, enabled=True, run_days=[0, 1, 2, 3, 4, 5, 6], window_start_hour=0, window_end_hour=0,
           auto_generate_documents=False)
    result = tick()
    assert result["started"] == 1
    tasks = client.get("/api/agent/tasks").json()
    assert tasks[0]["trigger"] == "schedule"
    assert tick()["started"] == 0  # next_run_at pushed forward → no runaway loop
