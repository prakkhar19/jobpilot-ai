"""Search-everywhere sources, job-alert email import, official-posting resolution and instant alerts."""

from __future__ import annotations

from datetime import UTC, datetime
from email.message import EmailMessage

import httpx
import pytest

from app.adapters.job_sources import SearchCriteria
from app.adapters.job_sources.email_alerts import EmailAlertsAdapter, parse_alert_email, platform_for_sender
from app.adapters.job_sources.search_apis import AdzunaAdapter, ArbeitnowAdapter, RemotiveAdapter
from app.security.ssrf import SafeHttpClient
from app.services import company_resolver
from tests.conftest import upload_and_approve


def mock_client(handler) -> SafeHttpClient:  # noqa: ANN001
    return SafeHttpClient(allow_private=True, min_interval=0, transport=httpx.MockTransport(handler))


ADZUNA = {"results": [{"id": "42", "title": "Machine Learning Engineer", "company": {"display_name": "Acme AI"},
                       "location": {"display_name": "Bengaluru, Karnataka"}, "description": "Python PyTorch NLP role",
                       "created": "2026-11-09T08:00:00Z", "redirect_url": "https://www.adzuna.in/details/42",
                       "salary_min": 2000000, "salary_max": 3000000, "salary_is_predicted": "0",
                       "contract_time": "full_time"}]}


def test_adzuna_searches_by_role_and_location():
    seen: list[httpx.URL] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req.url)
        return httpx.Response(200, json=ADZUNA)

    a = AdzunaAdapter(mock_client(handler), credentials={"app_id": "id", "app_key": "key"})
    jobs = a.discover_jobs("in", SearchCriteria(target_roles=["ML Engineer", "Data Scientist"], locations=["Bengaluru"]))
    assert len(jobs) == 1  # same job from two queries is de-duplicated
    j = jobs[0]
    assert j.company == "Acme AI" and j.salary_min == 2000000 and j.external_id == "in:42"
    assert {u.params["what"] for u in seen} == {"ML Engineer", "Data Scientist"}
    assert all(u.params["where"] == "Bengaluru" and u.params["app_key"] == "key" for u in seen)
    assert "/jobs/in/search/1" in str(seen[0])


def test_adzuna_requires_credentials_and_roles():
    a = AdzunaAdapter(mock_client(lambda r: httpx.Response(200, json=ADZUNA)))
    assert not a.validate_source_access("in").ok
    with pytest.raises(Exception, match="target roles"):
        AdzunaAdapter(mock_client(lambda r: httpx.Response(200, json=ADZUNA)),
                      credentials={"app_id": "a", "app_key": "b"}).discover_jobs("in", SearchCriteria())


def test_remotive_and_arbeitnow_normalise():
    rem = {"jobs": [{"id": 7, "url": "https://remotive.com/remote-jobs/x-7", "title": "Python Developer",
                     "company_name": "Remote Co", "job_type": "full_time", "publication_date": "2026-11-08T10:00:00",
                     "candidate_required_location": "India", "salary": "", "description": "<p>Django</p>"}]}
    [j] = RemotiveAdapter(mock_client(lambda r: httpx.Response(200, json=rem))).discover_jobs("remote", SearchCriteria())
    assert j.workplace_type == "remote" and j.location == "Remote (India)" and "Remotive" in j.description_text
    arb = {"data": [{"slug": "backend-dev-1", "company_name": "EU Co", "title": "Backend Developer", "description": "<p>Go</p>",
                     "remote": True, "url": "https://www.arbeitnow.com/jobs/x", "tags": [], "job_types": ["full time"],
                     "location": "Berlin", "created_at": 1794250529}]}
    jobs = ArbeitnowAdapter(mock_client(lambda r: httpx.Response(200, json=arb))).discover_jobs("europe", SearchCriteria())
    assert jobs[0].workplace_type == "remote" and jobs[0].posted_at is not None
    assert RemotiveAdapter.strict_interval and RemotiveAdapter.min_interval_minutes >= 360  # Remotive: max 4/day


