from __future__ import annotations

import re
import uuid
from typing import Literal

from fastapi import APIRouter, Response
from fastapi.responses import FileResponse
from sqlalchemy import select

from app.api.deps import DB, CurrentUser, get_owned_or_404
from app.core.config import get_settings
from app.core.errors import DomainError
from app.documents.render import TEMPLATES, render_letter_docx, render_letter_pdf
from app.models import CandidateProfile, CoverLetter, Job, ResumeVersion
from app.schemas.documents import (
    CompareOut,
    CoverLetterEditIn,
    CoverLetterGenerateIn,
    CoverLetterOut,
    ResumeEditIn,
    ResumeGenerateIn,
    ResumeVersionOut,
    ResumeVersionSummary,
)
from app.security.uploads import resolve_within
from app.services import cover_letters, tailoring
from app.services.profiles import get_active_profile, require_active_profile

router = APIRouter(prefix="/api", tags=["documents"])


@router.get("/resume-templates")
def templates() -> dict:
    return {"templates": [{"key": t.key, "name": t.name, "description": t.description} for t in TEMPLATES.values()],
            "target_roles": tailoring.TARGET_ROLES}


@router.post("/resume-versions", response_model=ResumeVersionOut, status_code=201)
def generate_resume(body: ResumeGenerateIn, db: DB, user: CurrentUser) -> ResumeVersionOut:
    profile = require_active_profile(db, user)
    job = get_owned_or_404(db, Job, body.job_id, user, "Job") if body.job_id else None
    rv = tailoring.generate_resume(db, user, profile, job, template=body.template, target_role=body.target_role,
                                   use_llm=body.use_llm)
    return ResumeVersionOut.model_validate(rv)


@router.get("/resume-versions", response_model=list[ResumeVersionSummary])
def list_versions(db: DB, user: CurrentUser, job_id: uuid.UUID | None = None) -> list[ResumeVersionSummary]:
    q = select(ResumeVersion).where(ResumeVersion.user_id == user.id)
    if job_id:
        q = q.where(ResumeVersion.job_id == job_id)
    return [ResumeVersionSummary.model_validate(r) for r in db.scalars(q.order_by(ResumeVersion.created_at.desc())).all()]


@router.get("/resume-versions/{version_id}", response_model=ResumeVersionOut)
def get_version(version_id: uuid.UUID, db: DB, user: CurrentUser) -> ResumeVersionOut:
    return ResumeVersionOut.model_validate(get_owned_or_404(db, ResumeVersion, version_id, user, "Resume version"))


@router.get("/resume-versions/{version_id}/compare", response_model=CompareOut)
def compare(version_id: uuid.UUID, db: DB, user: CurrentUser) -> CompareOut:
    rv = get_owned_or_404(db, ResumeVersion, version_id, user, "Resume version")
    return CompareOut(original=tailoring.base_content(rv.profile_snapshot), tailored=rv.content, change_log=rv.change_log)


@router.post("/resume-versions/{version_id}/edit", response_model=ResumeVersionOut, status_code=201)
def edit_version(version_id: uuid.UUID, body: ResumeEditIn, db: DB, user: CurrentUser) -> ResumeVersionOut:
    rv = get_owned_or_404(db, ResumeVersion, version_id, user, "Resume version")
    required = {"header", "summary", "skills", "experiences"}
    if not required <= set(body.content):
        raise DomainError("Edited content is missing required sections.")
    return ResumeVersionOut.model_validate(tailoring.rerender(db, user, rv, body.content, body.template))


@router.get("/resume-versions/{version_id}/download/{fmt}")
def download_version(version_id: uuid.UUID, fmt: Literal["pdf", "docx"], db: DB, user: CurrentUser,
                     inline: bool = False) -> FileResponse:
    rv = get_owned_or_404(db, ResumeVersion, version_id, user, "Resume version")
    rel = rv.pdf_path if fmt == "pdf" else rv.docx_path
    path = resolve_within(get_settings().generated_dir, rel)
    if not path.exists():
        raise DomainError("File missing; regenerate this version.", status_code=404)
    media = "application/pdf" if fmt == "pdf" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    name = tailoring.download_name(rv, f".{fmt}")
    return FileResponse(path, media_type=media, filename=name,
                        content_disposition_type="inline" if inline and fmt == "pdf" else "attachment")


