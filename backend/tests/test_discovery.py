from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from app.adapters.job_sources import (
    AshbyAdapter,
    CareerPageAdapter,
    GreenhouseAdapter,
    LeverAdapter,
    SearchCriteria,
)
from app.adapters.job_sources.base import NormalizedJob, html_to_text
from app.security.ssrf import SafeHttpClient
from app.services.discovery import dedupe_key, filter_reasons

GH_JOBS = {"jobs": [
    {"id": 101, "title": "Machine Learning Engineer", "location": {"name": "Remote - US"},
     "absolute_url": "https://job-boards.greenhouse.io/acme/jobs/101", "updated_at": "2026-11-01T10:00:00Z",
     "content": "&lt;p&gt;Requirements&lt;/p&gt;&lt;ul&gt;&lt;li&gt;3+ years Python&lt;/li&gt;&lt;li&gt;PyTorch&lt;/li&gt;&lt;/ul&gt;",
     "departments": [{"name": "AI"}]},
    {"id": 102, "title": "Office Manager", "location": {"name": "London"}, "absolute_url": "https://x/102",
     "content": "Admin role", "departments": []},
]}
LEVER = [{"id": "aaaaaaaa-1111-2222-3333-444444444444", "text": "Backend Python Developer",
          "categories": {"location": "Berlin", "team": "Platform", "commitment": "Full-time"}, "workplaceType": "hybrid",
          "descriptionPlain": "Build APIs with FastAPI.", "lists": [{"text": "Requirements", "content": "<li>Python</li>"}],
          "hostedUrl": "https://jobs.lever.co/acme/aaaaaaaa-1111-2222-3333-444444444444",
          "applyUrl": "https://jobs.lever.co/acme/aaaaaaaa-1111-2222-3333-444444444444/apply",
          "createdAt": 1762000000000, "salaryRange": {"min": 70000, "max": 90000, "currency": "EUR", "interval": "per-year"}}]
ASHBY = {"jobs": [{"id": "abc-123", "title": "Data Engineer", "location": "Remote", "isRemote": True,
                   "employmentType": "FullTime", "descriptionPlain": "Airflow, SQL", "jobUrl": "https://jobs.ashbyhq.com/acme/abc-123",
                   "applyUrl": "https://jobs.ashbyhq.com/acme/abc-123/application", "publishedAt": "2026-11-02T00:00:00Z",
                   "isListed": True},
                  {"id": "hidden", "title": "Unlisted", "isListed": False}]}
CAREER_HTML = """<html><head><title>Careers</title><script type="application/ld+json">
{"@context":"https://schema.org","@type":"JobPosting","title":"AI Engineer","description":"<p>Python, LLMs</p>",
 "datePosted":"2026-11-01","validThrough":"2099-01-01","employmentType":"FULL_TIME",
 "hiringOrganization":{"@type":"Organization","name":"Acme Robotics"},
 "jobLocation":{"@type":"Place","address":{"addressLocality":"Austin","addressRegion":"TX","addressCountry":"US"}},
 "identifier":{"@type":"PropertyValue","value":"AI-7"},"url":"https://careers.example.com/jobs/ai-7"}
</script></head><body>Jobs</body></html>"""


def mock_client(routes: dict[str, tuple[int, object]]) -> SafeHttpClient:
    def handler(req: httpx.Request) -> httpx.Response:
        for prefix, (status, body) in routes.items():
            if str(req.url).startswith(prefix):
                if isinstance(body, str):
                    return httpx.Response(status, text=body, headers={"content-type": "text/html"})
                return httpx.Response(status, json=body)
        return httpx.Response(404, json={})

    return SafeHttpClient(allow_private=True, min_interval=0, transport=httpx.MockTransport(handler))


def test_greenhouse_adapter_normalises():
    c = mock_client({"https://boards-api.greenhouse.io/v1/boards/acme/jobs": (200, GH_JOBS),
                     "https://boards-api.greenhouse.io/v1/boards/acme": (200, {"name": "Acme Inc"})})
    jobs = GreenhouseAdapter(c).discover_jobs("https://boards.greenhouse.io/acme", SearchCriteria())
    assert len(jobs) == 2
    j = jobs[0]
    assert j.company == "Acme Inc" and j.external_id == "acme:101" and j.workplace_type == "remote"
    assert "3+ years Python" in j.description_text and "<li>" not in j.description_text


