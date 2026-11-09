"""Sandbox employer portal for demos and end-to-end tests (DEMO_MODE only).

It renders fictional job pages and an application form, accepts submissions and returns a confirmation
code. Nothing leaves the installation.
"""

from __future__ import annotations

import html
import json
import secrets
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse

from app.adapters.job_sources.demo import DEMO_JOBS
from app.core.config import get_settings

router = APIRouter(prefix="/mock-portal", tags=["sandbox"], include_in_schema=False)

_STYLE = ("body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;color:#111}"
          ".banner{background:#fff3cd;border:1px solid #e0c97a;padding:10px;border-radius:6px;margin-bottom:16px}"
          "label{display:block;margin-top:12px;font-weight:600}input,select,textarea{width:100%;padding:8px;"
          "margin-top:4px}button{margin-top:20px;padding:10px 18px}")


def _guard(job_id: str) -> dict:
    if not get_settings().demo_mode:
        raise HTTPException(404, "Not found")
    job = next((j for j in DEMO_JOBS if j["id"] == job_id), None)
    if job is None:
        raise HTTPException(404, "Not found")
    return job


def _page(title: str, body: str) -> HTMLResponse:
    return HTMLResponse(f"<!doctype html><html><head><meta charset='utf-8'><title>{html.escape(title)}</title>"
                        f"<style>{_STYLE}</style></head><body><div class='banner'>Sandbox portal — fictional "
                        f"employer for testing JobPilot AI. No real application is sent.</div>{body}</body></html>")


@router.get("/jobs/{job_id}", response_class=HTMLResponse)
def job_page(job_id: str) -> HTMLResponse:
    j = _guard(job_id)
    desc = "<br>".join(html.escape(x) for x in j["description"].split("\n"))
    return _page(j["title"], f"<h1>{html.escape(j['title'])}</h1><p>{html.escape(j['company'])} · "
                 f"{html.escape(j['location'])}</p><p>{desc}</p><a href='/mock-portal/apply/{job_id}'>Apply</a>")


@router.get("/apply/{job_id}", response_class=HTMLResponse)
def apply_form(job_id: str, captcha: int = 0) -> HTMLResponse:
    j = _guard(job_id)
    captcha_html = "<div class='g-recaptcha' data-sitekey='sandbox'>[CAPTCHA]</div>" if captcha else ""
    form = f"""
<h1>Apply: {html.escape(j['title'])}</h1>
<form id="application-form" method="post" enctype="multipart/form-data" action="/mock-portal/apply/{job_id}">
  <label for="first_name">First name *</label><input id="first_name" name="first_name" required>
  <label for="last_name">Last name *</label><input id="last_name" name="last_name" required>
  <label for="email">Email *</label><input id="email" name="email" type="email" required>
  <label for="phone">Phone</label><input id="phone" name="phone" type="tel">
  <label for="linkedin">LinkedIn profile</label><input id="linkedin" name="linkedin" type="url">
  <label for="resume">Resume *</label><input id="resume" name="resume" type="file" required>
  <label for="cover_letter">Cover letter</label><input id="cover_letter" name="cover_letter" type="file">
  <label for="q_work_auth">Are you legally authorized to work in the job's country? *</label>
  <select id="q_work_auth" name="q_work_auth" required><option value="">Select…</option>
    <option value="yes">Yes</option><option value="no">No</option></select>
  <label for="q_notice">What is your notice period? *</label><input id="q_notice" name="q_notice" required>
  <label for="q_hear">How did you hear about us?</label><input id="q_hear" name="q_hear">
  {captcha_html}
  <button id="submit-application" type="submit">Submit application</button>
</form>"""
    return _page(f"Apply — {j['title']}", form)


@router.post("/apply/{job_id}", response_class=HTMLResponse)
async def submit_form(job_id: str, request: Request) -> HTMLResponse:
    j = _guard(job_id)
    form = await request.form()
    missing = [k for k in ("first_name", "last_name", "email", "q_work_auth", "q_notice") if not form.get(k)]
    resume = form.get("resume")
    if not resume or not getattr(resume, "filename", ""):
        missing.append("resume")
    if missing:
        return _page("Error", f"<h1>Missing fields</h1><p id='error'>{html.escape(', '.join(missing))}</p>")
    code = "MOCK-" + secrets.token_hex(4).upper()
    log_dir = get_settings().data_dir / "mock_portal"
    log_dir.mkdir(parents=True, exist_ok=True)
    with (log_dir / "submissions.jsonl").open("a") as fh:
        fh.write(json.dumps({"job": job_id, "code": code, "at": datetime.now(UTC).isoformat(),
                             "email_domain": str(form.get("email", "")).split("@")[-1]}) + "\n")
    return _page("Application received",
                 f"<h1>Thank you!</h1><p id='confirmation'>Your application for {html.escape(j['title'])} "
                 f"was received. Confirmation number: {code}</p>")
