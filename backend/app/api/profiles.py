from __future__ import annotations

import uuid

from fastapi import APIRouter, File, Form, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select

from app.api.deps import DB, CurrentUser, get_owned_or_404
from app.core.config import get_settings
from app.core.errors import DomainError
from app.models import CandidateProfile, MasterResume
from app.schemas.profile import MasterResumeOut, ProfileIn, ProfileOut, ProfileSummary, UploadResult
from app.security.uploads import resolve_within
from app.services import profiles as svc
from app.services.audit import audit

router = APIRouter(prefix="/api", tags=["profile"])


def _resume_out(r: MasterResume) -> MasterResumeOut:
    out = MasterResumeOut.model_validate(r)
    out.text_preview = r.extracted_text[:600]
    return out


def _profile_out(p: CandidateProfile) -> ProfileOut:
    data = svc.profile_to_dict(p)
    return ProfileOut(
        **data,
        id=p.id, status=p.status, is_active=p.is_active, version=p.version, approved_at=p.approved_at,
        parse_method=p.parse_method, parse_warnings=p.parse_warnings or [], master_resume_id=p.master_resume_id,
        created_at=p.created_at, updated_at=p.updated_at,
    )


# ---- master resumes (immutable originals) ----

@router.post("/resumes", response_model=UploadResult, status_code=201)
async def upload_resume(
    db: DB,
    user: CurrentUser,
    file: UploadFile = File(...),
    use_llm: bool = Form(default=True),
    label: str = Form(default=""),
) -> UploadResult:
    limit = get_settings().max_upload_mb * 1024 * 1024
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise DomainError(f"The file exceeds the {get_settings().max_upload_mb} MB limit.", status_code=413)
    resume, profile = svc.create_from_upload(db, user, file.filename or "", data, use_llm=use_llm, label=label[:200])
    return UploadResult(resume=_resume_out(resume), profile=_profile_out(profile))


@router.get("/resumes", response_model=list[MasterResumeOut])
def list_resumes(db: DB, user: CurrentUser) -> list[MasterResumeOut]:
    rows = db.scalars(
        select(MasterResume).where(MasterResume.user_id == user.id).order_by(MasterResume.created_at.desc())
    ).all()
    return [_resume_out(r) for r in rows]


@router.get("/resumes/{resume_id}/download")
def download_resume(resume_id: uuid.UUID, db: DB, user: CurrentUser) -> FileResponse:
    r = get_owned_or_404(db, MasterResume, resume_id, user, "Resume")
    path = resolve_within(get_settings().uploads_dir, r.stored_path)
    if not path.exists():
        raise DomainError("The stored file is missing.", status_code=404)
    return FileResponse(path, media_type=r.mime_type, filename=r.original_filename)


@router.get("/resumes/{resume_id}/text")
def resume_text(resume_id: uuid.UUID, db: DB, user: CurrentUser) -> dict:
    r = get_owned_or_404(db, MasterResume, resume_id, user, "Resume")
    return {"text": r.extracted_text}


@router.delete("/resumes/{resume_id}", status_code=204)
def delete_resume(resume_id: uuid.UUID, db: DB, user: CurrentUser) -> Response:
    r = get_owned_or_404(db, MasterResume, resume_id, user, "Resume")
    path = resolve_within(get_settings().uploads_dir, r.stored_path)
    db.delete(r)
    audit(db, user.id, "resume.deleted", target_type="master_resume", target_id=resume_id)
    db.commit()
    path.unlink(missing_ok=True)
    return Response(status_code=204)


# ---- candidate profiles ----

@router.get("/profiles", response_model=list[ProfileSummary])
def list_profiles(db: DB, user: CurrentUser) -> list[ProfileSummary]:
    rows = db.scalars(
        select(CandidateProfile).where(CandidateProfile.user_id == user.id).order_by(CandidateProfile.created_at)
    ).all()
    return [ProfileSummary.model_validate(r) for r in rows]


@router.get("/profiles/active", response_model=ProfileOut | None)
def active_profile(db: DB, user: CurrentUser) -> ProfileOut | None:
    p = svc.get_active_profile(db, user, require_approved=False)
    return _profile_out(p) if p else None


@router.post("/profiles", response_model=ProfileOut, status_code=201)
def create_profile(db: DB, user: CurrentUser) -> ProfileOut:
    return _profile_out(svc.create_blank(db, user))


@router.get("/profiles/{profile_id}", response_model=ProfileOut)
def get_profile(profile_id: uuid.UUID, db: DB, user: CurrentUser) -> ProfileOut:
    return _profile_out(svc.get_profile(db, user, profile_id))


@router.put("/profiles/{profile_id}", response_model=ProfileOut)
def update_profile(profile_id: uuid.UUID, body: ProfileIn, db: DB, user: CurrentUser) -> ProfileOut:
    p = svc.get_profile(db, user, profile_id)
    return _profile_out(svc.update_profile(db, user, p, body.model_dump()))


@router.post("/profiles/{profile_id}/approve", response_model=ProfileOut)
def approve_profile(profile_id: uuid.UUID, db: DB, user: CurrentUser) -> ProfileOut:
    p = svc.get_profile(db, user, profile_id)
    return _profile_out(svc.approve(db, user, p))


@router.post("/profiles/{profile_id}/activate", response_model=ProfileOut)
def activate_profile(profile_id: uuid.UUID, db: DB, user: CurrentUser) -> ProfileOut:
    p = svc.get_profile(db, user, profile_id)
    svc.activate(db, user, p)
    return _profile_out(p)


@router.post("/profiles/{profile_id}/duplicate", response_model=ProfileOut, status_code=201)
def duplicate_profile(profile_id: uuid.UUID, db: DB, user: CurrentUser) -> ProfileOut:
    p = svc.get_profile(db, user, profile_id)
    return _profile_out(svc.duplicate(db, user, p))


@router.delete("/profiles/{profile_id}", status_code=204)
def delete_profile(profile_id: uuid.UUID, db: DB, user: CurrentUser) -> Response:
    p = svc.get_profile(db, user, profile_id)
    was_active = p.is_active
    db.delete(p)
    db.commit()
    if was_active:
        other = db.scalar(select(CandidateProfile).where(CandidateProfile.user_id == user.id))
        if other:
            svc.activate(db, user, other)
    return Response(status_code=204)
