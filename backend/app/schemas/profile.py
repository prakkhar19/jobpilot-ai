from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

S = 300


def _clean_list(v: list[str]) -> list[str]:
    return [x.strip() for x in v if isinstance(x, str) and x.strip()]


class EducationIn(BaseModel):
    institution: str = Field(default="", max_length=S)
    degree: str = Field(default="", max_length=S)
    field_of_study: str = Field(default="", max_length=S)
    start_date: str = Field(default="", max_length=20)
    end_date: str = Field(default="", max_length=20)
    grade: str = Field(default="", max_length=100)
    details: str = Field(default="", max_length=3000)


class ExperienceIn(BaseModel):
    company: str = Field(default="", max_length=S)
    title: str = Field(default="", max_length=S)
    location: str = Field(default="", max_length=200)
    start_date: str = Field(default="", max_length=20)
    end_date: str = Field(default="", max_length=20)
    is_current: bool = False
    bullets: list[str] = Field(default_factory=list, max_length=40)
    technologies: list[str] = Field(default_factory=list, max_length=60)

    _c = field_validator("bullets", "technologies")(classmethod(lambda cls, v: _clean_list(v)))


class SkillIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    category: str = Field(default="other", max_length=60)


class ProjectIn(BaseModel):
    name: str = Field(default="", max_length=S)
    description: str = Field(default="", max_length=3000)
    bullets: list[str] = Field(default_factory=list, max_length=30)
    technologies: list[str] = Field(default_factory=list, max_length=60)
    url: str = Field(default="", max_length=500)
    start_date: str = Field(default="", max_length=20)
    end_date: str = Field(default="", max_length=20)

    _c = field_validator("bullets", "technologies")(classmethod(lambda cls, v: _clean_list(v)))


class CertificationIn(BaseModel):
    name: str = Field(default="", max_length=S)
    issuer: str = Field(default="", max_length=S)
    issue_date: str = Field(default="", max_length=20)
    credential_url: str = Field(default="", max_length=500)


class ProfileIn(BaseModel):
    label: str = Field(default="Primary profile", max_length=200)
    full_name: str = Field(default="", max_length=200)
    email: str = Field(default="", max_length=320)
    phone: str = Field(default="", max_length=60)
    location: str = Field(default="", max_length=200)
    linkedin_url: str = Field(default="", max_length=500)
    github_url: str = Field(default="", max_length=500)
    portfolio_url: str = Field(default="", max_length=500)
    headline: str = Field(default="", max_length=300)
    summary: str = Field(default="", max_length=5000)
    motivation: str = Field(default="", max_length=5000)
    achievements: list[str] = Field(default_factory=list, max_length=50)
    publications: list[str] = Field(default_factory=list, max_length=50)
    spoken_languages: list[str] = Field(default_factory=list, max_length=20)
    application_facts: dict[str, str] = Field(default_factory=dict)
    educations: list[EducationIn] = Field(default_factory=list, max_length=20)
    experiences: list[ExperienceIn] = Field(default_factory=list, max_length=40)
    skills: list[SkillIn] = Field(default_factory=list, max_length=300)
    projects: list[ProjectIn] = Field(default_factory=list, max_length=40)
    certifications: list[CertificationIn] = Field(default_factory=list, max_length=50)

    _c = field_validator("achievements", "publications", "spoken_languages")(classmethod(lambda cls, v: _clean_list(v)))

    @field_validator("application_facts")
    @classmethod
    def _facts(cls, v: dict[str, str]) -> dict[str, str]:
        if len(v) > 60:
            raise ValueError("Too many application facts")
        return {str(k)[:100]: str(val)[:1000] for k, val in v.items() if str(k).strip()}


class ProfileOut(ProfileIn):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    status: str
    is_active: bool
    version: int
    approved_at: datetime | None
    parse_method: str
    parse_warnings: list[str]
    master_resume_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class ProfileSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    label: str
    full_name: str
    status: str
    is_active: bool
    version: int
    parse_method: str
    master_resume_id: uuid.UUID | None
    updated_at: datetime


class MasterResumeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    label: str
    original_filename: str
    mime_type: str
    size_bytes: int
    sha256: str
    created_at: datetime
    text_preview: str = ""


class UploadResult(BaseModel):
    resume: MasterResumeOut
    profile: ProfileOut
