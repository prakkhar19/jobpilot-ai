"""User data export (GDPR-style): a ZIP of JSON data plus the user's files."""

from __future__ import annotations

import io
import json
import zipfile
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.inspection import inspect as sa_inspect
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import (
    AgentConfiguration,
    AgentExecutionLog,
    AgentTask,
    AIProviderConfiguration,
    Application,
    ApplicationEvent,
    AuditLog,
    CandidateProfile,
    Certification,
    CoverLetter,
    Education,
    Interview,
    Job,
    JobMatch,
    JobRequirement,
    JobSource,
    MasterResume,
    Notification,
    Project,
    ResumeVersion,
    SavedJob,
    ScreeningAnswer,
    Skill,
    User,
    WorkExperience,
)
from app.security.uploads import resolve_within

EXPORT_MODELS = [CandidateProfile, Education, WorkExperience, Skill, Project, Certification, MasterResume, ResumeVersion,
                 CoverLetter, JobSource, Job, JobRequirement, JobMatch, SavedJob, Application, ApplicationEvent, Interview,
                 ScreeningAnswer, AIProviderConfiguration, AgentConfiguration, AgentTask, AgentExecutionLog, Notification,
                 AuditLog]
_SECRET_COLUMNS = {"api_key_encrypted", "password_hash", "token_hash"}


def _row(obj: object) -> dict:
    out = {}
    for col in sa_inspect(obj.__class__).columns:
        if col.key in _SECRET_COLUMNS:
            continue
        val = getattr(obj, col.key)
        out[col.key] = val.isoformat() if hasattr(val, "isoformat") else (str(val) if hasattr(val, "hex") and not isinstance(val, (int, float, str, bytes)) else val)
    return out


def export_user(db: Session, user: User) -> bytes:
    s = get_settings()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("README.txt", "JobPilot AI data export.\nJSON files contain all your records. API keys are not "
                    "exported. 'files/' contains your uploaded and generated documents.\n")
        zf.writestr("account.json", json.dumps({"email": user.email, "full_name": user.full_name, "role": user.role,
                                                "created_at": user.created_at.isoformat(),
                                                "exported_at": datetime.now(UTC).isoformat()}, indent=2))
        for model in EXPORT_MODELS:
            rows = db.scalars(select(model).where(model.user_id == user.id)).all()
            zf.writestr(f"data/{model.__tablename__}.json", json.dumps([_row(r) for r in rows], indent=2, default=str))
        for r in db.scalars(select(MasterResume).where(MasterResume.user_id == user.id)).all():
            p = resolve_within(s.uploads_dir, r.stored_path)
            if p.exists():
                zf.write(p, f"files/original_resumes/{r.id}_{r.original_filename}")
        for v in db.scalars(select(ResumeVersion).where(ResumeVersion.user_id == user.id)).all():
            for rel, ext in ((v.pdf_path, "pdf"), (v.docx_path, "docx")):
                if rel:
                    p = resolve_within(s.generated_dir, rel)
                    if p.exists():
                        zf.write(p, f"files/tailored_resumes/v{v.version_number}_{v.id}.{ext}")
    return buf.getvalue()
