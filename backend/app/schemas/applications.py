from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ApplicationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    job_id: uuid.UUID
    status: str
    mode: str
    provider: str
    resume_version_id: uuid.UUID | None
    cover_letter_id: uuid.UUID | None
    match_score: float | None
    form_fields: list[dict]
    answers: dict
    missing_fields: list[dict]
    preparation_screenshot: str
    approved_at: datetime | None
    submitted_at: datetime | None
    submitted_by: str
    confirmation_text: str
    confirmation_screenshot: str
    submit_attempts: int
    last_error: str
    notes: str
    follow_up_date: date | None
    busy: bool
    created_at: datetime
    updated_at: datetime
    company: str = ""
    job_title: str = ""
    job_url: str = ""
    source_kind: str = ""
    is_demo: bool = False
    provider_capabilities: dict = {}


class ApplicationEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    event_type: str
    from_status: str
    to_status: str
    actor: str
    message: str
    data: dict
    created_at: datetime


class PrepareIn(BaseModel):
    job_id: uuid.UUID
    mode: Literal["review", "assisted", "authorized"] = "review"


class TrackIn(BaseModel):
    job_id: uuid.UUID
    status: Literal["discovered", "shortlisted"] = "shortlisted"


class AnswersIn(BaseModel):
    answers: dict[str, str]
    save_to_answer_bank: bool = True


class StatusIn(BaseModel):
    status: str
    note: str = Field(default="", max_length=2000)


class MarkSubmittedIn(BaseModel):
    note: str = Field(default="", max_length=2000)
    submitted_on: date | None = None


class ApplicationUpdate(BaseModel):
    notes: str | None = Field(default=None, max_length=10000)
    follow_up_date: date | None = None
    clear_follow_up: bool = False
    resume_version_id: uuid.UUID | None = None
    cover_letter_id: uuid.UUID | None = None


class InterviewIn(BaseModel):
    application_id: uuid.UUID
    scheduled_at: datetime | None = None
    kind: Literal["phone_screen", "technical", "system_design", "behavioral", "onsite", "hr", "final", "other"] = "other"
    location: str = Field(default="", max_length=500)
    interviewers: str = Field(default="", max_length=500)
    status: Literal["scheduled", "completed", "cancelled"] = "scheduled"
    outcome: str = Field(default="", max_length=40)
    notes: str = Field(default="", max_length=10000)


class InterviewOut(InterviewIn):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    created_at: datetime
    company: str = ""
    job_title: str = ""


class AnswerIn(BaseModel):
    question_text: str = Field(min_length=2, max_length=1000)
    answer: str = Field(min_length=1, max_length=5000)


class AnswerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    question_key: str
    question_text: str
    answer: str
    updated_at: datetime
