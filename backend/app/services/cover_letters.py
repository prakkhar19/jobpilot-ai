"""Cover letter generation (LLM with fact-checking, or a deterministic template from verified facts)."""

from __future__ import annotations

import re
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.adapters.llm.base import LLMError, untrusted
from app.core.errors import DomainError
from app.models import CandidateProfile, CoverLetter, Job, User
from app.services.audit import audit
from app.services.factcheck import build_fact_base, check_text
from app.services.jd_analysis import analysis_from_job, analyze_job
from app.services.llm_service import get_runner
from app.services.matching import TfidfModel, tokenize
from app.services.profiles import profile_to_dict
from app.services.skills import skill_key

_SYSTEM = """You write concise, professional, human-sounding cover letters (180-280 words, 3-4 short paragraphs,
no headings, no placeholders, no bullet points).
STRICT RULES:
- Use ONLY the candidate facts provided. Never invent experience, skills, metrics, employers, degrees,
  certifications, or any prior relationship with or knowledge of the company beyond what the job posting says.
- Do not claim the candidate has a skill the job asks for unless it is in the candidate facts.
- If the candidate's motivation is provided, use it; otherwise keep motivation generic and honest.
- Start with "Dear Hiring Manager," and end with "Sincerely," followed by the candidate's name.
Return only the letter text."""


def _facts_block(p: dict) -> str:
    lines = [f"Name: {p.get('full_name')}"]
    if p.get("headline"):
        lines.append(f"Headline: {p['headline']}")
    if p.get("summary"):
        lines.append(f"Summary: {p['summary']}")
    for e in (p.get("experiences") or [])[:4]:
        lines.append(f"Role: {e['title']} at {e['company']} ({e.get('start_date', '')} – "
                     f"{'present' if e.get('is_current') else e.get('end_date', '')})")
        lines += [f"  - {b}" for b in (e.get("bullets") or [])[:5]]
    for pr in (p.get("projects") or [])[:3]:
        lines.append(f"Project: {pr['name']}: {pr.get('description', '')}")
        lines += [f"  - {b}" for b in (pr.get("bullets") or [])[:3]]
    lines.append("Skills: " + ", ".join(s["name"] for s in p.get("skills") or []))
    for ed in (p.get("educations") or [])[:2]:
        lines.append(f"Education: {ed.get('degree', '')} {ed.get('field_of_study', '')}, {ed.get('institution', '')}")
    if p.get("motivation"):
        lines.append(f"Candidate's own motivation statement: {p['motivation']}")
    return "\n".join(lines)


def _best(items: list[str], jd_terms: set[str], jd_skills: set[str]) -> str:
    from app.services.skills import extract_skills

    def score(t: str) -> float:
        return 2 * len({skill_key(s) for s in extract_skills(t)} & jd_skills) + len(set(tokenize(t)) & jd_terms)

    ranked = sorted(items, key=score, reverse=True)
    return ranked[0] if ranked else ""