LINKEDIN_ALERT = """<html><body><table>
<tr><td><a href="https://www.linkedin.com/comm/jobs/view/3901234567/?trackingId=abc">Machine Learning Engineer</a>
<p>Acme AI</p><p>Bengaluru, Karnataka, India (Remote)</p></td></tr>
<tr><td><a href="https://www.linkedin.com/comm/jobs/view/3909999999/?x=1">Senior Data Scientist</a>
<p>Beta Analytics</p><p>Pune, Maharashtra, India</p></td></tr>
<tr><td><a href="https://www.linkedin.com/comm/jobs/search?x">See all jobs</a></td></tr>
</table></body></html>"""
NAUKRI_ALERT = """<html><body><div><a href="https://www.naukri.com/job-listings-python-developer-gamma-tech-hyderabad-3-to-6-years-091125012345?src=alert">
Python Developer</a><span>Gamma Tech</span><span>Hyderabad</span></div></body></html>"""


def test_parse_linkedin_and_naukri_alerts():
    jobs = parse_alert_email("linkedin", LINKEDIN_ALERT, datetime(2026, 11, 9, tzinfo=UTC))
    assert [(j.title, j.company) for j in jobs] == [("Machine Learning Engineer", "Acme AI"),
                                                     ("Senior Data Scientist", "Beta Analytics")]
    assert jobs[0].application_url == "https://www.linkedin.com/jobs/view/3901234567/"
    assert jobs[0].workplace_type == "remote" and jobs[0].external_id == "linkedin:3901234567"
    [n] = parse_alert_email("naukri", NAUKRI_ALERT, None)
    assert n.title == "Python Developer" and n.company == "Gamma Tech" and n.external_id == "naukri:091125012345"


def test_sender_detection():
    assert platform_for_sender("LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>") == "linkedin"
    assert platform_for_sender("Naukri <info@naukri.com>") == "naukri"
    assert platform_for_sender("Wellfound <team@wellfound.com>") == "wellfound"
    assert platform_for_sender("Mom <mom@gmail.com>") is None


class FakeIMAP:
    """Stands in for imaplib.IMAP4_SSL; records that mail is only read, never modified."""

    instances: list[FakeIMAP] = []

    def __init__(self, host, port, timeout=None):  # noqa: ANN001
        self.commands: list[str] = []
        FakeIMAP.instances.append(self)

    def login(self, u, p):  # noqa: ANN001
        if p != "app-pass":
            import imaplib

            raise imaplib.IMAP4.error("auth failed")
        return "OK", []

    def select(self, box, readonly=False):  # noqa: ANN001
        self.commands.append(f"select readonly={readonly}")
        return "OK", [b"2"]

    def search(self, charset, *criteria):  # noqa: ANN001
        domain = criteria[-1]
        return "OK", [b"1" if domain == "linkedin.com" else (b"2" if domain == "gmail.com" else b"")]

    def fetch(self, msg_id, parts):  # noqa: ANN001
        self.commands.append(f"fetch {parts}")
        msg = EmailMessage()
        msg["From"] = "LinkedIn <jobalerts-noreply@linkedin.com>"
        msg["Date"] = "Mon, 09 Nov 2026 08:00:00 +0000"
        msg.set_content("plain")
        msg.add_alternative(LINKEDIN_ALERT, subtype="html")
        return "OK", [(b"1", msg.as_bytes())]

    def logout(self):
        return "OK", []


def test_email_alerts_adapter_reads_only(monkeypatch):
    import app.adapters.job_sources.email_alerts as ea

    monkeypatch.setattr(ea.imaplib, "IMAP4_SSL", FakeIMAP)
    monkeypatch.setattr(ea, "validate_url", lambda url, **k: url)
    FakeIMAP.instances.clear()
    creds = {"imap_host": "imap.gmail.com", "username": "me@example.com", "password": "app-pass"}
    jobs = EmailAlertsAdapter(credentials=creds).discover_jobs("INBOX", SearchCriteria())
    assert {j.title for j in jobs} == {"Machine Learning Engineer", "Senior Data Scientist"}
    cmds = FakeIMAP.instances[0].commands
    assert "select readonly=True" in cmds and all("PEEK" in c for c in cmds if c.startswith("fetch"))
    bad = EmailAlertsAdapter(credentials=creds | {"password": "wrong"}).validate_source_access("INBOX")
    assert not bad.ok and "App Password" in bad.message


