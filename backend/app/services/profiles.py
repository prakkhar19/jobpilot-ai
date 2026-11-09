"""Master profile management: creation from uploads, editing, approval, snapshots."""

from __future__ import annotations

import logging
import re
import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.adapters.llm.base import LLMError, untrusted
from app.core.config import get_settings
from app.core.errors import DomainError
from app.documents.extract import ExtractionError, extract_text
from app.models import (
    CandidateProfile,
    Certification,
    Education,
    MasterResume,
    Project,
    Skill,
    User,
    WorkExperience,
)
from app.security.uploads import UploadRejected, store_bytes, validate_resume_upload
from app.services.audit import audit
from app.services.llm_service import get_runner
from app.services.resume_parser import normalize_date, parse_resume_text
from app.services.skills import canonicalize, category_of

log = logging.getLogger(__name__)

SCALAR_FIELDS = (
    "label", "full_name", "email", "phone", "location", "linkedin_url", "github_url", "portfolio_url",
    "headline", "summary", "motivation", "achievements", "publications", "spoken_languages", "application_facts",
)
CHILDREN = {
    "educations": (Education, ("institution", "degree", "field_of_study", "start_date", "end_date", "grade", "details")),
    "experiences": (WorkExperience, ("company", "title", "location", "start_date", "end_date", "is_current", "bullets", "technologies")),
    "projects": (Project, ("name", "description", "bullets", "technologies", "url", "start_date", "end_date")),
    "certifications": (Certification, ("name", "issuer", "issue_date", "credential_url")),
}


def profile_to_dict(p: CandidateProfile) -> dict:
    data: dict = {f: getattr(p, f) for f in SCALAR_FIELDS}
    for key, (_model, fields) in CHILDREN.items():
        data[key] = [{f: getattr(child, f) for f in fields} for child in getattr(p, key)]
    data["skills"] = [{"name": s.name, "category": s.category} for s in p.skills]
    return data


def apply_profile_data(db: Session, profile: CandidateProfile, data: dict) -> None:
    """Replace the profile's content with ``data`` (a ProfileIn-shaped dict)."""
    for f in SCALAR_FIELDS:
        if f in data and data[f] is not None:
            setattr(profile, f, data[f])
    for key, (model, fields) in CHILDREN.items():
        if key not in data:
            continue
        getattr(profile, key).clear()
        db.flush()
        for i, item in enumerate(data[key] or []):
            getattr(profile, key).append(
                model(user_id=profile.user_id, sort_order=i, **{f: item.get(f, False if f == "is_current" else ([] if f in ("bullets", "technologies") else "")) for f in fields})
            )
    if "skills" in data:
        profile.skills.clear()
        db.flush()
        seen: set[str] = set()
        for i, item in enumerate(data["skills"] or []):
            name = canonicalize(item.get("name", "") if isinstance(item, dict) else str(item))
            if not name or name.lower() in seen:
                continue
            seen.add(name.lower())
            cat = (item.get("category") if isinstance(item, dict) else "") or category_of(name)
            profile.skills.append(Skill(user_id=profile.user_id, name=name[:120], category=cat[:60], sort_order=i))


def get_profile(db: Session, user: User, profile_id: uuid.UUID) -> CandidateProfile:
    p = db.get(CandidateProfile, profile_id)
    if p is None or p.user_id != user.id:
        raise DomainError("Profile not found", status_code=404)
    return p


def get_active_profile(db: Session, user: User, *, require_approved: bool = True) -> CandidateProfile | None:
    stmt = select(CandidateProfile).where(CandidateProfile.user_id == user.id, CandidateProfile.is_active.is_(True))
    p = db.scalar(stmt)
    if p is None:
        p = db.scalar(
            select(CandidateProfile)
            .where(CandidateProfile.user_id == user.id, CandidateProfile.status == "approved")
            .order_by(CandidateProfile.updated_at.desc())
        )
    if p is not None and require_approved and p.status != "approved":
        return None
    return p


def require_active_profile(db: Session, user: User) -> CandidateProfile:
    p = get_active_profile(db, user)
    if p is None:
        raise DomainError("Approve your candidate profile first (Candidate Profile page).", status_code=409)
    return p


# --- LLM-assisted extraction -------------------------------------------------------------------

_LLM_SYSTEM = (
    "You extract structured data from a resume. Copy text exactly as written in the resume. Never invent, "
    "infer, embellish or normalise facts that are not explicitly present. If a field is absent, use an empty "
    "string or empty list. Return a single JSON object only."
)
_LLM_SCHEMA = """{
 "full_name": "", "email": "", "phone": "", "location": "", "linkedin_url": "", "github_url": "", "portfolio_url": "",
 "headline": "", "summary": "",
 "experiences": [{"company": "", "title": "", "location": "", "start_date": "", "end_date": "", "is_current": false, "bullets": [""]}],
 "educations": [{"institution": "", "degree": "", "field_of_study": "", "start_date": "", "end_date": "", "grade": ""}],
 "skills": [""],
 "projects": [{"name": "", "description": "", "bullets": [""], "technologies": [""], "url": ""}],
 "certifications": [{"name": "", "issuer": "", "issue_date": ""}],
 "achievements": [""], "publications": [""]
}"""


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9+#]+", " ", (s or "").lower()).strip()


