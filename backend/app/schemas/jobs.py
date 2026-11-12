from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl

SourceKind = Literal["directory", "adzuna", "remotive", "arbeitnow", "email_alerts", "greenhouse", "lever", "ashby",
                     "career_page", "demo"]


class SourceIn(BaseModel):
    kind: SourceKind
    identifier: str = Field(default="", max_length=500, description="Defaults to the source's standard identifier")
    display_name: str = Field(default="", max_length=200)
    enabled: bool = True
    credentials: dict[str, str] | None = Field(default=None, description="API keys / login for sources that need them")


class SourceUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=200)
    enabled: bool | None = None
    credentials: dict[str, str] | None = None


class SourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    kind: str
    identifier: str
    display_name: str
    enabled: bool
    last_checked_at: datetime | None
    last_status: str
    last_error: str
    jobs_found: int
    created_at: datetime
    has_credentials: bool = False


class RequirementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    kind: str
    text: str
    skill_name: str
    is_mandatory: bool
    value_num: float | None


class MatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    overall_score: float
    recommendation: str
    components: list[dict]
    strengths: list[str]
    gaps: list[str]
    unknowns: list[str]
    weights: dict
    llm_summary: str
    similarity_method: str
    computed_at: datetime
    profile_version: int


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    source_kind: str
    source_id: uuid.UUID | None
    company: str
    title: str
    location: str
    workplace_type: str
    employment_type: str
    seniority: str
    department: str
    salary_min: float | None
    salary_max: float | None
    salary_currency: str
    salary_text: str
    posted_at: datetime | None
    application_url: str
    posting_url: str
    discovered_at: datetime
    last_verified_at: datetime | None
    status: str
    is_demo: bool
    hidden: bool
    duplicate_of_id: uuid.UUID | None
    official_url: str = ""
    official_source: str = ""
    official_checked_at: datetime | None = None
    match_score: float | None = None
    recommendation: str | None = None
    saved: bool = False
    application_status: str | None = None
    application_id: uuid.UUID | None = None


class JobDetail(JobOut):
    description_text: str
    requirements: list[RequirementOut] = []
    match: MatchOut | None = None


class JobPage(BaseModel):
    items: list[JobOut]
    total: int
    page: int
    page_size: int


class ImportUrlIn(BaseModel):
    url: HttpUrl


class ImportManualIn(BaseModel):
    title: str = Field(min_length=2, max_length=300)
    company: str = Field(min_length=1, max_length=300)
    description: str = Field(min_length=30, max_length=60000)
    location: str = Field(default="", max_length=300)
    url: str = Field(default="", max_length=1000)
    workplace_type: Literal["remote", "hybrid", "onsite", "unknown"] = "unknown"
    employment_type: str = Field(default="", max_length=40)


class DiscoverIn(BaseModel):
    source_ids: list[uuid.UUID] | None = None


class SavedIn(BaseModel):
    note: str = Field(default="", max_length=2000)
