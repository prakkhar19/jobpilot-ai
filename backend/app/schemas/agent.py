from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class AgentConfigIn(BaseModel):
    enabled: bool = False
    frequency_hours: int = Field(default=24, ge=1, le=168)
    run_days: list[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4])
    window_start_hour: int = Field(default=8, ge=0, le=23)
    window_end_hour: int = Field(default=20, ge=0, le=23)
    timezone: str = Field(default="UTC", max_length=60)
    target_roles: list[str] = Field(default_factory=list, max_length=30)
    keywords: list[str] = Field(default_factory=list, max_length=50)
    excluded_keywords: list[str] = Field(default_factory=list, max_length=50)
    locations: list[str] = Field(default_factory=list, max_length=30)
    countries: list[str] = Field(default_factory=list, max_length=30)
    workplace_types: list[Literal["remote", "hybrid", "onsite"]] = Field(default_factory=list)
    experience_levels: list[Literal["intern", "junior", "mid", "senior", "lead", "staff", "principal"]] = Field(default_factory=list)
    employment_types: list[str] = Field(default_factory=list, max_length=10)
    salary_min: float | None = Field(default=None, ge=0)
    include_companies: list[str] = Field(default_factory=list, max_length=100)
    exclude_companies: list[str] = Field(default_factory=list, max_length=100)
    industries: list[str] = Field(default_factory=list, max_length=30)
    required_technologies: list[str] = Field(default_factory=list, max_length=30)
    posted_within_days: int | None = Field(default=None, ge=1, le=365)
    min_match_score: float = Field(default=60, ge=0, le=100)
    daily_discovery_limit: int = Field(default=200, ge=1, le=2000)
    max_preparations_per_day: int = Field(default=5, ge=0, le=50)
    auto_generate_documents: bool = True
    auto_prepare_applications: bool = False
    application_mode: Literal["review", "assisted", "authorized"] = "review"
    acknowledge_authorized_automation: bool = False
    matching_weights: dict[str, float] = Field(default_factory=dict)
    resume_template: str = "classic"
    use_llm: bool = True

    @field_validator("run_days")
    @classmethod
    def _days(cls, v: list[int]) -> list[int]:
        if any(d < 0 or d > 6 for d in v):
            raise ValueError("run_days must be 0 (Mon) .. 6 (Sun)")
        return sorted(set(v))

    @field_validator("target_roles", "keywords", "excluded_keywords", "locations", "countries", "employment_types",
                     "include_companies", "exclude_companies", "industries", "required_technologies")
    @classmethod
    def _strip(cls, v: list[str]) -> list[str]:
        return [x.strip()[:120] for x in v if x and x.strip()]


class AgentConfigOut(AgentConfigIn):
    model_config = ConfigDict(from_attributes=True)
    paused: bool
    authorized_automation_ack_at: datetime | None
    last_run_at: datetime | None
    next_run_at: datetime | None
    effective_weights: dict[str, float] = {}


class AgentTaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    kind: str
    trigger: str
    state: str
    cancel_requested: bool
    attempt: int
    stats: dict
    error: str
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    heartbeat_at: datetime | None


class AgentLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    task_id: uuid.UUID
    level: str
    step: str
    message: str
    data: dict
    created_at: datetime


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    kind: str
    title: str
    body: str
    link: str
    read_at: datetime | None
    created_at: datetime