def _grounded(value: str, source_norm: str, *, fuzzy: bool = False) -> bool:
    v = _norm(value)
    if not v:
        return True
    if v in source_norm:
        return True
    if fuzzy:
        tokens = [t for t in v.split() if len(t) > 2]
        if not tokens:
            return True
        hits = sum(1 for t in tokens if f" {t} " in f" {source_norm} ")
        return hits / len(tokens) >= 0.85
    return False


def ground_llm_profile(data: dict, source_text: str) -> tuple[dict, list[str]]:
    """Drop anything the LLM returned that cannot be found in the resume text."""
    src = _norm(source_text)
    dropped: list[str] = []
    out: dict = {}
    for f in ("full_name", "email", "phone", "location", "linkedin_url", "github_url", "portfolio_url", "headline"):
        val = str(data.get(f) or "").strip()
        check = re.sub(r"^https?://(www\.)?", "", val) if f.endswith("_url") else val
        if f == "phone":
            ok = re.sub(r"\D", "", val) in re.sub(r"\D", "", source_text) if val else True
        else:
            ok = _grounded(check, src)
        out[f] = val if ok else ""
        if not ok:
            dropped.append(f)
    out["summary"] = str(data.get("summary") or "") if _grounded(str(data.get("summary") or ""), src, fuzzy=True) else ""

    def list_items(key: str, fields: dict[str, bool]) -> list[dict]:
        items = []
        for item in data.get(key) or []:
            if not isinstance(item, dict):
                continue
            clean: dict = {}
            for f, fuzzy in fields.items():
                val = str(item.get(f) or "").strip()
                if _grounded(val, src, fuzzy=fuzzy):
                    clean[f] = val
                else:
                    clean[f] = ""
                    dropped.append(f"{key}.{f}")
            bullets = [str(b) for b in item.get("bullets") or [] if isinstance(b, str)]
            kept = [b for b in bullets if _grounded(b, src, fuzzy=True)]
            dropped.extend([f"{key}.bullet"] * (len(bullets) - len(kept)))
            clean["bullets"] = kept
            if key in ("experiences", "projects"):
                techs = [canonicalize(t) for t in item.get("technologies") or [] if isinstance(t, str)]
                clean["technologies"] = [t for t in techs if _grounded(t, src)]
            for df in ("start_date", "end_date", "issue_date"):
                if df in item:
                    raw = str(item.get(df) or "")
                    norm = normalize_date(raw)
                    year = norm[:4] if norm and norm != "present" else ""
                    clean[df] = norm if norm != "present" and (not year or year in source_text) else ""
                    if norm == "present":
                        clean["is_current"] = True
            if "is_current" in item and key == "experiences":
                clean["is_current"] = bool(item.get("is_current")) or clean.get("is_current", False)
            if any(v for k, v in clean.items() if k not in ("bullets", "technologies", "is_current")):
                items.append(clean)
        return items

    out["experiences"] = list_items("experiences", {"company": False, "title": False, "location": False})
    out["educations"] = list_items("educations", {"institution": True, "degree": True, "field_of_study": True, "grade": False})
    out["projects"] = list_items("projects", {"name": True, "description": True, "url": False})
    out["certifications"] = list_items("certifications", {"name": True, "issuer": True})
    for e in out["educations"]:
        e.pop("bullets", None)
    for c in out["certifications"]:
        c.pop("bullets", None)
    skills = []
    for s in data.get("skills") or []:
        name = s.get("name") if isinstance(s, dict) else s
        if isinstance(name, str) and name.strip() and _grounded(name, src):
            canon = canonicalize(name)
            skills.append({"name": canon, "category": category_of(canon)})
        elif isinstance(name, str) and name.strip():
            dropped.append("skills")
    out["skills"] = skills
    out["achievements"] = [a for a in data.get("achievements") or [] if isinstance(a, str) and _grounded(a, src, fuzzy=True)]
    out["publications"] = [a for a in data.get("publications") or [] if isinstance(a, str) and _grounded(a, src, fuzzy=True)]
    return out, dropped


def llm_parse(db: Session, user: User, text: str) -> tuple[dict, list[str]] | None:
    runner = get_runner(db, user)
    if runner is None:
        return None
    prompt = (
        "Extract the resume below into this JSON shape (dates as written, e.g. 'Jan 2021' or 'Present'):\n"
        f"{_LLM_SCHEMA}\n\n{untrusted('resume', text, 30000)}"
    )
    try:
        data, _ = runner.complete_json(_LLM_SYSTEM, prompt, max_tokens=6000)
    except LLMError as exc:
        log.warning("LLM resume parse failed; using rule-based parser", extra={"ctx": {"error": str(exc)}})
        return None
    if not isinstance(data, dict):
        return None
    return ground_llm_profile(data, text)


