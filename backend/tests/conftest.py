"""Test fixtures. Uses SQLite by default; set TEST_DATABASE_URL to run against PostgreSQL."""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp(prefix="jobpilot-test-"))
os.environ.setdefault("ENVIRONMENT", "test")
os.environ["DATA_DIR"] = str(_tmp)
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", f"sqlite:///{_tmp}/test.db")
os.environ.setdefault("APP_SECRET_KEY", "test-secret-key-0123456789-abcdefghijklmnop")
os.environ.setdefault("CELERY_EAGER", "true")
os.environ.setdefault("DEMO_MODE", "true")
os.environ.setdefault("PER_HOST_MIN_INTERVAL_SECONDS", "0")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.models  # noqa: E402,F401
from app.core.database import Base, get_engine  # noqa: E402
from app.core.ratelimit import limiter  # noqa: E402

PASSWORD = "Correct-Horse-42"


@pytest.fixture(autouse=True)
def _db():
    engine = get_engine()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    limiter.reset()
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture(scope="session")
def app():
    from app.main import create_app

    yield create_app()
    shutil.rmtree(_tmp, ignore_errors=True)


class ApiClient(TestClient):
    """TestClient that automatically sends the CSRF header after login."""

    csrf: str | None = None

    def request(self, method, url, **kwargs):  # noqa: ANN001, ANN003
        if self.csrf and method.upper() not in ("GET", "HEAD", "OPTIONS"):
            headers = dict(kwargs.pop("headers", None) or {})
            headers.setdefault("X-CSRF-Token", self.csrf)
            kwargs["headers"] = headers
        return super().request(method, url, **kwargs)


def make_client(app, email: str = "alex@example.com", name: str = "Alex Example") -> ApiClient:
    c = ApiClient(app)
    r = c.post("/api/auth/register", json={"email": email, "password": PASSWORD, "full_name": name})
    assert r.status_code == 201, r.text
    c.csrf = r.json()["csrf_token"]
    return c


@pytest.fixture
def client(app) -> ApiClient:
    return make_client(app)


@pytest.fixture
def other_client(app) -> ApiClient:
    return make_client(app, "blair@example.com", "Blair Sample")


@pytest.fixture
def anon(app) -> ApiClient:
    return ApiClient(app)


# --------------------------------------------------------------------------- shared helpers

def upload_and_approve(client: ApiClient, facts: dict | None = None) -> dict:
    from tests.fixtures import make_docx

    r = client.post("/api/resumes", files={"file": ("resume.docx", make_docx())}, data={"use_llm": "false"})
    assert r.status_code == 201, r.text
    prof = r.json()["profile"]
    if facts:
        prof["application_facts"] = facts
        client.put(f"/api/profiles/{prof['id']}", json=prof)
    a = client.post(f"/api/profiles/{prof['id']}/approve")
    assert a.status_code == 200, a.text
    return a.json()


def import_job(client: ApiClient, description: str | None = None, title: str = "Machine Learning Engineer",
               company: str = "Example Corp") -> dict:
    from tests.fixtures import JD_ML

    r = client.post("/api/jobs/import-manual", json={"title": title, "company": company,
                                                     "description": description or JD_ML, "location": "Remote",
                                                     "workplace_type": "remote", "url": "https://example.com/jobs/1"})
    assert r.status_code == 201, r.text
    return r.json()


class MockLLM:
    """Patches the OpenAI-compatible client so every completion returns ``reply(system, user)``."""

    def __init__(self, monkeypatch, reply) -> None:  # noqa: ANN001
        import json as _json

        import httpx

        from app.adapters.llm import openai_compat

        self.calls: list[dict] = []

        def handler(request: httpx.Request) -> httpx.Response:
            body = _json.loads(request.content)
            if request.url.path.endswith("/embeddings"):
                return httpx.Response(404, json={"error": {"message": "no embeddings"}})
            msgs = body["messages"]
            self.calls.append(body)
            text = reply(msgs[0]["content"], msgs[1]["content"])
            return httpx.Response(200, json={"choices": [{"message": {"content": text}, "finish_reason": "stop"}],
                                             "usage": {"prompt_tokens": 10, "completion_tokens": 5}, "model": "mock"})

        transport = httpx.MockTransport(handler)
        orig = openai_compat.OpenAICompatibleClient.__init__

        def patched(self_, **kw):  # noqa: ANN001, ANN003
            kw["transport"] = transport
            kw["max_retries"] = 0
            orig(self_, **kw)

        monkeypatch.setattr(openai_compat.OpenAICompatibleClient, "__init__", patched)

    @staticmethod
    def configure(client: ApiClient) -> None:
        r = client.post("/api/ai-providers", json={"name": "mock", "provider": "openai_compatible",
                                                   "base_url": "https://llm.example.com/v1", "model": "mock-model",
                                                   "api_key": "sk-mock-1234567890"})
        assert r.status_code == 201, r.text


@pytest.fixture(scope="session")
def live_server(app):
    """Run the app with uvicorn in a thread (used for the sandbox portal + Playwright tests)."""
    import socket
    import threading
    import time

    import uvicorn

    from app.core.config import get_settings

    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    base = f"http://127.0.0.1:{port}"
    s = get_settings()
    s.internal_base_url = base
    s.public_base_url = base
    yield base
    server.should_exit = True
