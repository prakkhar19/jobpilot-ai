"""End-to-end application workflow against the local sandbox portal (never a real employer)."""

from __future__ import annotations

import pytest

from tests.conftest import upload_and_approve

FACTS = {"Work authorization": "Yes", "Notice period": "2 weeks"}


def _demo_job(client, live_server: str, title: str = "Machine Learning Engineer") -> dict:
    assert client.post("/api/sources", json={"kind": "demo", "identifier": "sandbox"}).status_code == 201
    r = client.post("/api/jobs/discover", json={})
    assert r.status_code == 202, r.text
    jobs = client.get("/api/jobs", params={"q": title}).json()["items"]
    job = next(j for j in jobs if j["title"] == title)
    assert job["is_demo"] and job["application_url"].startswith(live_server)
    return job


def test_prepare_stops_for_missing_answers_then_approval(client, live_server):
    upload_and_approve(client)  # no application facts → screening questions unanswered
    job = _demo_job(client, live_server)
    r = client.post("/api/applications/prepare", json={"job_id": job["id"], "mode": "review"})
    assert r.status_code == 201, r.text
    app = r.json()
    assert app["provider"] == "mock"
    assert app["status"] == "needs_input"
    missing = {f["name"] for f in app["missing_fields"]}
    assert missing == {"q_work_auth", "q_notice"}  # never guessed
    assert app["answers"]["email"]["value"] == "jordan.rivera@example.com"
    assert app["answers"]["first_name"]["value"] == "Jordan"
    assert app["resume_version_id"] and app["cover_letter_id"]
    # cannot approve with missing answers
    assert client.post(f"/api/applications/{app['id']}/approve").status_code == 409
    # cannot submit before approval
    assert client.post(f"/api/applications/{app['id']}/submit").status_code == 409
    bad = client.post(f"/api/applications/{app['id']}/answers", json={"answers": {"q_work_auth": "Maybe"}})
    assert bad.status_code == 400
    r = client.post(f"/api/applications/{app['id']}/answers",
                    json={"answers": {"q_work_auth": "Yes", "q_notice": "1 month"}})
    assert r.json()["status"] == "awaiting_approval"
    # answers are remembered in the answer bank for next time
    bank = {a["question_text"]: a["answer"] for a in client.get("/api/screening-answers").json()}
    assert bank["What is your notice period?"] == "1 month"
    assert client.post(f"/api/applications/{app['id']}/approve").json()["status"] == "ready_to_submit"
    events = [e["event_type"] for e in client.get(f"/api/applications/{app['id']}/events").json()]
    assert events[0] == "created" and {"prepared", "answers_updated", "approved"} <= set(events)


def test_duplicate_application_prevented(client, live_server):
    upload_and_approve(client, FACTS)
    job = _demo_job(client, live_server)
    a = client.post("/api/applications/prepare", json={"job_id": job["id"]}).json()
    b = client.post("/api/applications/prepare", json={"job_id": job["id"]}).json()
    assert a["id"] == b["id"]
    assert client.get("/api/applications").json()["total"] == 1


def test_below_threshold_blocks_submission(client, live_server):
    upload_and_approve(client, FACTS)
    job = _demo_job(client, live_server, "Senior Frontend Engineer")  # poor match for an ML profile
    cfg = client.get("/api/agent/config").json()
    cfg["min_match_score"] = 95
    client.put("/api/agent/config", json=cfg)
    app = client.post("/api/applications/prepare", json={"job_id": job["id"]}).json()
    assert app["status"] == "awaiting_approval"
    client.post(f"/api/applications/{app['id']}/approve")
    r = client.post(f"/api/applications/{app['id']}/submit")
    assert r.status_code == 409 and "threshold" in r.json()["detail"]


