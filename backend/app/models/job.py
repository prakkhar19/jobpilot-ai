from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TenantOwned, TimestampMixin, UUIDPk, utcnow


class JobSource(UUIDPk, TenantOwned, TimestampMixin, Base):
    """A configured discovery source, e.g. a Greenhouse board token or a career page URL."""

    __tablename__ = "job_sources"
    __table_args__ = (UniqueConstraint("user_id", "kind", "identifier", name="uq_source_user_kind_ident"),)

    kind: Mapped[str] = mapped_column(String(30), nullable=False)  # greenhouse|lever|ashby|career_page|demo
    identifier: Mapped[str] = mapped_column(String(500), nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_status: Mapped[str] = mapped_column(String(30), default="never", nullable=False)  # ok|error|never
    last_error: Mapped[str] = mapped_column(Text, default="", nullable=False)
    jobs_found: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class Job(UUIDPk, TenantOwned, Base):
    __tablename__ = "jobs"
    __table_args__ = (
        UniqueConstraint("user_id", "source_kind", "external_id", name="uq_job_user_source_ext"),
        Index("ix_jobs_user_dedupe", "user_id", "dedupe_key"),
        Index("ix_jobs_user_status", "user_id", "status"),
    )

    source_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("job_sources.id", ondelete="SET NULL"))
    source_kind: Mapped[str] = mapped_column(String(30), nullable=False)
    external_id: Mapped[str] = mapped_column(String(300), nullable=False)
    company: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    title: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    location: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    workplace_type: Mapped[str] = mapped_column(String(20), default="unknown", nullable=False)
    employment_type: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    seniority: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    department: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    salary_min: Mapped[float | None] = mapped_column(Float)
    salary_max: Mapped[float | None] = mapped_column(Float)
    salary_currency: Mapped[str] = mapped_column(String(10), default="", nullable=False)
    salary_text: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    description_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    application_url: Mapped[str] = mapped_column(String(1000), default="", nullable=False)
    posting_url: Mapped[str] = mapped_column(String(1000), default="", nullable=False)
    discovered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)  # active|expired|unknown
    dedupe_key: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    duplicate_of_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("jobs.id", ondelete="SET NULL"))
    analyzed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    hidden: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    requirements: Mapped[list[JobRequirement]] = relationship(cascade="all, delete-orphan", lazy="selectin")


class JobRequirement(UUIDPk, TenantOwned, Base):
    __tablename__ = "job_requirements"

    job_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("jobs.id", ondelete="CASCADE"), index=True)
    # required_skill | preferred_skill | experience_years | education | seniority | responsibility | qualification
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    skill_name: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    is_mandatory: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    value_num: Mapped[float | None] = mapped_column(Float)


class JobMatch(UUIDPk, TenantOwned, Base):
    __tablename__ = "job_matches"
    __table_args__ = (UniqueConstraint("user_id", "job_id", name="uq_match_user_job"),)

    job_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("jobs.id", ondelete="CASCADE"), index=True)
    profile_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("candidate_profiles.id", ondelete="SET NULL")
    )
    profile_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    overall_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False, index=True)
    components: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    strengths: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    gaps: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    unknowns: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    recommendation: Mapped[str] = mapped_column(String(30), default="consider", nullable=False)
    weights: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    llm_summary: Mapped[str] = mapped_column(Text, default="", nullable=False)
    similarity_method: Mapped[str] = mapped_column(String(30), default="tfidf", nullable=False)
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class SavedJob(UUIDPk, TenantOwned, Base):
    __tablename__ = "saved_jobs"
    __table_args__ = (UniqueConstraint("user_id", "job_id", name="uq_saved_user_job"),)

    job_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("jobs.id", ondelete="CASCADE"), index=True)
    note: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
