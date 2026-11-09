"""Resolves a user's configured AI providers and runs completions with fallback + usage tracking."""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.adapters.llm.base import UNTRUSTED_NOTICE, LLMClient, LLMError, LLMResult, extract_json
from app.adapters.llm.factory import build_client
from app.core.config import get_settings
from app.models import AIProviderConfiguration, User
from app.security.crypto import decrypt

log = logging.getLogger(__name__)


def private_endpoints_allowed(user: User) -> bool:
    s = get_settings()
    return s.allow_private_llm_endpoints and (s.single_user_mode or user.role == "admin")


def client_from_config(cfg: AIProviderConfiguration, user: User) -> LLMClient:
    return build_client(
        cfg.provider,
        model=cfg.model,
        api_key=decrypt(cfg.api_key_encrypted),
        base_url=cfg.base_url,
        temperature=cfg.temperature,
        max_tokens=cfg.max_tokens,
        timeout=cfg.timeout_seconds,
        embedding_model=cfg.embedding_model,
        allow_private=private_endpoints_allowed(user),
    )


def estimate_cost(cfg: AIProviderConfiguration) -> float | None:
    if cfg.input_price_per_mtok is None or cfg.output_price_per_mtok is None:
        return None
    return round(
        cfg.total_input_tokens / 1e6 * cfg.input_price_per_mtok + cfg.total_output_tokens / 1e6 * cfg.output_price_per_mtok,
        4,
    )


def _record(db: Session, config_id: uuid.UUID, result: LLMResult | None, error: str = "") -> None:
    """Update usage counters (committed together with the caller's unit of work)."""
    values: dict = {"last_used_at": datetime.now(UTC), "total_requests": AIProviderConfiguration.total_requests + 1}
    if result is not None:
        values["total_input_tokens"] = AIProviderConfiguration.total_input_tokens + result.input_tokens
        values["total_output_tokens"] = AIProviderConfiguration.total_output_tokens + result.output_tokens
    if error:
        values["total_errors"] = AIProviderConfiguration.total_errors + 1
        values["last_error"] = error[:500]
    db.execute(update(AIProviderConfiguration).where(AIProviderConfiguration.id == config_id).values(**values))


class LLMRunner:
    def __init__(
        self, db: Session, user: User, primary: AIProviderConfiguration, fallback: AIProviderConfiguration | None
    ) -> None:
        self.db = db
        self.user = user
        self.primary = primary
        self.fallback = fallback

    @property
    def label(self) -> tuple[str, str]:
        return self.primary.provider, self.primary.model

    def complete(self, system: str, user_prompt: str, *, json_output: bool = False, max_tokens: int | None = None) -> LLMResult:
        system = f"{system}\n\n{UNTRUSTED_NOTICE}"
        errors: list[str] = []
        for cfg in [c for c in (self.primary, self.fallback) if c is not None]:
            try:
                client = client_from_config(cfg, self.user)
                result = client.complete(system, user_prompt, json_output=json_output, max_tokens=max_tokens)
                _record(self.db, cfg.id, result)
                return result
            except LLMError as exc:
                _record(self.db, cfg.id, None, str(exc))
                errors.append(f"{cfg.name}: {exc}")
                log.warning("LLM call failed", extra={"ctx": {"provider": cfg.provider, "error": str(exc)}})
        raise LLMError("; ".join(errors) or "No AI provider available")

    def complete_json(self, system: str, user_prompt: str, *, max_tokens: int | None = None) -> tuple[dict | list, LLMResult]:
        result = self.complete(system, user_prompt, json_output=True, max_tokens=max_tokens)
        return extract_json(result.text), result

    def embed(self, texts: list[str]) -> list[list[float]] | None:
        for cfg in [c for c in (self.primary, self.fallback) if c is not None]:
            if not cfg.embedding_model:
                continue
            try:
                vectors = client_from_config(cfg, self.user).embed(texts)
                _record(self.db, cfg.id, LLMResult("", cfg.provider, cfg.embedding_model, input_tokens=sum(len(t) // 4 for t in texts)))
                return vectors
            except LLMError as exc:
                _record(self.db, cfg.id, None, str(exc))
        return None


def get_runner(db: Session, user: User) -> LLMRunner | None:
    configs = db.scalars(
        select(AIProviderConfiguration).where(
            AIProviderConfiguration.user_id == user.id, AIProviderConfiguration.enabled.is_(True)
        )
    ).all()
    if not configs:
        return None
    primary = next((c for c in configs if c.is_default), None) or configs[0]
    fallback = next((c for c in configs if c.is_fallback and c.id != primary.id), None)
    return LLMRunner(db, user, primary, fallback)
