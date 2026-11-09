"""Verify a user's data survived a container restart: docker compose exec -T -e E2E_EMAIL=... backend python - < e2e/persistence_check.py"""

import os
import sys

import httpx

base = os.environ.get("BASE_URL", "http://127.0.0.1:8000")
c = httpx.Client(base_url=base, timeout=30)
r = c.post("/api/auth/login", json={"email": os.environ["E2E_EMAIL"], "password": "E2E-Synthetic-Pass-42"})
assert r.status_code == 200, r.text
apps = c.get("/api/applications").json()
assert apps["total"] == 1 and apps["items"][0]["status"] == "under_review", apps
versions = c.get("/api/resume-versions").json()
assert versions, "resume versions missing"
pdf = c.get(f"/api/resume-versions/{versions[0]['id']}/download/pdf")
assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF"), "generated file missing"
orig = c.get("/api/resumes").json()[0]
assert c.get(f"/api/resumes/{orig['id']}/download").status_code == 200, "original resume missing"
print(f"[persistence] OK: {apps['total']} application, {len(versions)} resume version(s), files intact")
sys.exit(0)
