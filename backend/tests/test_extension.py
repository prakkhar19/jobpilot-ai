"""Browser-extension API: login → evaluate → answers → result → outreach note."""

from __future__ import annotations

from tests.conftest import PASSWORD, upload_and_approve
from tests.fixtures import JD_ML


def _ext(client, anon) -> dict:
    upload_and_approve(client, facts={"Notice period": "Immediate"})
    cfg = client.get("/api/agent/config").json()
    cfg["min_match_score"] = 20
    assert client.put("/api/agent/config", json=cfg).status_code == 200
    r = anon.post("/api/ext/login", json={"email": "alex@example.com", "password": PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _job() -> dict:
    return {"platform": "linkedin", "url": "https://www.linkedin.com/jobs/view/123", "title": "Machine Learning Engineer",
            "company": "Example Corp", "location": "Remote", "workplace_type": "remote", "description": JD_ML}


def test_requires_token(anon):
    assert anon.get("/api/ext/config").status_code == 401
    assert anon.get("/api/ext/config", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_full_flow(client, anon):
    h = _ext(client, anon)
    cfg = anon.get("/api/ext/config", headers=h).json()
    assert cfg["profile"]["full_name"] and cfg["applied_today"] == 0

    ev = anon.post("/api/ext/evaluate", json=_job(), headers=h)
    assert ev.status_code == 200, ev.text
    ev = ev.json()
    assert ev["decision"] == "apply", ev
    pdf = anon.get(f"/api/ext/jobs/{ev['job_id']}/resume.pdf", headers=h)
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"

    fields = [
        {"key": "a", "label": "First name", "type": "text", "required": True},
        {"key": "b", "label": "Email address", "type": "email", "required": True},
        {"key": "c", "label": "What is your notice period?", "type": "text", "required": True},
        {"key": "d", "label": "How many years of experience do you have with Python?", "type": "number"},
        {"key": "e", "label": "What is your expected CTC?", "type": "text", "required": True},
        {"key": "f", "label": "Do you have experience with Python?", "type": "radio", "options": ["Yes", "No"]},
        {"key": "g", "label": "Have you used Kubernetes-Fortran-Quantum?", "type": "radio", "options": ["Yes", "No"]},
    ]
    ans = anon.post("/api/ext/answers", json={"job_id": ev["job_id"], "fields": fields}, headers=h)
    assert ans.status_code == 200, ans.text
    a = ans.json()["answers"]
    assert a["a"] and "@" in a["b"] and a["c"] == "Immediate"
    assert a["d"] is not None and a["d"].isdigit()
    assert a["e"] is None  # salary is never guessed
    assert a["f"] == "Yes" and a["g"] == "No"

    # The user answers once; the bank remembers it for next time.
    assert anon.post("/api/ext/answer-bank", json={"question": "What is your expected CTC?", "answer": "12 LPA"},
                     headers=h).status_code == 204
    a2 = anon.post("/api/ext/answers", json={"job_id": ev["job_id"], "fields": fields[4:5]}, headers=h).json()
    assert a2["answers"]["e"] == "12 LPA"

    r = anon.post("/api/ext/result", json={"job_id": ev["job_id"], "outcome": "submitted", "note": "Easy Apply"},
                  headers=h)
    assert r.json()["status"] == "submitted"
    again = anon.post("/api/ext/evaluate", json=_job(), headers=h).json()
    assert again["decision"] == "skip" and again["reason"] == "already applied"
    assert anon.get("/api/ext/config", headers=h).json()["applied_today"] == 1

    note = anon.post("/api/ext/outreach-note", json={"job_id": ev["job_id"], "person_name": "sam lee",
                                                     "person_title": "Technical Recruiter"}, headers=h).json()["note"]
    assert note.startswith("Hi Sam") and len(note) <= 300 and "Example Corp" in note


def test_needs_you_and_threshold(client, anon):
    h = _ext(client, anon)
    cfg = client.get("/api/agent/config").json()
    cfg["min_match_score"] = 99
    client.put("/api/agent/config", json=cfg)
    ev = anon.post("/api/ext/evaluate", json=_job() | {"title": "Chartered Accountant"}, headers=h).json()
    assert ev["decision"] == "skip" and "below" in ev["reason"]
    anon.post("/api/ext/result", json={"job_id": ev["job_id"], "outcome": "needs_you", "missing": ["Expected CTC"]},
              headers=h)
    ny = anon.get("/api/ext/needs-you", headers=h).json()
    assert ny and ny[0]["missing"] == ["Expected CTC"]


def test_tenant_isolation(client, other_client, anon):
    h = _ext(client, anon)
    ev = anon.post("/api/ext/evaluate", json=_job(), headers=h).json()
    r = other_client.post("/api/auth/logout")
    assert r.status_code == 204
    r2 = anon.post("/api/ext/login", json={"email": "blair@example.com", "password": PASSWORD}).json()
    hb = {"Authorization": f"Bearer {r2['token']}"}
    assert anon.get(f"/api/ext/jobs/{ev['job_id']}/resume.pdf", headers=hb).status_code == 404


def test_queue_lists_company_board_jobs(client, anon):
    h = _ext(client, anon)
    job = _job() | {"url": "https://boards.greenhouse.io/example/jobs/42"}
    client.post("/api/jobs/import-manual", json={"title": job["title"], "company": job["company"],
                                                 "description": JD_ML, "location": "Remote", "workplace_type": "remote",
                                                 "url": job["url"]})
    client.post("/api/jobs/rematch")
    q = anon.get("/api/ext/queue", headers=h).json()
    assert any("greenhouse" in i["url"] for i in q)


def test_notice_period_buttons(client, anon):
    h = _ext(client, anon)  # facts: Notice period = Immediate
    ev = anon.post("/api/ext/evaluate", json=_job(), headers=h).json()
    f = [{"key": "n", "label": "What is your notice period?", "type": "radio",
          "options": ["15 Days or less", "1 Month", "2 Months", "3 Months"], "required": True}]
    a = anon.post("/api/ext/answers", json={"job_id": ev["job_id"], "fields": f}, headers=h).json()
    assert a["answers"]["n"] == "15 Days or less"


def test_title_match_lower_bar_and_senior_skip(client, anon):
    h = _ext(client, anon)
    cfg = client.get("/api/agent/config").json()
    cfg["min_match_score"] = 95
    cfg["target_roles"] = ["Machine Learning Engineer"]
    client.put("/api/agent/config", json=cfg)
    ev = anon.post("/api/ext/evaluate", json=_job(), headers=h).json()
    assert ev["decision"] == "apply", ev  # title matches a target role → bar drops to 40
    from app.api.extension import _SENIOR
    assert _SENIOR.search("Principal AI Architect") and _SENIOR.search("Lead Engineer, Agentic AI")
    assert not _SENIOR.search("GenAI Engineer") and not _SENIOR.search("Leadership Software Engineer")


def test_area_years():
    from app.api.extension import _mentions
    from app.services.skills import skill_key
    skills = {skill_key(s) for s in ["Generative AI", "Large Language Models", "REST APIs", "React"]}
    assert _mentions("How many years of experience do you have in Aiml?", skills)
    assert _mentions("How many years of experience do you have in Open Api?", skills)
    assert not _mentions("How many years of experience do you have in SAP ABAP?", skills)
