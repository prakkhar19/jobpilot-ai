from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TenantOwned, TimestampMixin, UUIDPk, utcnow


class MasterResume(UUIDPk, TenantOwned, Base):
    """An uploaded original resume. Immutable: never modified after upload."""

    __tablename__ = "master_resumes"

    label: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_path: Mapped[str] = mapped_column(String(500), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    extracted_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class CandidateProfile(UUIDPk, TenantOwned, TimestampMixin, Base):
    """Structured, user-verified candidate profile — the single source of truth for generation."""

    __tablename__ = "candidate_profiles"

    master_resume_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("master_resumes.id", ondelete="SET NULL")
    )
    label: Mapped[str] = mapped_column(String(200), default="Primary profile", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False)  # draft | approved
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    parse_method: Mapped[str] = mapped_column(String(30), default="manual", nullable=False)
    parse_warnings: Mapped[list] = mapped_column(JSON, default=list, nullable=False)

    full_name: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    email: Mapped[str] = mapped_column(String(320), default="", nullable=False)
    phone: Mapped[str] = mapped_column(String(60), default="", nullable=False)
    location: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    linkedin_url: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    github_url: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    portfolio_url: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    headline: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    summary: Mapped[str] = mapped_column(Text, default="", nullable=False)
    motivation: Mapped[str] = mapped_column(Text, default="", nullable=False)
    achievements: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    publications: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    spoken_languages: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    # Verified facts used to answer screening questions (work authorization, notice period, ...).
    application_facts: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    educations: Mapped[list[Education]] = relationship(
        back_populates="profile", cascade="all, delete-orphan", order_by="Education.sort_order"
    )
    experiences: Mapped[list[WorkExperience]] = relationship(
        back_populates="profile", cascade="all, delete-orphan", order_by="WorkExperience.sort_order"
    )
    skills: Mapped[list[Skill]] = relationship(
        back_populates="profile", cascade="all, delete-orphan", order_by="Skill.sort_order"
    )
    projects: Mapped[list[Project]] = relationship(
        back_populates="profile", cascade="all, delete-orphan", order_by="Project.sort_order"
    )
    certifications: Mapped[list[Certification]] = relationship(
        back_populates="profile", cascade="all, delete-orphan", order_by="Certification.sort_order"
    )


class _ProfileChild(UUIDPk, TenantOwned):
    @staticmethod
    def _profile_fk() -> Mapped[uuid.UUID]:
        return mapped_column(Uuid, ForeignKey("candidate_profiles.id", ondelete="CASCADE"), index=True)


class Education(_ProfileChild, Base):
    __tablename__ = "educations"
    profile_id: Mapped[uuid.UUID] = _ProfileChild._profile_fk()
    institution: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    degree: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    field_of_study: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    start_date: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    end_date: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    grade: Mapped[str] = mapped_column(String(100), default="", nullable=False)
    details: Mapped[str] = mapped_column(Text, default="", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    profile: Mapped[CandidateProfile] = relationship(back_populates="educations")


class WorkExperience(_ProfileChild, Base):
    __tablename__ = "work_experiences"
    profile_id: Mapped[uuid.UUID] = _ProfileChild._profile_fk()
    company: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    title: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    location: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    start_date: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    end_date: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    bullets: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    technologies: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    profile: Mapped[CandidateProfile] = relationship(back_populates="experiences")


class Skill(_ProfileChild, Base):
    __tablename__ = "skills"
    __table_args__ = (UniqueConstraint("profile_id", "name", name="uq_skill_profile_name"),)
    profile_id: Mapped[uuid.UUID] = _ProfileChild._profile_fk()
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    category: Mapped[str] = mapped_column(String(60), default="other", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    profile: Mapped[CandidateProfile] = relationship(back_populates="skills")


class Project(_ProfileChild, Base):
    __tablename__ = "projects"
    profile_id: Mapped[uuid.UUID] = _ProfileChild._profile_fk()
    name: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    bullets: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    technologies: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    url: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    start_date: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    end_date: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    profile: Mapped[CandidateProfile] = relationship(back_populates="projects")


class Certification(_ProfileChild, Base):
    __tablename__ = "certifications"
    profile_id: Mapped[uuid.UUID] = _ProfileChild._profile_fk()
    name: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    issuer: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    issue_date: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    credential_url: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    profile: Mapped[CandidateProfile] = relationship(back_populates="certifications")


class ResumeVersion(UUIDPk, TenantOwned, Base):
    """A generated (tailored) resume. Never overwritten: each generation creates a new row."""

    __tablename__ = "resume_versions"

    profile_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("candidate_profiles.id", ondelete="SET NULL"), index=True
    )
    job_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("jobs.id", ondelete="SET NULL"), index=True)
    parent_version_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("resume_versions.id", ondelete="SET NULL")
    )
    version_number: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    label: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    target_role: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    template: Mapped[str] = mapped_column(String(40), default="classic", nullable=False)
    content: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    profile_snapshot: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    change_log: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    fact_check: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    generation_method: Mapped[str] = mapped_column(String(30), default="deterministic", nullable=False)
    provider: Mapped[str] = mapped_column(String(60), default="", nullable=False)
    model: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    docx_path: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    pdf_path: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class CoverLetter(UUIDPk, TenantOwned, TimestampMixin, Base):
    __tablename__ = "cover_letters"

    job_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("jobs.id", ondelete="SET NULL"), index=True)
    profile_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("candidate_profiles.id", ondelete="SET NULL")
    )
    version_number: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    content: Mapped[str] = mapped_column(Text, default="", nullable=False)
    generation_method: Mapped[str] = mapped_column(String(30), default="deterministic", nullable=False)
    provider: Mapped[str] = mapped_column(String(60), default="", nullable=False)
    model: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    fact_check: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    edited_by_user: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
