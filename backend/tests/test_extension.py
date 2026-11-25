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
    assert ev["decision"] == "skip" and ("below" in ev["reason"] or "not a tech role" in ev["reason"])
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
    assert any("greenhouse" in i["url"] and i["kind"] == "ats" for i in q)


def test_queue_step_kinds():
    from types import SimpleNamespace as J

    from app.api.extension import queue_step

    assert queue_step(J(official_url="https://jobs.lever.co/acme/1", application_url="", posting_url="x")) == {
        "kind": "ats", "url": "https://jobs.lever.co/acme/1"}
    assert queue_step(J(official_url="", application_url="", posting_url="https://www.linkedin.com/comm/jobs/view/42?trk=x")
                      ) == {"kind": "linkedin-job", "url": "https://www.linkedin.com/jobs/view/42/"}
    assert queue_step(J(official_url="", application_url="", posting_url="https://www.naukri.com/job-listings-ai-eng-acme-1-3-years-120"
                        "1126001234?src=alert"))["kind"] == "naukri-job"
    assert queue_step(J(official_url="", application_url="", posting_url="https://www.naukri.com/jd/job-listings-x-acme-2-to-5-years-"
                        "171126032890?u=1")) == {"kind": "naukri-job",
                                                 "url": "https://www.naukri.com/job-listings-x-acme-2-to-5-years-171126032890"}
    assert queue_step(J(official_url="", application_url="", posting_url="https://careers.example.com/jobs/1")) is None


def test_result_records_company_site_url(client, anon):
    h = _ext(client, anon)
    ev = anon.post("/api/ext/evaluate", json=_job(), headers=h).json()
    r = anon.post("/api/ext/result", headers=h, json={"job_id": ev["job_id"], "outcome": "needs_you",
                  "missing": ["Apply on careers.example.com"], "apply_url": "https://careers.example.com/apply/9"})
    assert r.status_code == 200 and r.json()["status"] == "needs_input"
    assert client.get(f"/api/jobs/{ev['job_id']}").json()["official_url"] == "https://careers.example.com/apply/9"


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


def test_queue_retries_company_site_jobs_first(client, anon):
    h = _ext(client, anon)
    first = anon.post("/api/ext/evaluate", json=_job(), headers=h).json()
    second = anon.post("/api/ext/evaluate", json=_job() | {"url": "https://www.linkedin.com/jobs/view/456",
                                                           "company": "Other Corp"}, headers=h).json()
    anon.post("/api/ext/result", headers=h, json={"job_id": first["job_id"], "outcome": "needs_you",
                                                  "missing": ["Apply on the company site (resume is ready in JobPilot)"]})
    anon.post("/api/ext/result", headers=h, json={"job_id": second["job_id"], "outcome": "needs_you",
                                                  "missing": ["Please select your English level"]})
    q = anon.get("/api/ext/queue", headers=h).json()
    ids = [i["job_id"] for i in q]
    assert ids and ids[0] == first["job_id"]  # parked for the company site → retried first
    assert second["job_id"] not in ids  # waiting for an answer only the user has


def test_location_parts():
    from app.api.extension import _location_part

    loc = "Noida, Uttar Pradesh, India"
    assert _location_part("State *", loc) == "Uttar Pradesh"
    assert _location_part("Current City", loc) == "Noida"
    assert _location_part("Country", loc) == "India"
    assert _location_part("Country code", loc) is None
    assert _location_part("State", "Gurugram, India") == "Haryana"
    assert _location_part("Why this role?", loc) is None


def test_single_name_uses_last_name_fact():
    from app.adapters.application_providers.base import FormField, map_candidate_data

    fields = [FormField(name="ln", label="Surname", type="text", required=True, options=[]),
              FormField(name="fn", label="First Name", type="text", required=True, options=[])]
    got, missing = map_candidate_data(fields, {"full_name": "Prakhar", "application_facts": {"Last name": "Prakhar"}}, {})
    assert got["ln"]["value"] == "Prakhar" and got["fn"]["value"] == "Prakhar" and not missing
    _, missing = map_candidate_data(fields[:1], {"full_name": "Prakhar"}, {})
    assert missing  # never invented without the fact