def test_greenhouse_status_check_expired():
    c = mock_client({"https://boards-api.greenhouse.io/v1/boards/acme/jobs/101": (404, {})})
    assert GreenhouseAdapter(c).check_job_status("acme", "acme:101") == "expired"


def test_lever_adapter():
    c = mock_client({"https://api.lever.co/v0/postings/acme": (200, LEVER)})
    [j] = LeverAdapter(c).discover_jobs("acme", SearchCriteria())
    assert j.workplace_type == "hybrid" and j.salary_min == 70000 and j.salary_currency == "EUR"
    assert "Python" in j.description_text and j.application_url.endswith("/apply")
    eu = mock_client({"https://api.eu.lever.co/v0/postings/acme": (200, LEVER)})
    assert LeverAdapter(eu).discover_jobs("eu:acme", SearchCriteria())


def test_ashby_adapter_skips_unlisted():
    c = mock_client({"https://api.ashbyhq.com/posting-api/job-board/acme": (200, ASHBY)})
    jobs = AshbyAdapter(c).discover_jobs("acme", SearchCriteria())
    assert [j.title for j in jobs] == ["Data Engineer"]
    assert jobs[0].workplace_type == "remote"


def test_career_page_jsonld(monkeypatch):
    c = mock_client({"https://careers.example.com/robots.txt": (404, ""),
                     "https://careers.example.com/": (200, CAREER_HTML)})
    adapter = CareerPageAdapter(c)
    import app.adapters.job_sources.career_page as cp

    monkeypatch.setattr(cp, "validate_url", lambda url, **k: url)  # DNS-free in tests
    jobs = adapter.discover_jobs("https://careers.example.com/", SearchCriteria())
    assert len(jobs) == 1
    assert jobs[0].company == "Acme Robotics" and jobs[0].location == "Austin, TX, US"


def test_career_page_respects_robots(monkeypatch):
    from app.adapters.job_sources import base

    base._robots_cache.clear()
    c = mock_client({"https://blocked.example.com/robots.txt": (200, "User-agent: *\nDisallow: /"),
                     "https://blocked.example.com/": (200, CAREER_HTML)})
    import app.adapters.job_sources.career_page as cp

    monkeypatch.setattr(cp, "validate_url", lambda url, **k: url)
    check = CareerPageAdapter(c).validate_source_access("https://blocked.example.com/")
    assert not check.ok and "robots.txt" in check.message


def nj(**kw) -> NormalizedJob:
    base = dict(source_kind="manual", external_id="x", company="Acme", title="Machine Learning Engineer",
                location="Austin, TX", workplace_type="onsite", description_text="Python PyTorch")
    return NormalizedJob(**(base | kw))


def test_filters():
    c = SearchCriteria(target_roles=["ML Engineer"], workplace_types=["remote", "hybrid"])
    assert any("work style" in r for r in filter_reasons(nj(), c))
    assert filter_reasons(nj(workplace_type="remote"), c) == []
    assert filter_reasons(nj(title="Office Manager", workplace_type="remote"), c)
    c2 = SearchCriteria(locations=["Berlin"], salary_min=100000, exclude_companies=["acme"])
    reasons = filter_reasons(nj(salary_max=80000), c2)
    assert len(reasons) == 3
    c3 = SearchCriteria(posted_within_days=7, required_technologies=["Kubernetes"])
    old = nj(posted_at=datetime.now(UTC) - timedelta(days=30))
    assert len(filter_reasons(old, c3)) == 2
    assert filter_reasons(nj(expires_at=datetime.now(UTC) - timedelta(days=1)), SearchCriteria())


def test_dedupe_key():
    assert dedupe_key("Acme, Inc.", "ML Engineer", "Austin, TX") == dedupe_key("acme inc", "ML  Engineer", "Austin")


def test_html_to_text():
    assert html_to_text("<ul><li>One</li><li>Two</li></ul><script>x()</script>").split() == ["•", "One", "•", "Two"]


