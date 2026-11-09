"""End-to-end API smoke test against a running stack with DEMO_MODE=true.

Runs the complete workflow with a synthetic candidate and the sandbox employer portal:
register → upload resume → approve profile → add sandbox source → discovery (worker) → match →
tailored resume (PDF/DOCX) → cover letter → prepare application → answer → approve → automated
submission by the worker's headless Chromium → tracking → analytics.

Usage (inside the backend container, so it needs no extra dependencies):
    docker compose exec -T backend python - < e2e/api_smoke.py
Or from a host with httpx + python-docx installed:
    BASE_URL=http://localhost:8080 python e2e/api_smoke.py
"""

from __future__ import annotations

import io
import os
import secrets
import sys
import time

import httpx
from docx import Document

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8000").rstrip("/")
EMAIL = os.environ.get("E2E_EMAIL", f"e2e-{secrets.token_hex(4)}@example.com")
PASSWORD = "E2E-Synthetic-Pass-42"
ACTIVE = {"IDLE", "DISCOVERING", "ANALYZING", "MATCHING", "GENERATING_RESUME", "PREPARING_APPLICATION",
          "SUBMITTING", "VERIFYING"}

RESUME = [
    "Sam Testcase", "Machine Learning Engineer", "sam.testcase@example.com | +1 555 010 9999 | Remote",
    "", "SUMMARY", "Machine learning engineer building NLP services in Python.", "",
    "EXPERIENCE", "Machine Learning Engineer | Example Analytics | Jan 2020 – Present",
    "• Built text classification APIs with PyTorch and FastAPI", "• Deployed services with Docker on AWS",
    "• Designed ETL pipelines with Apache Airflow and PostgreSQL", "",
    "EDUCATION", "Example State University", "Bachelor of Science in Computer Science | 2015 - 2019", "",
    "SKILLS", "Languages: Python, SQL", "Tools: PyTorch, FastAPI, Docker, AWS, PostgreSQL, Redis",
]


def make_docx() -> bytes:
    doc = Document()
    for line in RESUME:
        if line.startswith("• "):
            doc.add_paragraph(line[2:], style="List Bullet")
        else:
            doc.add_paragraph(line)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


class Client:
    def __init__(self) -> None:
        self.http = httpx.Client(base_url=BASE, timeout=120)
        self.csrf = ""

    def call(self, method: str, path: str, expect: int | tuple = (200, 201, 202, 204), **kw) -> httpx.Response:
        headers = kw.pop("headers", {})
        if method != "GET" and self.csrf:
            headers["X-CSRF-Token"] = self.csrf
        r = self.http.request(method, path, headers=headers, **kw)
        expected = expect if isinstance(expect, tuple) else (expect,)
        if r.status_code not in expected:
            raise AssertionError(f"{method} {path} -> {r.status_code}: {r.text[:500]}")
        return r


def step(msg: str) -> None:
    print(f"[e2e] {msg}", flush=True)


def wait_task(c: Client, task_id: str, timeout: int = 300) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        t = c.call("GET", f"/api/agent/tasks/{task_id}").json()
        if t["state"] not in ACTIVE:
            return t
        time.sleep(2)
    raise AssertionError("agent task timed out")


