from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, TenantOwned, TimestampMixin, UUIDPk, utcnow


class AIProviderConfiguration(UUIDPk, TenantOwned, TimestampMixin, Base):
    __tablename__ = "ai_provider_configurations"

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    provider: Mapped[str] = mapped_column(String(30), nullable=False)  # openai_compatible | anthropic
    base_url: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    model: Mapped[str] = mapped_column(String(200), nullable=False)
    embedding_model: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    api_key_encrypted: Mapped[str] = mapped_column(Text, default="", nullable=False)
    api_key_last4: Mapped[str] = mapped_column(String(8), default="", nullable=False)
    temperature: Mapped[float] = mapped_column(Float, default=0.2, nullable=False)
    max_tokens: Mapped[int] = mapped_column(Integer, default=2000, nullable=False)
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_fallback: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    input_price_per_mtok: Mapped[float | None] = mapped_column(Float)
    output_price_per_mtok: Mapped[float | None] = mapped_column(Float)
    total_requests: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_input_tokens: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    total_output_tokens: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    total_errors: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_error: Mapped[str] = mapped_column(Text, default="", nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AgentConfiguration(UUIDPk, TenantOwned, TimestampMixin, Base):
    __tablename__ = "agent_configurations"

    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    paused: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    frequency_hours: Mapped[int] = mapped_column(Integer, default=24, nullable=False)  # legacy, unused
    frequency_minutes: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    alert_on_new_matches: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    email_alerts: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    run_days: Mapped[list] = mapped_column(JSON, default=lambda: [0, 1, 2, 3, 4, 5, 6], nullable=False)  # 0=Mon
    # start == end means "all day" (the agent searches around the clock).
    window_start_hour: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    window_end_hour: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    timezone: Mapped[str] = mapped_column(String(60), default="UTC", nullable=False)

    target_roles: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    keywords: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    excluded_keywords: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    locations: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    countries: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    workplace_types: Mapped[list] = mapped_column(JSON, default=list, nullable=False)  # remote|hybrid|onsite
    experience_levels: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    employment_types: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    salary_min: Mapped[float | None] = mapped_column(Float)
    include_companies: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    exclude_companies: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    industries: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    required_technologies: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    posted_within_days: Mapped[int | None] = mapped_column(Integer)

    min_match_score: Mapped[float] = mapped_column(Float, default=60.0, nullable=False)
    daily_discovery_limit: Mapped[int] = mapped_column(Integer, default=200, nullable=False)
    max_preparations_per_day: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    auto_generate_documents: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    auto_prepare_applications: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    application_mode: Mapped[str] = mapped_column(String(20), default="review", nullable=False)
    authorized_automation_ack_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    matching_weights: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    resume_template: Mapped[str] = mapped_column(String(40), default="classic", nullable=False)
    use_llm: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AgentTask(UUIDPk, TenantOwned, Base):
    __tablename__ = "agent_tasks"

    kind: Mapped[str] = mapped_column(String(30), default="pipeline", nullable=False)  # pipeline|submit|verify
    trigger: Mapped[str] = mapped_column(String(20), default="manual", nullable=False)  # manual|schedule
    state: Mapped[str] = mapped_column(String(30), default="IDLE", nullable=False, index=True)
    celery_task_id: Mapped[str] = mapped_column(String(100), default="", nullable=False)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    attempt: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    stats: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    error: Mapped[str] = mapped_column(Text, default="", nullable=False)
    target_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AgentExecutionLog(UUIDPk, TenantOwned, Base):
    __tablename__ = "agent_execution_logs"

    task_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("agent_tasks.id", ondelete="CASCADE"), index=True)
    level: Mapped[str] = mapped_column(String(10), default="info", nullable=False)
    step: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    message: Mapped[str] = mapped_column(Text, default="", nullable=False)
    data: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Notification(UUIDPk, TenantOwned, Base):
    __tablename__ = "notifications"

    kind: Mapped[str] = mapped_column(String(40), default="info", nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    body: Mapped[str] = mapped_column(Text, default="", nullable=False)
    link: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)


class AuditLog(UUIDPk, TenantOwned, Base):
    __tablename__ = "audit_logs"

    action: Mapped[str] = mapped_column(String(80), nullable=False)
    target_type: Mapped[str] = mapped_column(String(60), default="", nullable=False)
    target_id: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    ip_address: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    data: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)


class WorkerHeartbeat(Base):
    """Liveness markers written by the worker and scheduler (not tenant data)."""

    __tablename__ = "worker_heartbeats"

    name: Mapped[str] = mapped_column(String(60), primary_key=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    info: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