def test_ctc_relocation_and_authorization_facts():
    from app.adapters.application_providers.base import FormField, map_candidate_data
    from app.api.extension import _as_number

    facts = {"Current CTC": "6 LPA", "Expected CTC": "8-9 LPA", "Willing to relocate": "Yes", "Work authorization": "Indian citizen"}
    F = lambda n, label, opts=None: FormField(name=n, label=label, type="select" if opts else "text", required=True, options=opts or [])  # noqa: E731
    got, missing = map_candidate_data([F("c", "Current CTC"), F("e", "Expected CTC (LPA)"), F("s", "Expected salary"),
                                       F("r", "Are you willing to relocate?", ["Yes", "No"]),
                                       F("w", "Are you legally authorized to work in India?", ["Yes", "No"])],
                                      {"full_name": "Prakhar", "application_facts": facts}, {})
    assert {k: v["value"] for k, v in got.items()} == {"c": "6 LPA", "e": "8-9 LPA", "s": "8-9 LPA", "r": "Yes", "w": "Yes"}
    assert not missing
    assert _as_number("6 LPA", "Current CTC (in lakhs)") == "6"
    assert _as_number("6 LPA", "Current annual salary in INR") == "600000"
    assert _as_number("8-9 LPA", "Expected CTC") == "8"


def test_current_location_questions_answered_with_city():
    from app.api.extension import _location_part
    loc = "Noida, Uttar Pradesh, India"
    assert _location_part("What is your current location?", loc) == "Noida"
    assert _location_part("Current Location", loc) == "Noida"
    assert _location_part("Please select the city you are currently residing or willing to relocate to", loc) == "Noida"
    assert _location_part("State", loc) == "Uttar Pradesh"
    assert _location_part("Are you willing to relocate?", loc) is None


def test_lpa_questions_get_plain_numbers():
    from app.api.extension import _as_number
    assert _as_number("8-9 LPA", "What are your salary expectations (in LPA)?") == "8"
    assert _as_number("6 LPA", "What is your current CTC in INR?") == "600000"


def test_too_senior_flags_levels_above_entry():
    from app.api.extension import too_senior
    for t in ["SDE-2 (Backend)", "Software Engineer II", "Backend Engineer III", "Lead Software Engineer",
              "Senior Developer", "SSE - Node", "Developer (5+ years)"]:
        assert too_senior(t, 1.0), t
    for t in ["SDE 1", "Software Engineer (L1)", "Associate Software Engineer", "Software Engineer 2025 Batch",
              "Full Stack Developer 2-4 yrs", "Software Development Engineer"]:
        assert not too_senior(t, 1.0), t
    assert not too_senior("SDE-2", 4.0)


def test_address_fields_map_from_facts():
    from app.adapters.application_providers.base import FormField, map_candidate_data
    profile = {"full_name": "A B", "email": "a@b.c",
               "application_facts": {"Address": "7th Avenue", "Postal code": "201318", "State": "UP"}}
    fields = [FormField(name="addr", label="Address Line 1", required=True),
              FormField(name="pin", label="Pin Code", required=True),
              FormField(name="st", label="State", required=True),
              FormField(name="em", label="Email address", required=True)]
    answers, missing = map_candidate_data(fields, profile, {})
    assert answers["addr"]["value"] == "7th Avenue"
    assert answers["pin"]["value"] == "201318"
    assert answers["st"]["value"] == "UP"
    assert answers["em"]["value"] == "a@b.c"
    assert not missing


def test_off_target_titles():
    from app.api.extension import off_target
    for t in ["Associate HR Analyst - APAC", "iOS Engineer", "Driver Development Engineer", "Application Developer-SAP ABAP HANA",
              "MuleSoft Developer - Associate", "Teamcenter Developer", "Salesforce Developer Engineer", "Java Developer",
              "Sales Executive", "Developer II - Embedded Software"]:
        assert off_target(t), t
    for t in ["SDE 1", "Software Engineer (Java+React)", "Full Stack Developer", "JavaScript Developer", "Data Analyst",
              "QA Engineer", "DevOps Engineer", "Associate Software Engineer", "Python Developer", "AI Engineer",
              "Technical Support Engineer", "Junior Data Scientist", "Graduate Engineer Trainee"]:
        assert not off_target(t), t