def main() -> int:
    c = Client()
    status = c.call("GET", "/api/auth/status").json()
    assert status["demo_mode"], "DEMO_MODE must be true for the e2e smoke test"

    step(f"register {EMAIL}")
    c.csrf = c.call("POST", "/api/auth/register", json={"email": EMAIL, "password": PASSWORD, "full_name": "Sam"}).json()["csrf_token"]

    step("upload resume and approve profile")
    up = c.call("POST", "/api/resumes", files={"file": ("resume.docx", make_docx())}, data={"use_llm": "false"}).json()
    prof = up["profile"]
    assert prof["full_name"] == "Sam Testcase" and prof["experiences"], prof
    prof["application_facts"] = {"Work authorization": "Yes", "Notice period": "Two weeks"}
    c.call("PUT", f"/api/profiles/{prof['id']}", json=prof)
    assert c.call("POST", f"/api/profiles/{prof['id']}/approve").json()["status"] == "approved"

    step("configure preferences and sandbox source")
    cfg = c.call("GET", "/api/agent/config").json()
    cfg.update({"target_roles": ["Machine Learning Engineer", "Data Engineer"], "min_match_score": 40,
                "auto_generate_documents": True, "max_preparations_per_day": 2})
    c.call("PUT", "/api/agent/config", json=cfg)
    c.call("POST", "/api/sources", json={"kind": "demo", "identifier": "sandbox"})

    step("run discovery in the background worker")
    task = c.call("POST", "/api/jobs/discover", json={}).json()
    t = wait_task(c, task["task_id"])
    assert t["state"] in ("COMPLETED", "AWAITING_APPROVAL"), t
    step(f"  task {t['state']}: {t['stats'].get('discovery')}")
    jobs = c.call("GET", "/api/jobs", params={"sort": "score"}).json()
    assert jobs["total"] >= 2, jobs
    job = next(j for j in jobs["items"] if j["title"] == "Machine Learning Engineer")
    assert job["match_score"] is not None
    detail = c.call("GET", f"/api/jobs/{job['id']}").json()
    assert detail["match"]["components"], "match breakdown missing"
    step(f"  match score {job['match_score']} ({job['recommendation']})")

    step("tailored resume + downloads")
    rv = c.call("POST", "/api/resume-versions", json={"job_id": job["id"], "use_llm": False}).json()
    pdf = c.call("GET", f"/api/resume-versions/{rv['id']}/download/pdf")
    assert pdf.content.startswith(b"%PDF")
    docx = c.call("GET", f"/api/resume-versions/{rv['id']}/download/docx")
    assert docx.content.startswith(b"PK")

    step("cover letter")
    cl = c.call("POST", "/api/cover-letters", json={"job_id": job["id"], "use_llm": False}).json()
    assert "Dear Hiring Manager" in cl["content"]

    step("prepare, approve and submit application (sandbox portal)")
    app = c.call("POST", "/api/applications/prepare", json={"job_id": job["id"], "mode": "review"}).json()
    if app["status"] == "needs_input":
        answers = {f["name"]: (f["options"][0] if f["options"] else "Test answer") for f in app["missing_fields"]}
        app = c.call("POST", f"/api/applications/{app['id']}/answers", json={"answers": answers}).json()
    assert app["status"] == "awaiting_approval", app
    c.call("POST", f"/api/applications/{app['id']}/approve")
    c.call("POST", f"/api/applications/{app['id']}/submit", expect=202)
    deadline = time.time() + 180
    while time.time() < deadline:
        app = c.call("GET", f"/api/applications/{app['id']}").json()
        if app["status"] != "submitting":
            break
        time.sleep(2)
    assert app["status"] == "submitted", f"submission failed: {app['last_error']}"
    step(f"  confirmation {app['confirmation_text']}")
    again = c.call("POST", f"/api/applications/{app['id']}/submit", expect=202).json()
    assert again["submit_attempts"] == 1, "idempotency violated"

    step("tracking + analytics")
    c.call("POST", f"/api/applications/{app['id']}/status", json={"status": "under_review"})
    events = [e["event_type"] for e in c.call("GET", f"/api/applications/{app['id']}/events").json()]
    assert "submitted" in events, events
    totals = c.call("GET", "/api/analytics/summary").json()["totals"]
    assert totals["submitted"] == 1 and totals["response_rate"] == 100.0, totals
    diag = c.call("GET", "/api/diagnostics").json()
    step(f"  worker={diag['checks']['worker']['status']} scheduler={diag['checks']['scheduler']['status']}")
    step("ALL CHECKS PASSED")
    print(f"E2E_USER={EMAIL}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
