from __future__ import annotations

import io
import zipfile

import httpx
import pytest

from tests.fixtures import make_docx, make_pdf


def upload(client, data: bytes, name: str = "resume.docx"):
    return client.post("/api/resumes", files={"file": (name, data)}, data={"use_llm": "false"})


@pytest.mark.parametrize("maker,name", [(make_docx, "resume.docx"), (make_pdf, "resume.pdf")])
def test_upload_parses_profile(client, maker, name):
    r = upload(client, maker(), name)
    assert r.status_code == 201, r.text
    p = r.json()["profile"]
    assert p["full_name"] == "Jordan Rivera"
    assert p["email"] == "jordan.rivera@example.com"
    assert p["status"] == "draft"
    assert [e["company"] for e in p["experiences"]] == ["Northwind Analytics", "Contoso Labs"]
    assert p["experiences"][0]["is_current"] is True
    assert len(p["experiences"][0]["bullets"]) == 3
    names = {s["name"] for s in p["skills"]}
    assert {"Python", "PyTorch", "Docker"} <= names
    assert p["educations"][0]["institution"] == "University of Texas at Austin"
    assert p["certifications"][0]["name"] == "AWS Certified Cloud Practitioner"


def test_original_resume_is_immutable_and_downloadable(client):
    data = make_docx()
    r = upload(client, data).json()
    rid = r["resume"]["id"]
    dl = client.get(f"/api/resumes/{rid}/download")
    assert dl.status_code == 200 and dl.content == data
    # editing the profile never touches the original
    pid = r["profile"]["id"]
    prof = client.get(f"/api/profiles/{pid}").json()
    prof["summary"] = "Edited summary"
    assert client.put(f"/api/profiles/{pid}", json=prof).status_code == 200
    assert client.get(f"/api/resumes/{rid}/download").content == data


def test_edit_and_approve(client):
    pid = upload(client, make_docx()).json()["profile"]["id"]
    prof = client.get(f"/api/profiles/{pid}").json()
    prof["skills"].append({"name": "kubernetes", "category": ""})
    prof["experiences"][0]["bullets"].append("Mentored two junior engineers")
    r = client.put(f"/api/profiles/{pid}", json=prof)
    assert r.status_code == 200
    body = r.json()
    assert "Kubernetes" in {s["name"] for s in body["skills"]}  # canonicalised
    assert body["version"] == 2
    a = client.post(f"/api/profiles/{pid}/approve")
    assert a.status_code == 200 and a.json()["status"] == "approved" and a.json()["is_active"]
    assert client.get("/api/profiles/active").json()["id"] == pid


def test_approve_requires_name_and_email(client):
    pid = client.post("/api/profiles").json()["id"]
    prof = client.get(f"/api/profiles/{pid}").json()
    prof["full_name"] = ""
    client.put(f"/api/profiles/{pid}", json=prof)
    assert client.post(f"/api/profiles/{pid}/approve").status_code == 400


def test_rejects_non_resume_files(client):
    assert upload(client, b"MZ\x90\x00 not a pdf", "evil.pdf").status_code == 400
    assert upload(client, b"%PDF-1.4 fake", "resume.exe").status_code == 400
    assert upload(client, b"", "empty.pdf").status_code == 400
    # zip without word/document.xml
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("[Content_Types].xml", "<x/>")
    assert upload(client, buf.getvalue(), "fake.docx").status_code == 400


def test_path_traversal_filename_is_sanitised(client):
    r = upload(client, make_docx(), "../../../../etc/passwd.docx")
    assert r.status_code == 201
    assert r.json()["resume"]["original_filename"] == "passwd.docx"


def test_oversized_upload_rejected(client, monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "max_upload_mb", 1)
    big = make_pdf() + b"0" * (2 * 1024 * 1024)
    assert upload(client, big, "big.pdf").status_code in (400, 413)


def test_llm_assisted_parse_drops_hallucinations(client, monkeypatch):
    """A (mock) LLM returns one fabricated employer and one fabricated skill — both must be discarded."""
    from app.adapters.llm import openai_compat

    fake = {
        "full_name": "Jordan Rivera", "email": "jordan.rivera@example.com",
        "experiences": [
            {"company": "Northwind Analytics", "title": "Machine Learning Engineer", "start_date": "Jan 2021",
             "end_date": "Present", "bullets": ["Reduced model inference latency by 35% by introducing batching and caching with Redis"]},
            {"company": "Google DeepMind", "title": "Staff Research Scientist", "bullets": ["Invented transformers"]},
        ],
        "skills": ["Python", "Rust", "PyTorch"],
    }
    import json

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(fake)}, "finish_reason": "stop"}],
                                         "usage": {"prompt_tokens": 100, "completion_tokens": 50}})

    transport = httpx.MockTransport(handler)
    orig = openai_compat.OpenAICompatibleClient.__init__

    def patched(self, **kw):
        kw["transport"] = transport
        orig(self, **kw)

    monkeypatch.setattr(openai_compat.OpenAICompatibleClient, "__init__", patched)
    monkeypatch.setattr("app.security.ssrf.validate_url", lambda url, **k: url)
    r = client.post("/api/ai-providers", json={"name": "mock", "provider": "openai_compatible",
                                               "base_url": "https://llm.example.com/v1", "model": "m", "api_key": "sk-test-123456789"})
    assert r.status_code == 201, r.text
    r = client.post("/api/resumes", files={"file": ("resume.docx", make_docx())}, data={"use_llm": "true"})
    assert r.status_code == 201, r.text
    p = r.json()["profile"]
    assert p["parse_method"] == "rules+llm"
    companies = [e["company"] for e in p["experiences"]]
    assert "Google DeepMind" not in companies
    assert all("Invented transformers" not in b for e in p["experiences"] for b in e["bullets"])
    assert "Rust" not in {s["name"] for s in p["skills"]}
    assert any("discarded" in w for w in p["parse_warnings"])
    prov = client.get("/api/ai-providers").json()[0]
    assert prov["total_requests"] >= 1 and prov["total_input_tokens"] >= 100
    assert "api_key" not in prov and prov["api_key_last4"] == "6789"