def test_email_alerts_rejects_private_imap_host():
    check = EmailAlertsAdapter(credentials={"imap_host": "127.0.0.1", "username": "a", "password": "b"}
                               ).validate_source_access("INBOX")
    assert not check.ok


GH_BOARD = {"jobs": [{"id": 555, "title": "Machine Learning Engineer, NLP", "location": {"name": "Bengaluru, India"},
                      "absolute_url": "https://job-boards.greenhouse.io/acmeai/jobs/555",
                      "content": "&lt;p&gt;Full official description of the role and team.&lt;/p&gt;&lt;h3&gt;Requirements&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;3+ years Python&lt;/li&gt;&lt;li&gt;PyTorch&lt;/li&gt;&lt;li&gt;Kubernetes&lt;/li&gt;&lt;/ul&gt;"},
                     {"id": 556, "title": "Office Manager", "location": {"name": "Bengaluru"}, "absolute_url": "x",
                      "content": "admin"}]}


def gh_handler(req: httpx.Request) -> httpx.Response:
    if "boards-api.greenhouse.io/v1/boards/acmeai/jobs" in str(req.url):
        return httpx.Response(200, json=GH_BOARD)
    if str(req.url).rstrip("/").endswith("boards/acmeai"):
        return httpx.Response(200, json={"name": "Acme AI"})
    return httpx.Response(404, json={})


def test_resolver_finds_official_posting():
    company_resolver._cache.clear()
    res = company_resolver.find_official_posting("Acme AI Pvt Ltd", "Machine Learning Engineer", "Bengaluru",
                                                 client=mock_client(gh_handler))
    assert res is not None and res.platform == "greenhouse"
    assert res.job.application_url == "https://job-boards.greenhouse.io/acmeai/jobs/555"
    company_resolver._cache.clear()
    assert company_resolver.find_official_posting("Acme AI", "Chief Financial Officer", "",
                                                  client=mock_client(gh_handler)) is None


def test_candidate_tokens():
    assert company_resolver.candidate_tokens("Acme AI Technologies Pvt. Ltd.")[:2] == ["acmeai", "acme-ai"]


def test_find_official_endpoint_upgrades_job(client, monkeypatch):
    upload_and_approve(client)
    r = client.post("/api/jobs/import-manual", json={
        "title": "Machine Learning Engineer", "company": "Acme AI", "location": "Bengaluru",
        "description": "Imported from a LinkedIn job-alert email. Machine Learning Engineer at Acme AI.",
        "url": "https://www.linkedin.com/jobs/view/1/"})
    job = r.json()
    company_resolver._cache.clear()
    orig = company_resolver.find_official_posting
    monkeypatch.setattr(company_resolver, "find_official_posting",
                        lambda *a, **k: orig(*a, **(k | {"client": mock_client(gh_handler)})))
    out = client.post(f"/api/jobs/{job['id']}/find-official")
    assert out.status_code == 200, out.text
    d = out.json()
    assert d["official_url"].startswith("https://job-boards.greenhouse.io/acmeai")
    assert d["application_url"] == d["official_url"]
    assert "Full official description" in d["description_text"]
    assert any(r["skill_name"] == "Kubernetes" for r in d["requirements"])  # re-analysed with full description


def test_source_credentials_encrypted_and_hidden(client, monkeypatch):
    from app.adapters.job_sources import base

    monkeypatch.setattr(AdzunaAdapter, "validate_source_access",
                        lambda self, ident: base.SourceCheck(True, "ok", "Adzuna (IN)"))
    assert client.post("/api/sources", json={"kind": "adzuna", "identifier": "in"}).status_code == 400  # keys missing
    r = client.post("/api/sources", json={"kind": "adzuna", "credentials": {"app_id": "id1", "app_key": "very-secret-key"}})
    assert r.status_code == 201, r.text
    src = r.json()
    assert src["identifier"] == "in" and src["has_credentials"] is True
    assert "very-secret-key" not in client.get("/api/sources").text
    from sqlalchemy import select

    from app.core.database import SessionLocal
    from app.models import JobSource

    with SessionLocal() as db:
        row = db.scalars(select(JobSource)).one()
        assert "very-secret-key" not in row.credentials_encrypted
    cat = {s["kind"]: s for s in client.get("/api/sources/catalog").json()["supported"]}
    assert {f["key"] for f in cat["adzuna"]["credential_fields"]} == {"app_id", "app_key"}
    assert cat["directory"]["identifier_default"] == "all"


