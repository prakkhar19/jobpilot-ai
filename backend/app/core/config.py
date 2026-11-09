"""Application settings, loaded from environment variables (see docs/ENVIRONMENT.md)."""

from __future__ import annotations

import os
import secrets
import time
from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore", case_sensitive=False)

    app_name: str = "JobPilot AI"
    environment: str = Field(default="production", description="production | development | test")
    log_level: str = "INFO"

    database_url: str = "postgresql+psycopg://jobpilot:jobpilot@postgres:5432/jobpilot"
    redis_url: str = "redis://redis:6379/0"

    # Secret used for session/CSRF HMACs and to derive the at-rest encryption key.
    # If empty, a random key is generated once and persisted at ``{data_dir}/secrets/app_secret``.
    app_secret_key: str = ""
    data_dir: Path = Path("/data")

    public_base_url: str = "http://localhost:8080"
    # How the worker reaches the backend over the container network (used for the sandbox mock portal).
    internal_base_url: str = "http://backend:8000"
    cookie_secure: bool = False  # set true behind HTTPS
    session_ttl_hours: int = 24 * 7
    session_idle_timeout_hours: int = 24 * 2

    allow_registration: bool = True
    # Single-user mode: registration closes after the first account (which becomes admin).
    single_user_mode: bool = False
    password_reset_log_links: bool = False  # development only: print reset links to logs

    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_starttls: bool = True

    max_upload_mb: int = 10
    demo_mode: bool = False  # enables the clearly-labelled sandbox job board + mock application portal

    # Allow LLM base URLs that resolve to private networks (e.g. Ollama on the host / LAN).
    allow_private_llm_endpoints: bool = True
    # Comma-separated hostnames that job-source fetching may reach even if private (for testing).
    fetch_allowlist: str = ""
    outbound_user_agent: str = "JobPilotAI/0.1 (+https://github.com/jobpilot-ai/jobpilot-ai)"
    per_host_min_interval_seconds: float = 1.0

    rate_limit_login_per_minute: int = 10
    rate_limit_register_per_hour: int = 20

    celery_eager: bool = False
    browser_headless: bool = True
    data_retention_days_logs: int = 90

    @field_validator("environment")
    @classmethod
    def _env(cls, v: str) -> str:
        v = v.lower()
        if v not in {"production", "development", "test"}:
            raise ValueError("ENVIRONMENT must be production, development or test")
        return v

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def generated_dir(self) -> Path:
        return self.data_dir / "generated"

    @property
    def screenshots_dir(self) -> Path:
        return self.data_dir / "screenshots"

    @property
    def secret_key(self) -> str:
        return _resolve_secret(self)

    @property
    def fetch_allowlist_hosts(self) -> set[str]:
        return {h.strip().lower() for h in self.fetch_allowlist.split(",") if h.strip()}


_secret_cache: dict[str, str] = {}


def _resolve_secret(s: Settings) -> str:
    if s.app_secret_key:
        if len(s.app_secret_key) < 32:
            raise RuntimeError("APP_SECRET_KEY must be at least 32 characters")
        return s.app_secret_key
    key = str(s.data_dir)
    if key in _secret_cache:
        return _secret_cache[key]
    path = s.data_dir / "secrets" / "app_secret"
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        # Publish atomically: write a temp file, then hard-link it into place (fails if another process won).
        tmp = path.with_name(f".app_secret.{os.getpid()}.{secrets.token_hex(4)}")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as fh:
            fh.write(secrets.token_urlsafe(48))
            fh.flush()
            os.fsync(fh.fileno())
        try:
            os.link(tmp, path)
        except FileExistsError:
            pass
        finally:
            tmp.unlink(missing_ok=True)
    for _ in range(50):
        value = path.read_text().strip()
        if len(value) >= 32:
            _secret_cache[key] = value
            return value
        time.sleep(0.1)
    raise RuntimeError(f"Secret file {path} is empty or too short")


@lru_cache
def get_settings() -> Settings:
    return Settings()
