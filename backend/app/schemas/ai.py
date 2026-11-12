from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")


class AIProviderIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    provider: Literal["openai_compatible", "anthropic"]
    base_url: str = Field(default="", max_length=500)
    model: str = Field(min_length=1, max_length=200)
    embedding_model: str = Field(default="", max_length=200)
    api_key: str | None = Field(default=None, max_length=500, description="Omit to keep the stored key")
    temperature: float = Field(default=0.2, ge=0, le=2)
    max_tokens: int = Field(default=2000, ge=256, le=64000)
    timeout_seconds: int = Field(default=60, ge=5, le=600)
    is_default: bool = False
    is_fallback: bool = False
    enabled: bool = True
    input_price_per_mtok: float | None = Field(default=None, ge=0)
    output_price_per_mtok: float | None = Field(default=None, ge=0)

    @field_validator("model", "embedding_model")
    @classmethod
    def _model_name(cls, v: str) -> str:
        v = v.strip()
        if _EMAIL.match(v):
            raise ValueError("This looks like an email address, not a model name (your browser may have autofilled it).")
        if any(c.isspace() for c in v):
            raise ValueError("Model names cannot contain spaces.")
        return v


class AIProviderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    provider: str
    base_url: str
    model: str
    embedding_model: str
    has_api_key: bool = False
    api_key_last4: str
    temperature: float
    max_tokens: int
    timeout_seconds: int
    is_default: bool
    is_fallback: bool
    enabled: bool
    input_price_per_mtok: float | None
    output_price_per_mtok: float | None
    total_requests: int
    total_input_tokens: int
    total_output_tokens: int
    total_errors: int
    estimated_cost_usd: float | None = None
    last_error: str
    last_used_at: datetime | None
    created_at: datetime


class AITestResult(BaseModel):
    ok: bool
    message: str
    latency_ms: int | None = None
    model: str | None = None