def deterministic_letter(p: dict, job: Job) -> str:
    a = analysis_from_job(job)
    jd_skills = {skill_key(s) for s in a.required_skills + a.mentioned_skills + a.preferred_skills}
    vec = TfidfModel([job.description_text]).vector(job.description_text)
    jd_terms = {t for t, _ in sorted(vec.items(), key=lambda kv: -kv[1])[:40]}
    have = [s["name"] for s in p.get("skills") or [] if skill_key(s["name"]) in jd_skills][:5]
    exps = p.get("experiences") or []
    recent = exps[0] if exps else None
    bullets = [b for e in exps[:3] for b in e.get("bullets") or []]
    best_bullet = _best(bullets, jd_terms, jd_skills)
    projects = p.get("projects") or []
    best_project = None
    if projects:
        best_project = max(projects, key=lambda pr: len({skill_key(t) for t in pr.get("technologies") or []} & jd_skills))

    paras = ["Dear Hiring Manager,"]
    intro = f"I am writing to apply for the {job.title} position at {job.company}."
    if recent:
        verb = "am" if recent.get("is_current") else "was"
        intro += f" I {verb} a {recent['title']} at {recent['company']}"
        intro += f", where I worked with {', '.join(have[:3])}." if have else "."
    paras.append(intro)
    if best_bullet:
        b = best_bullet.rstrip(".")
        paras.append(f"In that work I {b[0].lower() + b[1:]}. "
                     + (f"My experience with {', '.join(have)} aligns with what this role requires." if have else
                        "I would bring the same focus on quality and delivery to your team."))
    if best_project:
        desc = (best_project.get("description") or (best_project.get("bullets") or [""])[0]).rstrip(".")
        if desc:
            paras.append(f"I also built {best_project['name']}: {desc[0].lower() + desc[1:]}.")
    if p.get("motivation"):
        paras.append(p["motivation"].strip())
    else:
        paras.append(f"I would welcome the opportunity to discuss how I can contribute to {job.company}.")
    paras.append(f"Sincerely,\n{p.get('full_name', '')}")
    return "\n\n".join(paras)


def _strip_unverified(text: str, facts, job: Job) -> tuple[str, list[str]]:  # noqa: ANN001
    """Remove sentences that fail fact-checking. The employer's own text is allowed for naming the company/role."""
    removed: list[str] = []
    paras_out = []
    for para in text.split("\n\n"):
        sentences = re.split(r"(?<=[.!?])\s+", para.strip())
        kept = []
        for s in sentences:
            res = check_text(s, facts)
            # Company/role names and JD terms are allowed in a cover letter; skills/numbers/credentials are not.
            hard = [v for v in res.violations if "names '" not in v]
            if hard:
                removed.append(f"{s} — {'; '.join(hard)}")
            else:
                kept.append(s)
        if kept:
            paras_out.append(" ".join(kept))
    return "\n\n".join(paras_out), removed


def generate(db: Session, user: User, profile: CandidateProfile, job: Job, *, use_llm: bool = True) -> CoverLetter:
    if profile.status != "approved":
        raise DomainError("Approve your profile before generating cover letters.", status_code=409)
    if job.analyzed_at is None or not job.requirements:
        analyze_job(db, job)
    p = profile_to_dict(profile)
    text, method, provider, model = "", "deterministic", "", ""
    report: dict = {"removed_sentences": []}
    runner = get_runner(db, user) if use_llm else None
    if runner is not None:
        prompt = (f"Candidate facts (the ONLY facts you may use):\n{_facts_block(p)}\n\n"
                  f"Job: {job.title} at {job.company}\n{untrusted('job_posting', job.description_text, 8000)}")
        try:
            result = runner.complete(_SYSTEM, prompt, max_tokens=1500)
            facts = build_fact_base(p, extra_texts=[job.company, job.title, job.description_text])
            text, removed = _strip_unverified(result.text.strip(), facts, job)
            report["removed_sentences"] = removed
            method, provider, model = "llm+factcheck", result.provider, result.model
            if len(text) < 200:
                text, method = deterministic_letter(p, job), "deterministic"
                report["note"] = "AI letter failed fact-checking; used the verified template instead."
        except LLMError as exc:
            report["note"] = f"AI unavailable ({exc}); used the verified template."
    if not text:
        text = deterministic_letter(p, job)
    n = db.scalar(select(func.max(CoverLetter.version_number)).where(CoverLetter.user_id == user.id,
                                                                     CoverLetter.job_id == job.id)) or 0
    cl = CoverLetter(user_id=user.id, job_id=job.id, profile_id=profile.id, version_number=n + 1, content=text,
                     generation_method=method, provider=provider, model=model, fact_check=report,
                     created_at=datetime.now(UTC))
    db.add(cl)
    audit(db, user.id, "cover_letter.generated", target_type="cover_letter", target_id=cl.id, data={"method": method})
    db.commit()
    db.refresh(cl)
    return cl
