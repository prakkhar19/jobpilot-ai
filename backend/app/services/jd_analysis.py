"""Job description analysis: required/preferred skills, experience, education, seniority, responsibilities."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.models import Job, JobRequirement
from app.services.skills import extract_skills

_REQUIRED_HEADINGS = re.compile(
    r"(?i)^(?:#+\s*)?(requirements?|qualifications|minimum qualifications|basic qualifications|required|"
    r"what you(?:'ll)? (?:need|bring)|what we(?:'re| are) looking for|who you are|you have|must[- ]haves?|"
    r"skills (?:and|&) experience|about you|your profile|required skills|key requirements)\b"
)
_PREFERRED_HEADINGS = re.compile(
    r"(?i)^(?:#+\s*)?(preferred(?: qualifications)?|nice[- ]to[- ]haves?|bonus(?: points)?|good to have|"
    r"pluses|additional qualifications|it(?:'s| is) a plus|desired|ideally)\b"
)
_RESP_HEADINGS = re.compile(
    r"(?i)^(?:#+\s*)?(responsibilities|what you(?:'ll| will) do|the role|your role|in this role|day[- ]to[- ]day|"
    r"key responsibilities|what you will be doing|your impact)\b"
)
_OTHER_HEADINGS = re.compile(
    r"(?i)^(?:#+\s*)?(benefits|perks|about us|about the company|who we are|our values|compensation|"
    r"equal opportunity|eeo|how to apply|why join|what we offer|salary)\b"
)
_PREFERRED_LINE = re.compile(r"(?i)\b(preferred|nice to have|a plus|is a plus|bonus|ideally|desirable|good to have)\b")
_YEARS_RE = re.compile(
    r"(?i)(\d{1,2})\s*\+?\s*(?:-|–|to)?\s*(\d{1,2})?\s*\+?\s*(?:years?|yrs?)(?:\s+of)?(?:\s+\w+){0,4}?\s*(?:experience|exp\b|in\b|with\b|building|working|professional)"
)
_EDU_LEVELS = [
    (4, re.compile(r"(?i)\b(ph\.?\s?d|doctorate|doctoral)\b")),
    (3, re.compile(r"(?i)\b(master'?s?|m\.?s\.?c?|m\.?tech|mba|graduate degree)\b")),
    (2, re.compile(r"(?i)\b(bachelor'?s?|b\.?s\.?c?|b\.?tech|b\.?e\.?|undergraduate degree|bs/ms|ba/bs|degree in)\b")),
]
EQUIVALENT_RE = re.compile(r"(?i)(or equivalent|equivalent (?:practical )?experience|or related experience)")

SENIORITY_PATTERNS = [
    ("intern", re.compile(r"(?i)\b(intern|internship|trainee|apprentice)\b")),
    ("principal", re.compile(r"(?i)\b(principal|distinguished|fellow)\b")),
    ("staff", re.compile(r"(?i)\bstaff\b")),
    ("lead", re.compile(r"(?i)\b(lead|head of|manager|director)\b")),
    ("senior", re.compile(r"(?i)\b(senior|sr\.?|iii|level 3|l5)\b")),
    ("junior", re.compile(r"(?i)\b(junior|jr\.?|entry[- ]level|graduate|new grad|associate|i\b|level 1)\b")),
    ("mid", re.compile(r"(?i)\b(mid[- ]level|ii\b|intermediate)\b")),
]


@dataclass
class JDAnalysis:
    required_skills: list[str] = field(default_factory=list)
    preferred_skills: list[str] = field(default_factory=list)
    mentioned_skills: list[str] = field(default_factory=list)
    min_years: float | None = None
    education_level: int | None = None
    education_text: str = ""
    education_mandatory: bool = False
    seniority: str = ""
    responsibilities: list[str] = field(default_factory=list)
    qualifications: list[str] = field(default_factory=list)


def detect_seniority(title: str, description: str = "") -> str:
    for label, pat in SENIORITY_PATTERNS:
        if pat.search(title or ""):
            return label
    return ""


def _clean(line: str) -> str:
    return re.sub(r"^\s*(?:[•●▪◦\-–—*]|\d+[.)])\s*", "", line).strip()


def analyze_text(title: str, description: str) -> JDAnalysis:
    a = JDAnalysis()
    section = "general"
    required_text: list[str] = []
    preferred_text: list[str] = []
    general_text: list[str] = []
    for raw in (description or "").split("\n"):
        line = raw.strip()
        if not line:
            continue
        stripped = line.rstrip(":").strip()
        if len(stripped) < 60:
            if _PREFERRED_HEADINGS.match(stripped):
                section = "preferred"
                continue
            if _REQUIRED_HEADINGS.match(stripped):
                section = "required"
                continue
            if _RESP_HEADINGS.match(stripped):
                section = "responsibilities"
                continue
            if _OTHER_HEADINGS.match(stripped):
                section = "other"
                continue
        text = _clean(line)
        if section == "other":
            continue
        if section == "responsibilities":
            if len(a.responsibilities) < 15 and len(text) > 15:
                a.responsibilities.append(text[:400])
            general_text.append(text)
        elif section == "preferred" or (section in ("required", "general") and _PREFERRED_LINE.search(text)):
            preferred_text.append(text)
        elif section == "required":
            required_text.append(text)
            if len(a.qualifications) < 20 and len(text) > 10:
                a.qualifications.append(text[:400])
        else:
            general_text.append(text)

    req = extract_skills("\n".join(required_text))
    pref = [s for s in extract_skills("\n".join(preferred_text)) if s not in req]
    general = [s for s in extract_skills("\n".join(general_text) + "\n" + (title or "")) if s not in req and s not in pref]
    if not required_text and not preferred_text:
        # No recognisable structure: treat skills mentioned anywhere as (non-mandatory) requirements.
        a.mentioned_skills = general
    else:
        a.required_skills = req
        a.preferred_skills = pref
        a.mentioned_skills = general

    years: list[float] = []
    for line in required_text or general_text:
        for m in _YEARS_RE.finditer(line):
            if not _PREFERRED_LINE.search(line):
                years.append(float(m.group(1)))
    if years:
        a.min_years = min(max(years), 15.0)

    edu_scope = "\n".join(required_text or general_text)
    for level, pat in _EDU_LEVELS:
        m = pat.search(edu_scope)
        if m:
            a.education_level = level if a.education_level is None else min(a.education_level, level)
            line = next((ln for ln in (required_text or general_text) if pat.search(ln)), "")
            a.education_text = line[:300]
    if a.education_level is not None:
        a.education_mandatory = not EQUIVALENT_RE.search(a.education_text)
    a.seniority = detect_seniority(title, description)
    return a


def analyze_job(db: Session, job: Job) -> JDAnalysis:
    """Analyse a job and persist its JobRequirement rows (idempotent)."""
    a = analyze_text(job.title, job.description_text)
    job.requirements.clear()
    db.flush()

    def add(kind: str, text: str = "", skill: str = "", mandatory: bool = False, value: float | None = None) -> None:
        job.requirements.append(
            JobRequirement(user_id=job.user_id, kind=kind, text=text[:2000], skill_name=skill[:120],
                           is_mandatory=mandatory, value_num=value)
        )

    for s in a.required_skills:
        add("required_skill", s, s, True)
    for s in a.mentioned_skills:
        add("required_skill", s, s, False)
    for s in a.preferred_skills:
        add("preferred_skill", s, s, False)
    if a.min_years is not None:
        add("experience_years", f"{a.min_years:g}+ years of experience", mandatory=True, value=a.min_years)
    if a.education_level is not None:
        add("education", a.education_text, mandatory=a.education_mandatory, value=float(a.education_level))
    if a.seniority:
        add("seniority", a.seniority)
        if not job.seniority:
            job.seniority = a.seniority
    for r in a.responsibilities:
        add("responsibility", r)
    for q in a.qualifications:
        add("qualification", q, mandatory=True)
    job.analyzed_at = datetime.now(UTC)
    return a


def analysis_from_job(job: Job) -> JDAnalysis:
    """Rebuild an analysis from stored requirements (falls back to re-analysing text)."""
    if not job.requirements:
        return analyze_text(job.title, job.description_text)
    a = JDAnalysis(seniority=job.seniority)
    for r in job.requirements:
        if r.kind == "required_skill":
            (a.required_skills if r.is_mandatory else a.mentioned_skills).append(r.skill_name)
        elif r.kind == "preferred_skill":
            a.preferred_skills.append(r.skill_name)
        elif r.kind == "experience_years":
            a.min_years = r.value_num
        elif r.kind == "education":
            a.education_level = int(r.value_num) if r.value_num is not None else None
            a.education_text = r.text
            a.education_mandatory = r.is_mandatory
        elif r.kind == "responsibility":
            a.responsibilities.append(r.text)
        elif r.kind == "qualification":
            a.qualifications.append(r.text)
    return a
