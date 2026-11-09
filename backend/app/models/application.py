from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, TenantOwned, TimestampMixin, UUIDPk, utcnow


class Application(UUIDPk, TenantOwned, TimestampMixin, Base):
    """One application per (user, job): the unique constraint is the idempotency guarantee."""

    __tablename__ = "applications"
    __table_args__ = (UniqueConstraint("user_id", "job_id", name="uq_application_user_job"),)

    job_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("jobs.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(30), default="discovered", nullable=False, index=True)
    mode: Mapped[str] = mapped_column(String(20), default="review", nullable=False)  # review|assisted|authorized
    provider: Mapped[str] = mapped_column(String(30), default="manual", nullable=False)
    resume_version_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("resume_versions.id", ondelete="SET NULL")
    )
    cover_letter_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("cover_letters.id", ondelete="SET NULL")
    )
    match_score: Mapped[float | None] = mapped_column(Float)
    form_fields: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    answers: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    missing_fields: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    preparation_screenshot: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submitted_by: Mapped[str] = mapped_column(String(20), default="", nullable=False)  # user|agent
    confirmation_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    confirmation_screenshot: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    submit_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_error: Mapped[str] = mapped_column(Text, default="", nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    follow_up_date: Mapped[date | None] = mapped_column(Date)
    busy: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class ApplicationEvent(UUIDPk, TenantOwned, Base):
    """Append-only audit trail of everything that happened to an application."""

    __tablename__ = "application_events"

    application_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("applications.id", ondelete="CASCADE"), index=True
    )
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    from_status: Mapped[str] = mapped_column(String(30), default="", nullable=False)
    to_status: Mapped[str] = mapped_column(String(30), default="", nullable=False)
    actor: Mapped[str] = mapped_column(String(20), default="user", nullable=False)  # user|agent|system
    message: Mapped[str] = mapped_column(Text, default="", nullable=False)
    data: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Interview(UUIDPk, TenantOwned, TimestampMixin, Base):
    __tablename__ = "interviews"

    application_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("applications.id", ondelete="CASCADE"), index=True
    )
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    kind: Mapped[str] = mapped_column(String(40), default="other", nullable=False)
    location: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    interviewers: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="scheduled", nullable=False)  # scheduled|completed|cancelled
    outcome: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)


class ScreeningAnswer(UUIDPk, TenantOwned, TimestampMixin, Base):
    """User-verified answers to screening questions, reused across applications."""

    __tablename__ = "screening_answers"
    __table_args__ = (UniqueConstraint("user_id", "question_key", name="uq_answer_user_key"),)

    question_key: Mapped[str] = mapped_column(String(300), nullable=False)
    question_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    answer: Mapped[str] = mapped_column(Text, default="", nullable=False)
