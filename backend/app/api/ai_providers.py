from __future__ import annotations

import time
import uuid

from fastapi import APIRouter, Request, Response
from sqlalchemy import select, update

from app.adapters.llm.base import LLMError
from app.adapters.llm.factory import PROVIDERS
from app.api.deps import DB, CurrentUser, client_ip, get_owned_or_404
from app.core.errors import DomainError
from app.models import AIProviderConfiguration
from app.schemas.ai import AIProviderIn, AIProviderOut, AITestResult
from app.security.crypto import encrypt
from app.security.ssrf import UnsafeURLError, validate_url
from app.services.audit import audit
from app.services.llm_service import client_from_config, estimate_cost, private_endpoints_allowed

router = APIRouter(prefix="/api/ai-providers", tags=["ai"])


def _out(cfg: AIProviderConfiguration) -> AIProviderOut:
    out = AIProviderOut.model_validate(cfg)
    out.has_api_key = bool(cfg.api_key_encrypted)
    out.estimated_cost_usd = estimate_cost(cfg)
    return out


@router.get("/catalog")
def catalog() -> dict:
    return PROVIDERS


@router.get("", response_model=list[AIProviderOut])
def list_providers(db: DB, user: CurrentUser) -> list[AIProviderOut]:
    rows = db.scalars(
        select(AIProviderConfiguration)
        .where(AIProviderConfiguration.user_id == user.id)
        .order_by(AIProviderConfiguration.created_at)
    ).all()
    return [_out(r) for r in rows]


def _apply(db: DB, user: CurrentUser, cfg: AIProviderConfiguration, body: AIProviderIn) -> None:
    if body.base_url:
        try:
            validate_url(body.base_url, allow_private=private_endpoints_allowed(user))
        except UnsafeURLError as exc:
            raise DomainError(
                f"Base URL not allowed: {exc}. Private/local endpoints are permitted only for administrators "
                "or in single-user mode when ALLOW_PRIVATE_LLM_ENDPOINTS=true."
            ) from exc
    if body.provider == "anthropic" and not (body.api_key or cfg.api_key_encrypted):
        raise DomainError("Anthropic requires an API key.")
    for field in ("name", "provider", "base_url", "model", "embedding_model", "temperature", "max_tokens",
                  "timeout_seconds", "is_default", "is_fallback", "enabled", "input_price_per_mtok",
                  "output_price_per_mtok"):
        setattr(cfg, field, getattr(body, field))
    if body.api_key is not None:
        key = body.api_key.strip()
        cfg.api_key_encrypted = encrypt(key) if key else ""
        cfg.api_key_last4 = key[-4:] if len(key) >= 8 else ""
    others = [AIProviderConfiguration.user_id == user.id]
    if cfg.id is not None:
        others.append(AIProviderConfiguration.id != cfg.id)
    if cfg.is_default:
        db.execute(update(AIProviderConfiguration).where(*others).values(is_default=False))
    if cfg.is_fallback:
        db.execute(update(AIProviderConfiguration).where(*others).values(is_fallback=False))


@router.post("", response_model=AIProviderOut, status_code=201)
def create_provider(body: AIProviderIn, db: DB, user: CurrentUser, request: Request) -> AIProviderOut:
    cfg = AIProviderConfiguration(user_id=user.id, id=uuid.uuid4())
    existing = db.scalar(select(AIProviderConfiguration.id).where(AIProviderConfiguration.user_id == user.id))
    if existing is None:
        body.is_default = True
    _apply(db, user, cfg, body)
    db.add(cfg)
    audit(db, user.id, "ai_provider.created", target_type="ai_provider", target_id=cfg.id, ip=client_ip(request),
          data={"provider": cfg.provider, "model": cfg.model})
    db.commit()
    return _out(cfg)


@router.put("/{provider_id}", response_model=AIProviderOut)
def update_provider(provider_id: uuid.UUID, body: AIProviderIn, db: DB, user: CurrentUser) -> AIProviderOut:
    cfg = get_owned_or_404(db, AIProviderConfiguration, provider_id, user, "AI provider")
    _apply(db, user, cfg, body)
    audit(db, user.id, "ai_provider.updated", target_type="ai_provider", target_id=cfg.id)
    db.commit()
    return _out(cfg)


@router.delete("/{provider_id}", status_code=204)
def delete_provider(provider_id: uuid.UUID, db: DB, user: CurrentUser) -> Response:
    cfg = get_owned_or_404(db, AIProviderConfiguration, provider_id, user, "AI provider")
    db.delete(cfg)
    audit(db, user.id, "ai_provider.deleted", target_type="ai_provider", target_id=provider_id)
    db.commit()
    return Response(status_code=204)


@router.post("/{provider_id}/test", response_model=AITestResult)
def test_provider(provider_id: uuid.UUID, db: DB, user: CurrentUser) -> AITestResult:
    cfg = get_owned_or_404(db, AIProviderConfiguration, provider_id, user, "AI provider")
    start = time.perf_counter()
    try:
        client = client_from_config(cfg, user)
        result = client.complete("You are a connectivity test. Reply with the single word OK.", "Reply with OK.", max_tokens=1024)
    except LLMError as exc:
        cfg.last_error = str(exc)[:500]
        db.commit()
        return AITestResult(ok=False, message=str(exc))
    except ValueError as exc:
        return AITestResult(ok=False, message=str(exc))
    cfg.last_error = ""
    db.commit()
    return AITestResult(
        ok=True,
        message=f"Connected. Model replied: {result.text.strip()[:60]!r}",
        latency_ms=int((time.perf_counter() - start) * 1000),
        model=result.model,
    )