def _merge(rule: dict, llm: dict) -> dict:
    """Prefer grounded LLM values, falling back to rule-based values field by field."""
    merged = dict(rule)
    for k, v in llm.items():
        if isinstance(v, list):
            if len(v) >= len(rule.get(k) or []) and v:
                merged[k] = v
        elif v:
            merged[k] = v
    # Union skills
    names = {s["name"].lower() for s in merged.get("skills", [])}
    for s in rule.get("skills", []):
        if s["name"].lower() not in names:
            merged.setdefault("skills", []).append(s)
            names.add(s["name"].lower())
    return merged


def create_from_upload(
    db: Session, user: User, filename: str, data: bytes, *, use_llm: bool = True, label: str = ""
) -> tuple[MasterResume, CandidateProfile]:
    try:
        upload = validate_resume_upload(filename, data)
    except UploadRejected as exc:
        raise DomainError(str(exc)) from exc
    try:
        text = extract_text(upload.data, upload.extension)
    except ExtractionError as exc:
        raise DomainError(str(exc)) from exc

    settings = get_settings()
    rel = store_bytes(settings.uploads_dir, user.id, upload.data, upload.extension)
    resume = MasterResume(
        user_id=user.id,
        label=label or upload.original_filename,
        original_filename=upload.original_filename,
        stored_path=rel,
        mime_type=upload.mime_type,
        size_bytes=upload.size,
        sha256=upload.sha256,
        extracted_text=text,
    )
    db.add(resume)
    db.flush()

    parsed = parse_resume_text(text)
    profile_data = parsed.data
    warnings = list(parsed.warnings)
    method = "rules"
    if use_llm:
        llm = llm_parse(db, user, text)
        if llm is not None:
            llm_data, dropped = llm
            profile_data = _merge(parsed.data, llm_data)
            method = "rules+llm"
            if dropped:
                warnings.append(
                    f"{len(dropped)} AI-extracted value(s) were discarded because they do not appear in your resume."
                )
            # Re-evaluate missing-field warnings after merge
            warnings = [w for w in warnings if not any(
                w.startswith(f"Could not find your {lbl}") and profile_data.get(k)
                for k, lbl in (("full_name", "name"), ("email", "email"), ("phone", "phone number"))
            )]

    has_profiles = db.scalar(select(CandidateProfile.id).where(CandidateProfile.user_id == user.id)) is not None
    profile = CandidateProfile(
        user_id=user.id,
        master_resume_id=resume.id,
        label=label or f"Profile from {upload.original_filename}",
        status="draft",
        is_active=not has_profiles,
        parse_method=method,
        parse_warnings=warnings,
    )
    db.add(profile)
    db.flush()
    apply_profile_data(db, profile, profile_data)
    audit(db, user.id, "resume.uploaded", target_type="master_resume", target_id=resume.id,
          data={"size": upload.size, "parse_method": method})
    db.commit()
    db.refresh(profile)
    return resume, profile


def create_blank(db: Session, user: User, label: str = "Primary profile") -> CandidateProfile:
    has_profiles = db.scalar(select(CandidateProfile.id).where(CandidateProfile.user_id == user.id)) is not None
    p = CandidateProfile(user_id=user.id, label=label, status="draft", is_active=not has_profiles, parse_method="manual")
    if not has_profiles:
        p.full_name = user.full_name
        p.email = user.email
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def update_profile(db: Session, user: User, profile: CandidateProfile, data: dict) -> CandidateProfile:
    apply_profile_data(db, profile, data)
    profile.version += 1
    profile.updated_at = datetime.now(UTC)
    audit(db, user.id, "profile.updated", target_type="profile", target_id=profile.id, data={"version": profile.version})
    db.commit()
    db.refresh(profile)
    return profile


def approve(db: Session, user: User, profile: CandidateProfile) -> CandidateProfile:
    problems = []
    if not profile.full_name.strip():
        problems.append("full name")
    if not profile.email.strip():
        problems.append("email")
    if problems:
        raise DomainError(f"Please add your {' and '.join(problems)} before approving.")
    profile.status = "approved"
    profile.approved_at = datetime.now(UTC)
    activate(db, user, profile, commit=False)
    audit(db, user.id, "profile.approved", target_type="profile", target_id=profile.id, data={"version": profile.version})
    db.commit()
    db.refresh(profile)
    return profile


def activate(db: Session, user: User, profile: CandidateProfile, *, commit: bool = True) -> None:
    db.execute(
        update(CandidateProfile)
        .where(CandidateProfile.user_id == user.id, CandidateProfile.id != profile.id)
        .values(is_active=False)
    )
    profile.is_active = True
    if commit:
        db.commit()


def duplicate(db: Session, user: User, profile: CandidateProfile) -> CandidateProfile:
    clone = CandidateProfile(
        user_id=user.id,
        master_resume_id=profile.master_resume_id,
        label=f"{profile.label} (copy)"[:200],
        status="draft",
        is_active=False,
        parse_method=profile.parse_method,
        parse_warnings=[],
    )
    db.add(clone)
    db.flush()
    apply_profile_data(db, clone, profile_to_dict(profile) | {"label": clone.label})
    db.commit()
    db.refresh(clone)
    return clone