def test_discovery_dedupes_and_expires(client, monkeypatch):
    """Two sources list the same job → one visible job; a job that vanishes is marked expired."""
    from app.adapters import job_sources
    from app.services import discovery

    listings = {"a": [nj(external_id="a1", workplace_type="remote"), nj(external_id="a2", title="Data Engineer")],
                "b": [nj(external_id="b1", source_kind="lever", workplace_type="remote")]}

    class Fake(job_sources.JobSourceAdapter):
        kind = "greenhouse"
        complete_listing = True

        def validate_source_access(self, identifier):  # noqa: ANN001
            return job_sources.SourceCheck(True, "ok", identifier)

        def discover_jobs(self, identifier, criteria):  # noqa: ANN001
            return listings[identifier]

        def fetch_job_details(self, identifier, external_id):  # noqa: ANN001
            return None

        def normalize_job(self, raw, identifier):  # noqa: ANN001
            return raw

    monkeypatch.setattr(discovery, "get_adapter", lambda kind, credentials=None: Fake())
    monkeypatch.setattr("app.api.jobs.get_adapter", lambda kind, credentials=None: Fake())
    for ident in ("a", "b"):
        assert client.post("/api/sources", json={"kind": "greenhouse" if ident == "a" else "lever",
                                                 "identifier": ident}).status_code == 201
    r = client.post("/api/jobs/discover", json={})
    assert r.status_code == 202, r.text
    task = client.get(f"/api/agent/tasks/{r.json()['task_id']}").json()
    assert task["state"] == "COMPLETED", task
    jobs = client.get("/api/jobs").json()
    assert jobs["total"] == 2  # a1 + a2 visible, b1 hidden as duplicate of a1
    hidden = client.get("/api/jobs", params={"view": "hidden"}).json()
    assert hidden["total"] == 1 and hidden["items"][0]["duplicate_of_id"]
    listings["a"] = [listings["a"][0]]
    client.post("/api/jobs/discover", json={})
    expired = client.get("/api/jobs", params={"view": "expired"}).json()
    assert [j["title"] for j in expired["items"]] == ["Data Engineer"]


def test_import_unsupported_platform_rejected(client):
    r = client.post("/api/jobs/import-url", json={"url": "https://www.linkedin.com/jobs/view/123"})
    assert r.status_code == 422 and "LinkedIn" in r.json()["detail"]


def test_source_catalog_lists_unsupported(client):
    cat = client.get("/api/sources/catalog").json()
    kinds = {s["kind"] for s in cat["supported"]}
    assert {"greenhouse", "lever", "ashby", "career_page"} <= kinds
    assert {u["platform"] for u in cat["unsupported"]} >= {"linkedin", "indeed", "naukri"}


@pytest.mark.parametrize("url", [
    "http://127.0.0.1/careers", "http://localhost:8000/", "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/jobs", "http://[::1]/", "file:///etc/passwd", "gopher://example.com", "http://user:pw@example.com/",
    "http://metadata.google.internal/", "http://192.168.1.1/",
])
def test_ssrf_blocked(url):
    from app.security.ssrf import UnsafeURLError, validate_url

    with pytest.raises(UnsafeURLError):
        validate_url(url, allowlist=set())


def test_ssrf_redirect_to_private_blocked():
    from app.security.ssrf import UnsafeURLError

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "http://127.0.0.1/admin"})

    import app.security.ssrf as ssrf

    real = ssrf.validate_url

    def fake_validate(url, allow_private=False, allowlist=None):  # noqa: ANN001
        if "public.example.com" in url:
            return url
        return real(url, allow_private=False, allowlist=set())

    ssrf.validate_url = fake_validate
    try:
        c = SafeHttpClient(min_interval=0, transport=httpx.MockTransport(handler))
        with pytest.raises(UnsafeURLError):
            c.get("https://public.example.com/jobs")
    finally:
        ssrf.validate_url = real


def test_ssrf_via_career_source_api(client):
    r = client.post("/api/sources", json={"kind": "career_page", "identifier": "http://127.0.0.1:5432/"})
    assert r.status_code == 400 and "not allowed" in r.json()["detail"].lower()
    r = client.post("/api/jobs/import-url", json={"url": "http://169.254.169.254/latest/meta-data/"})
    assert r.status_code == 422


def test_non_admin_cannot_use_private_llm_endpoint(client, other_client):
    r = other_client.post("/api/ai-providers", json={"name": "x", "provider": "openai_compatible",
                                                     "base_url": "http://postgres:5432/v1", "model": "m"})
    assert r.status_code == 400
    _ = json  # keep import