def test_strict_interval_respected_even_for_manual_runs(client, monkeypatch):
    from app.adapters.job_sources import base

    calls = {"n": 0}

    def fake_discover(self, identifier, criteria):  # noqa: ANN001
        calls["n"] += 1
        return []

    monkeypatch.setattr(RemotiveAdapter, "validate_source_access", lambda self, i: base.SourceCheck(True, "ok", "Remotive"))
    monkeypatch.setattr(RemotiveAdapter, "discover_jobs", fake_discover)
    upload_and_approve(client)
    client.post("/api/sources", json={"kind": "remotive"})
    client.post("/api/jobs/discover", json={})
    client.post("/api/jobs/discover", json={})
    assert calls["n"] == 1  # second run within 6 h is skipped to honour Remotive's 4-per-day rule


def test_new_strong_matches_trigger_alerts(client, live_server):
    upload_and_approve(client, {"Work authorization": "Yes"})
    cfg = client.get("/api/agent/config").json()
    assert cfg["frequency_minutes"] == 30 and cfg["window_start_hour"] == cfg["window_end_hour"]  # around the clock
    cfg.update({"target_roles": ["Machine Learning Engineer"], "min_match_score": 40, "auto_generate_documents": False})
    client.put("/api/agent/config", json=cfg)
    client.post("/api/sources", json={"kind": "demo", "identifier": "sandbox"})
    task = client.post("/api/agent/run").json()
    stats = client.get(f"/api/agent/tasks/{task['id']}").json()["stats"]
    assert stats["alerts_sent"] >= 1
    notes = client.get("/api/notifications").json()["items"]
    assert any(n["kind"] == "match" and n["title"].startswith("New match") for n in notes)


def test_frequency_minimum_is_15_minutes(client):
    cfg = client.get("/api/agent/config").json()
    cfg["frequency_minutes"] = 5
    assert client.put("/api/agent/config", json=cfg).status_code == 422


NAUKRI_CARD_ALERT = """<html><body><table>
<tr><td><a href="https://www.naukri.com/jd/job-listings-ai-engineer-acme-labs-new-delhi-0-to-2-years-291026501289?xp=1&src=cja">
<table><tr><td>AI Engineer</td></tr><tr><td>Acme Labs</td><td>4.0</td></tr><tr><td>New Delhi</td></tr></table></a></td></tr>
<tr><td><a href="https://www.naukri.com/jd/job-listings-ai-engineer-acme-labs-new-delhi-0-to-2-years-291026501289?xp=1">AI Engineer</a></td></tr>
<tr><td><a href="https://www.naukri.com/jd/job-listings-full-stack-developer-qubixl-noida-1-to-3-years-071126000111?xp=1">
<table><tr><td>Q</td><td>Full Stack Developer</td></tr><tr><td>qubixl</td></tr><tr><td>Noida</td></tr></table></a></td></tr>
<tr><td><a href="https://www.ambitionbox.com/reviews/acme-labs-reviews">Reviews</a></td></tr>
</table></body></html>"""


def test_parse_naukri_card_alerts_with_jd_links():
    jobs = sorted(parse_alert_email("naukri", NAUKRI_CARD_ALERT, None), key=lambda j: j.title)
    assert [(j.title, j.company, j.location) for j in jobs] == [
        ("AI Engineer", "Acme Labs", "New Delhi"), ("Full Stack Developer", "qubixl", "Noida")]
    assert jobs[0].external_id == "naukri:291026501289"
    assert "?" not in jobs[0].application_url


def test_role_matching_handles_spelling_variants():
    from app.services.discovery import _role_matches
    yes = [("Fullstack Developer - React", "Full-Stack Developer"), ("Full Stack Developer", "Full-Stack Developer"),
           ("Back End Engineer", "Backend Developer"), ("AI Engineer", "LLM Engineer"),
           ("Generative AI Engineer", "LLM Engineer"), ("AI Ml Engineer", "LLM Engineer"),
           ("Artificial Intelligence Engineer", "LLM Engineer"), ("SDE II", "Software Engineer"),
           ("DevOps Engineer", "Dev Ops Engineer")]
    no = [("Flutter Developer", "Full-Stack Developer"), ("PHP Developer", "Backend Developer"),
          ("Data Entry Executive", "LLM Engineer"), ("AI-Powered Data Analyst", "LLM Engineer"),
          ("Business Development Associate", "Software Engineer")]
    for title, role in yes:
        assert _role_matches(title, role), (title, role)
    for title, role in no:
        assert not _role_matches(title, role), (title, role)