@router.delete("/resume-versions/{version_id}", status_code=204)
def delete_version(version_id: uuid.UUID, db: DB, user: CurrentUser) -> Response:
    rv = get_owned_or_404(db, ResumeVersion, version_id, user, "Resume version")
    paths = [rv.pdf_path, rv.docx_path]
    db.delete(rv)
    db.commit()
    for rel in paths:
        if rel:
            resolve_within(get_settings().generated_dir, rel).unlink(missing_ok=True)
    return Response(status_code=204)


# ---------------------------------------------------------------------------------- cover letters

@router.post("/cover-letters", response_model=CoverLetterOut, status_code=201)
def generate_letter(body: CoverLetterGenerateIn, db: DB, user: CurrentUser) -> CoverLetterOut:
    profile = require_active_profile(db, user)
    job = get_owned_or_404(db, Job, body.job_id, user, "Job")
    return _cl_out(db, cover_letters.generate(db, user, profile, job, use_llm=body.use_llm))


def _cl_out(db: DB, cl: CoverLetter) -> CoverLetterOut:
    out = CoverLetterOut.model_validate(cl)
    job = db.get(Job, cl.job_id) if cl.job_id else None
    if job:
        out.company, out.job_title = job.company, job.title
    return out


@router.get("/cover-letters", response_model=list[CoverLetterOut])
def list_letters(db: DB, user: CurrentUser, job_id: uuid.UUID | None = None) -> list[CoverLetterOut]:
    q = select(CoverLetter).where(CoverLetter.user_id == user.id)
    if job_id:
        q = q.where(CoverLetter.job_id == job_id)
    return [_cl_out(db, c) for c in db.scalars(q.order_by(CoverLetter.created_at.desc())).all()]


@router.get("/cover-letters/{letter_id}", response_model=CoverLetterOut)
def get_letter(letter_id: uuid.UUID, db: DB, user: CurrentUser) -> CoverLetterOut:
    return _cl_out(db, get_owned_or_404(db, CoverLetter, letter_id, user, "Cover letter"))


@router.put("/cover-letters/{letter_id}", response_model=CoverLetterOut)
def edit_letter(letter_id: uuid.UUID, body: CoverLetterEditIn, db: DB, user: CurrentUser) -> CoverLetterOut:
    cl = get_owned_or_404(db, CoverLetter, letter_id, user, "Cover letter")
    cl.content = body.content
    cl.edited_by_user = True
    db.commit()
    return _cl_out(db, cl)


@router.delete("/cover-letters/{letter_id}", status_code=204)
def delete_letter(letter_id: uuid.UUID, db: DB, user: CurrentUser) -> Response:
    cl = get_owned_or_404(db, CoverLetter, letter_id, user, "Cover letter")
    db.delete(cl)
    db.commit()
    return Response(status_code=204)


@router.get("/cover-letters/{letter_id}/download/{fmt}")
def download_letter(letter_id: uuid.UUID, fmt: Literal["pdf", "docx", "txt"], db: DB, user: CurrentUser) -> Response:
    cl = get_owned_or_404(db, CoverLetter, letter_id, user, "Cover letter")
    profile = (db.get(CandidateProfile, cl.profile_id) if cl.profile_id else None) or get_active_profile(
        db, user, require_approved=False)
    header = ({"full_name": profile.full_name, "email": profile.email, "phone": profile.phone,
               "location": profile.location} if profile and profile.user_id == user.id else {"full_name": user.full_name})
    job = db.get(Job, cl.job_id) if cl.job_id else None
    company = re.sub(r"[^A-Za-z0-9]+", "_", job.company if job else "General").strip("_") or "General"
    base = f"Cover_Letter_{company}"[:80]
    if fmt == "txt":
        data, media = cl.content.encode(), "text/plain; charset=utf-8"
    elif fmt == "docx":
        data, media = render_letter_docx(cl.content, header), \
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    else:
        data, media = render_letter_pdf(cl.content, header), "application/pdf"
    return Response(data, media_type=media, headers={"Content-Disposition": f'attachment; filename="{base}.{fmt}"'})
