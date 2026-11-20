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


EZY_FORM = """Relevant experience *
Roles, tenure, and specifics that match this opening (field work, team leadership, verification, sourcing, ops — as applicable).

Why this role at EzyHelpers? *
What draws you to this position and how you would contribute in the first few months."""


def test_split_questions_keeps_hints_with_their_question():
    from app.services.application_answers import split_questions

    qs = split_questions(EZY_FORM)
    assert len(qs) == 2
    assert qs[0].startswith("Relevant experience *") and "Roles, tenure" in qs[0]
    assert qs[1].startswith("Why this role at EzyHelpers?") and "first few months" in qs[1]
    # no blank line between questions still splits on the '?' / '*' markers
    assert len(split_questions("Why us?\nTell us more.\nYour notice period? *")) == 2


def test_answers_use_only_profile_facts_and_flag_personal_questions(client):
    job = _setup(client)
    r = client.post(f"/api/apply-queue/{job['id']}/answers",
                    json={"questions": EZY_FORM + "\n\nWhat is your expected CTC? *"})
    assert r.status_code == 200, r.text
    exp, why, ctc = r.json()
    profile = client.get("/api/profiles/active").json()
    first_role = profile["experiences"][0]
    assert exp["method"] == "template" and first_role["company"] in exp["answer"]
    assert job["title"] in why["answer"] and "first few months" in why["answer"]
    assert ctc["method"] == "needs_you" and ctc["answer"] == ""
    # no skill outside the profile is claimed
    from app.services.factcheck import build_fact_base, check_text
    facts = build_fact_base(profile, extra_texts=[job["company"], job["title"], job.get("description_text", "")])
    for a in (exp, why):
        assert not [v for v in check_text(a["answer"], facts).violations if "mentions '" in v], a["answer"]


def test_answers_validation_and_privacy(client, other_client):
    job = _setup(client)
    assert client.post(f"/api/apply-queue/{job['id']}/answers", json={"questions": "  \n \n "}).status_code == 422
    upload_and_approve(other_client)
    assert other_client.post(f"/api/apply-queue/{job['id']}/answers", json={"questions": "Why us?"}).status_code == 404