def test_india_region_filter():
    from app.adapters.job_sources.base import NormalizedJob
    from app.services.discovery import SearchCriteria, filter_reasons

    c = SearchCriteria(target_roles=["Software Engineer"], countries=["India"], locations=["Delhi"],
                       workplace_types=["remote", "hybrid", "onsite"])

    def ok(loc, wt="unknown", desc="") -> bool:
        nj = NormalizedJob(source_kind="greenhouse", external_id="1", company="X", title="Software Engineer",
                           location=loc, workplace_type=wt, description_text=desc)
        return not filter_reasons(nj, c)

    for loc in ["Bengaluru", "Hybrid - Gurugram", "Noida(Sector 63)", "Pune, Maharashtra", "Remote - India",
                "Remote (APAC)", "Toronto, Canada; Bengaluru, India", "Remote", "Worldwide"]:
        assert ok(loc), loc
    for loc in ["San Francisco, United States", "London, United Kingdom", "Mexico", "Remote, Europe, Switzerland",
                "Remote UK", "Remote, EMEA", "Remote - US", "Dublin"]:
        assert not ok(loc), loc
    assert not ok("Remote", "remote", "Applicants must be located in the United States.")
    assert ok("", "unknown")


def test_retired_model_gives_clear_error(monkeypatch):
    import httpx
    import pytest

    from app.adapters.llm.base import LLMError
    from app.adapters.llm.openai_compat import OpenAICompatibleClient

    monkeypatch.setattr("app.security.ssrf.validate_url", lambda url, **k: url)
    transport = httpx.MockTransport(lambda r: httpx.Response(410, json={"detail": "Function has reached end of life"}))
    c = OpenAICompatibleClient(model="old/model", api_key="k", base_url="https://llm.example.com/v1",
                               transport=transport, max_retries=0)
    with pytest.raises(LLMError) as exc:
        c.complete("s", "u")
    assert exc.value.status == 410 and "retired" in str(exc.value)


def test_provider_rejects_email_as_model_name():
    import pytest
    from pydantic import ValidationError

    from app.schemas.ai import AIProviderIn

    with pytest.raises(ValidationError, match="email address"):
        AIProviderIn(name="n", provider="openai_compatible", model="m", embedding_model="friend@gmail.com")
    ok = AIProviderIn(name="n", provider="openai_compatible", model=" nvidia/nemotron-3-super-120b-a12b ")
    assert ok.model == "nvidia/nemotron-3-super-120b-a12b"


def test_title_only_job_scores_on_target_role_and_is_capped():
    from types import SimpleNamespace

    from app.services.jd_analysis import JDAnalysis
    from app.services.matching import STUB_SCORE_CAP, CandidateFacts, normalize_weights, score_match

    facts = CandidateFacts()
    facts.text = "Built RAG pipelines with Python, LangChain and FastAPI. " * 20
    facts.titles = ["Software Engineer | Generative AI, LLMs & MERN Stack"]
    prefs = SimpleNamespace(target_roles=["LLM Engineer"], locations=["Noida"], workplace_types=["remote", "onsite"])
    stub = SimpleNamespace(title="Artificial Intelligence Engineer", location="Remote", workplace_type="remote",
                           seniority=None, description_text="Artificial Intelligence Engineer\nAcme · Remote\n\n"
                           "Imported from a Naukri job-alert email.")
    r = score_match(stub, JDAnalysis(), facts, weights=normalize_weights(None), prefs=prefs)
    role = next(c for c in r.components if c.key == "role_alignment")
    sim = next(c for c in r.components if c.key == "semantic_similarity")
    assert role.score == 1.0 and not sim.applicable
    assert r.overall == STUB_SCORE_CAP
    assert any("Only the title is known" in u for u in r.unknowns)