def test_manual_tracking_flow(client, live_server):
    upload_and_approve(client, FACTS)
    job = _demo_job(client, live_server)
    app = client.post("/api/applications/track", json={"job_id": job["id"]}).json()
    assert app["status"] == "shortlisted"
    # can't move to interview before submission
    assert client.post(f"/api/applications/{app['id']}/status", json={"status": "interview_scheduled"}).status_code == 409
    assert client.post(f"/api/applications/{app['id']}/status", json={"status": "submitted"}).status_code == 400
    r = client.post(f"/api/applications/{app['id']}/mark-submitted", json={"note": "Applied on site"})
    assert r.json()["status"] == "submitted" and r.json()["submitted_by"] == "user"
    iv = client.post("/api/interviews", json={"application_id": app["id"], "kind": "technical",
                                              "scheduled_at": "2026-12-01T15:00:00Z"})
    assert iv.status_code == 201
    assert client.get(f"/api/applications/{app['id']}").json()["status"] == "interview_scheduled"
    client.post(f"/api/applications/{app['id']}/status", json={"status": "offer_received"})
    stats = client.get("/api/analytics/summary").json()
    assert stats["totals"]["submitted"] == 1 and stats["totals"]["offers"] == 1
    assert stats["totals"]["interview_rate"] == 100.0
    assert "guarantees" in stats["disclaimer"]


@pytest.mark.browser
def test_safe_mock_submission_end_to_end(client, live_server):
    upload_and_approve(client, FACTS)
    job = _demo_job(client, live_server)
    app = client.post("/api/applications/prepare", json={"job_id": job["id"]}).json()
    assert app["status"] == "awaiting_approval", app["missing_fields"]
    assert app["answers"]["q_work_auth"] == {"value": "Yes", "source": "facts"}
    client.post(f"/api/applications/{app['id']}/approve")
    r = client.post(f"/api/applications/{app['id']}/submit")
    assert r.status_code == 202, r.text
    final = client.get(f"/api/applications/{app['id']}").json()
    assert final["status"] == "submitted", final["last_error"]
    assert final["confirmation_text"].startswith("MOCK-")
    assert client.get(f"/api/applications/{app['id']}/screenshot/confirmation").status_code == 200
    # idempotent: a second submit does not re-submit
    again = client.post(f"/api/applications/{app['id']}/submit").json()
    assert again["submit_attempts"] == 1 and again["status"] == "submitted"
    from app.core.config import get_settings

    lines = (get_settings().data_dir / "mock_portal" / "submissions.jsonl").read_text().strip().splitlines()
    assert sum(1 for ln in lines if final["confirmation_text"] in ln) == 1


@pytest.mark.browser
def test_captcha_stops_automation(client, live_server):
    upload_and_approve(client, FACTS)
    job = _demo_job(client, live_server)
    from app.core.database import SessionLocal
    from app.models import Job

    with SessionLocal() as db:
        j = db.get(Job, __import__("uuid").UUID(job["id"]))
        j.application_url += "?captcha=1"
        db.commit()
    app = client.post("/api/applications/prepare", json={"job_id": job["id"]}).json()
    client.post(f"/api/applications/{app['id']}/approve")
    client.post(f"/api/applications/{app['id']}/submit")
    final = client.get(f"/api/applications/{app['id']}").json()
    assert final["status"] == "ready_to_submit"
    assert "CAPTCHA" in final["last_error"]


@pytest.mark.browser
def test_assisted_fill_does_not_submit(client, live_server):
    upload_and_approve(client, FACTS)
    job = _demo_job(client, live_server)
    app = client.post("/api/applications/prepare", json={"job_id": job["id"], "mode": "assisted"}).json()
    r = client.post(f"/api/applications/{app['id']}/assisted-fill")
    assert r.status_code == 202
    final = client.get(f"/api/applications/{app['id']}").json()
    assert final["status"] == "awaiting_approval" and final["preparation_screenshot"]
    assert final["submitted_at"] is None


def test_real_provider_has_no_automated_submit(client):
    from app.adapters.application_providers import PROVIDERS

    assert PROVIDERS["greenhouse"].supports_submit is False
    assert PROVIDERS["lever"].supports_submit is False
    assert PROVIDERS["mock"].supports_submit is True


def test_cannot_delete_job_with_submitted_application(client, live_server):
    upload_and_approve(client, FACTS)
    job = _demo_job(client, live_server)
    app = client.post("/api/applications/track", json={"job_id": job["id"]}).json()
    client.post(f"/api/applications/{app['id']}/mark-submitted", json={})
    r = client.delete(f"/api/jobs/{job['id']}")
    assert r.status_code == 409
    assert client.get(f"/api/applications/{app['id']}").status_code == 200
    cl = client.post("/api/cover-letters", json={"job_id": job["id"], "use_llm": False}).json()
    assert cl["company"] == job["company"] and cl["job_title"] == job["title"]
