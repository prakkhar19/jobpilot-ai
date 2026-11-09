from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ResumeGenerateIn(BaseModel):
    job_id: uuid.UUID | None = None
    template: str = "classic"
    target_role: str = Field(default="", max_length=120)
    use_llm: bool = True


class ResumeVersionSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    job_id: uuid.UUID | None
    profile_id: uuid.UUID | None
    parent_version_id: uuid.UUID | None
    version_number: int
    label: str
    target_role: str
    template: str
    generation_method: str
    provider: str
    model: str
    created_at: datetime


class ResumeVersionOut(ResumeVersionSummary):
    content: dict
    change_log: list
    fact_check: dict


class ResumeEditIn(BaseModel):
    content: dict
    template: str | None = None


class CompareOut(BaseModel):
    original: dict
    tailored: dict
    change_log: list


class CoverLetterGenerateIn(BaseModel):
    job_id: uuid.UUID
    use_llm: bool = True


class CoverLetterOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    job_id: uuid.UUID | None
    version_number: int
    content: str
    generation_method: str
    provider: str
    model: str
    fact_check: dict
    edited_by_user: bool
    created_at: datetime
    updated_at: datetime
    company: str = ""
    job_title: str = ""


class CoverLetterEditIn(BaseModel):
    content: str = Field(min_length=20, max_length=20000)
