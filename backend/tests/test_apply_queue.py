"""Apply Mode queue: best unapplied jobs with tailored documents; the user applies and records it."""

from __future__ import annotations

from tests.conftest import import_job, upload_and_approve


def _setup(client, min_score: float = 30) -> dict:
    upload_and_approve(client)
    cfg = client.get("/api/agent/config").json()
    cfg["min_match_score"] = min_score
    assert client.put("/api/agent/config", json=cfg).status_code == 200
    job = import_job(client)
    client.post(f"/api/jobs/{job['id']}/match")
    return job


def test_queue_prepare_and_apply(client):
    job = _setup(client)
    q = client.get("/api/apply-queue").json()
    item = next(i for i in q["items"] if i["job_id"] == job["id"])
    assert item["apply_url"] == "https://example.com/jobs/1"
    assert item["resume_version_id"] is None and q["applied_today"] == 0

    prepared = client.post(f"/api/apply-queue/{job['id']}/prepare")
    assert prepared.status_code == 200, prepared.text
    p = prepared.json()
    assert p["resume_version_id"] and p["cover_letter_id"] and len(p["cover_letter"]) > 100
    # Preparing twice doesn't create duplicates.
    assert client.post(f"/api/apply-queue/{job['id']}/prepare").json()["resume_version_id"] == p["resume_version_id"]

    assert client.post(f"/api/apply-queue/{job['id']}/applied").status_code == 204
    q = client.get("/api/apply-queue").json()
    assert all(i["job_id"] != job["id"] for i in q["items"])
    assert q["applied_today"] == 1
    app = client.get(f"/api/applications/{p['application_id']}").json()
    assert app["status"] == "submitted" and app["submitted_by"] == "user"
    assert app["resume_version_id"] == p["resume_version_id"]
    assert client.post(f"/api/apply-queue/{job['id']}/applied").status_code == 409


def test_queue_respects_min_score_and_hidden(client):
    job = _setup(client, min_score=100)
    assert client.get("/api/apply-queue").json()["total"] == 0
    cfg = client.get("/api/agent/config").json()
    cfg["min_match_score"] = 0
    client.put("/api/agent/config", json=cfg)
    assert client.get("/api/apply-queue").json()["total"] == 1
    client.post(f"/api/jobs/{job['id']}/hide?hidden=true")
    assert client.get("/api/apply-queue").json()["total"] == 0


def test_queue_is_private(client, other_client):
    job = _setup(client)
    upload_and_approve(other_client)
    assert other_client.get("/api/apply-queue").json()["total"] == 0
    assert other_client.post(f"/api/apply-queue/{job['id']}/prepare").status_code == 404
    assert other_client.post(f"/api/apply-queue/{job['id']}/applied").status_code == 404


def test_new_postings_rank_above_old_ones():
    from datetime import UTC, datetime, timedelta

    from app.api.apply_queue import _freshness_bonus
    from app.models import Job

    now = datetime(2026, 11, 19, tzinfo=UTC)
    age = lambda days: _freshness_bonus(Job(discovered_at=now - timedelta(days=days)), now)  # noqa: E731
    assert age(1) > age(5) > age(10) > age(30)
    # a fresh 62 now outranks a month-old 70
    assert 62 + age(1) > 70 + age(30)
