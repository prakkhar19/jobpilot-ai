"""Resume customisation engine.

Pipeline (per job): retrieve the approved profile → analyse the JD → select & order verified content
(skills, bullets, projects) by relevance → optionally ask the LLM to rephrase the summary and bullets
→ fact-check every rewrite against the profile, reverting any that fail → render DOCX/PDF → store an
immutable ResumeVersion with a full change log.

Nothing is ever added that is not in the profile. JD skills that the profile lacks are reported as
gaps, never inserted.
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from types import SimpleNamespace

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.adapters.llm.base import LLMError, untrusted
from app.core.config import get_settings
from app.core.errors import DomainError
from app.documents.render import TEMPLATES, render_docx, render_pdf
from app.models import CandidateProfile, Job, ResumeVersion, User
from app.security.uploads import store_bytes
from app.services.audit import audit
from app.services.factcheck import build_fact_base, check_text
from app.services.jd_analysis import analysis_from_job, analyze_job
from app.services.llm_service import get_runner
from app.services.matching import TfidfModel, tokenize, total_experience_years
from app.services.profiles import profile_to_dict
from app.services.skills import extract_skills, skill_key

log = logging.getLogger(__name__)

TARGET_ROLES = [
    "AI Engineer", "LLM Engineer", "Machine Learning Engineer", "NLP Engineer", "Software Engineer",
    "Backend Developer", "Python Developer", "Full-Stack Developer", "Data Engineer", "Data Scientist",
    "Frontend Developer", "DevOps Engineer",
]
CATEGORY_TITLES = {
    "language": "Languages", "framework": "Frameworks & Libraries", "ml": "AI / ML", "data": "Data",
    "database": "Databases", "cloud": "Cloud", "devops": "DevOps & Tooling", "tool": "Tools", "concept": "Concepts",
    "practice": "Practices", "soft": "Professional", "other": "Other",
}
MAX_BULLETS_PER_ROLE = 6
MAX_PROJECTS = 3


def _fmt_date(d: str) -> str:
    m = re.fullmatch(r"(\d{4})-(\d{2})", d or "")
    if m:
        return datetime(int(m.group(1)), int(m.group(2)), 1).strftime("%b %Y")
    return d or ""


def date_range(start: str, end: str, current: bool = False) -> str:
    s, e = _fmt_date(start), ("Present" if current else _fmt_date(end))
    return f"{s} – {e}" if s and e else (s or e)


def _relevance(text: str, jd_skills: set[str], jd_terms: set[str]) -> float:
    skills = {skill_key(s) for s in extract_skills(text)}
    toks = set(tokenize(text))
    return 2.0 * len(skills & jd_skills) + 0.5 * len(toks & jd_terms) + (0.3 if re.search(r"\d", text) else 0)


def base_content(profile_data: dict) -> dict:
    """Untailored resume content straight from the profile (used for 'original' comparison)."""
    skills_by_cat: dict[str, list[str]] = {}
    for s in profile_data.get("skills") or []:
        skills_by_cat.setdefault(s.get("category") or "other", []).append(s["name"])
    return {
        "header": {k: profile_data.get(k, "") for k in ("full_name", "email", "phone", "location", "linkedin_url",
                                                        "github_url", "portfolio_url", "headline")},
        "summary": profile_data.get("summary", ""),
        "skills": [{"category": CATEGORY_TITLES.get(c, c.title()), "items": items} for c, items in skills_by_cat.items()],
        "experiences": [
            {"company": e["company"], "title": e["title"], "location": e.get("location", ""),
             "dates": date_range(e.get("start_date", ""), e.get("end_date", ""), e.get("is_current", False)),
             "bullets": list(e.get("bullets") or [])}
            for e in profile_data.get("experiences") or []
        ],
        "projects": [
            {"name": p["name"], "description": p.get("description", ""), "url": p.get("url", ""),
             "technologies": list(p.get("technologies") or []), "bullets": list(p.get("bullets") or [])}
            for p in profile_data.get("projects") or []
        ],
        "education": [
            {"institution": ed["institution"], "degree": ed["degree"], "field_of_study": ed.get("field_of_study", ""),
             "dates": date_range(ed.get("start_date", ""), ed.get("end_date", "")), "grade": ed.get("grade", "")}
            for ed in profile_data.get("educations") or []
        ],
        "certifications": [
            {"name": c["name"], "issuer": c.get("issuer", ""), "date": _fmt_date(c.get("issue_date", ""))}
            for c in profile_data.get("certifications") or []
        ],
        "achievements": list(profile_data.get("achievements") or []),
        "publications": list(profile_data.get("publications") or []),
    }


def deterministic_tailor(profile_data: dict, job: Job | None, target_role: str) -> tuple[dict, list[dict], dict]:
    """Select and order verified content by relevance. Returns (content, change_log, keyword_report)."""
    content = base_content(profile_data)
    changes: list[dict] = []
    if job is None:
        return content, changes, {}
    analysis = analysis_from_job(job)
    jd_skill_list = analysis.required_skills + analysis.mentioned_skills + analysis.preferred_skills
    jd_skills = {skill_key(s) for s in jd_skill_list}
    model = TfidfModel([job.description_text])
    vec = model.vector(job.description_text)
    jd_terms = {t for t, _ in sorted(vec.items(), key=lambda kv: -kv[1])[:60]}

    # 1. Skills: JD-relevant first (in JD order), others after. Never add skills.
    profile_skills = {skill_key(s["name"]): s for s in profile_data.get("skills") or []}
    # Skills evidenced in the user's own verified text (summary, bullets, projects) also count as facts.
    evidenced = build_fact_base(profile_data).skills
    for s in jd_skill_list:
        if skill_key(s) in evidenced and skill_key(s) not in profile_skills:
            profile_skills[skill_key(s)] = {"name": s, "category": "other", "_evidenced": True}
    relevant = [profile_skills[k]["name"] for k in [skill_key(s) for s in jd_skill_list] if k in profile_skills]
    relevant = list(dict.fromkeys(relevant))
    if relevant:
        others: dict[str, list[str]] = {}
        for s in profile_data.get("skills") or []:
            if s["name"] not in relevant:
                others.setdefault(s.get("category") or "other", []).append(s["name"])
        content["skills"] = [{"category": "Relevant to this role", "items": relevant}] + [
            {"category": CATEGORY_TITLES.get(c, c.title()), "items": items} for c, items in others.items()
        ]
        changes.append({"section": "skills", "type": "reordered",
                        "detail": f"Moved {len(relevant)} skills that this job asks for to the top.",
                        "after": ", ".join(relevant)})

    # 2. Experience bullets: order by relevance, keep at most MAX_BULLETS_PER_ROLE (all roles kept).
    for exp in content["experiences"]:
        bullets = exp["bullets"]
        if len(bullets) < 2:
            continue
        ranked = sorted(bullets, key=lambda b: -_relevance(b, jd_skills, jd_terms))
        kept = ranked[: max(MAX_BULLETS_PER_ROLE, 2)]
        if kept != bullets:
            changes.append({"section": "experience", "type": "reordered", "item": f"{exp['title']} @ {exp['company']}",
                            "detail": "Reordered bullet points so the most relevant come first"
                            + (f"; omitted {len(bullets) - len(kept)} less relevant bullet(s)" if len(kept) < len(bullets) else "") + "."})
        exp["bullets"] = kept

    # 3. Projects: pick the most relevant.
    projects = content["projects"]
    if projects:
        scored = sorted(projects, key=lambda p: -_relevance(" ".join([p["name"], p["description"], *p["bullets"],
                                                                         *p["technologies"]]), jd_skills, jd_terms))
        selected = scored[:MAX_PROJECTS]
        if [p["name"] for p in selected] != [p["name"] for p in projects]:
            changes.append({"section": "projects", "type": "selected",
                            "detail": f"Selected the {len(selected)} most relevant project(s): "
                            + ", ".join(p["name"] for p in selected) + "."})
        for p in selected:
            p["bullets"] = sorted(p["bullets"], key=lambda b: -_relevance(b, jd_skills, jd_terms))
        content["projects"] = selected

    # 4. Summary: keep the user's own summary; if none, compose one strictly from verified facts.
    if not content["summary"].strip():
        years = total_experience_years([SimpleNamespace(**x) for x in profile_data.get("experiences") or []])
        role = (profile_data.get("experiences") or [{}])[0].get("title") or profile_data.get("headline") or target_role
        parts = [role]
        if years and years >= 1:
            parts.append(f"with {int(years)}+ years of experience")
        if relevant:
            parts.append(f"working with {', '.join(relevant[:5])}")
        if role:
            content["summary"] = " ".join(parts).strip() + "."
            changes.append({"section": "summary", "type": "generated",
                            "detail": "Composed a summary from your verified titles, dates and skills.",
                            "after": content["summary"]})

    present = {skill_key(s) for grp in content["skills"] for s in grp["items"]}
    report = {
        "job_skills": jd_skill_list,
        "covered": [s for s in jd_skill_list if skill_key(s) in present],
        "not_in_profile": [s for s in jd_skill_list if skill_key(s) not in present],
        "note": "Skills not in your profile were NOT added. Add them to your profile only if you genuinely have them.",
    }
    return content, changes, report


_REWRITE_SYSTEM = """You are an expert resume writer improving a candidate's resume for a specific job.
STRICT RULES — violating any of them makes the output unusable:
- Use ONLY facts present in the candidate's original text. Do not add skills, tools, employers, titles, dates,
  degrees, certifications, metrics, numbers, team sizes, or achievements that are not in the original.
- You may rephrase for clarity and impact, start with strong action verbs, and use the job's terminology ONLY
  where the original already describes the same thing.
- Keep each bullet to one sentence (max ~30 words). Keep every number exactly as in the original.
- Return JSON only: {"summary": "...", "bullets": {"<id>": "<rewritten bullet>", ...}}"""


def llm_rewrite(db: Session, user: User, content: dict, profile_data: dict, job: Job, target_role: str,
                changes: list[dict]) -> tuple[dict, dict, str, str]:
    """Ask the configured LLM to rephrase summary + bullets; fact-check each result.
    Returns (content, fact_check_report, provider, model)."""
    runner = get_runner(db, user)
    report = {"checked": 0, "accepted": 0, "rejected": 0, "rejections": []}
    if runner is None:
        return content, report, "", ""
    facts = build_fact_base(profile_data)
    items: dict[str, str] = {}
    for i, exp in enumerate(content["experiences"][:4]):
        for j, b in enumerate(exp["bullets"]):
            items[f"e{i}b{j}"] = b
    for i, p in enumerate(content["projects"]):
        for j, b in enumerate(p["bullets"][:3]):
            items[f"p{i}b{j}"] = b
    analysis = analysis_from_job(job)
    prompt = (
        f"Target role: {target_role or job.title}\n"
        f"Key job skills: {', '.join((analysis.required_skills + analysis.preferred_skills)[:20])}\n"
        f"Candidate verified skills: {', '.join(s['name'] for s in profile_data.get('skills') or [])}\n\n"
        f"Original summary:\n{content['summary'] or '(none — write 2 sentences using only the facts below)'}\n\n"
        f"Original bullets (id: text):\n" + "\n".join(f"{k}: {v}" for k, v in items.items()) + "\n\n"
        f"Job posting for context only:\n{untrusted('job_posting', job.description_text, 8000)}"
    )
    try:
        data, result = runner.complete_json(_REWRITE_SYSTEM, prompt, max_tokens=4000)
    except LLMError as exc:
        changes.append({"section": "ai", "type": "skipped", "detail": f"AI rewriting unavailable: {exc}"})
        return content, report, "", ""
    if not isinstance(data, dict):
        return content, report, result.provider, result.model

    new_summary = str(data.get("summary") or "").strip()
    if new_summary and new_summary != content["summary"]:
        report["checked"] += 1
        chk = check_text(new_summary, facts)
        if chk.ok and len(new_summary) < 900:
            changes.append({"section": "summary", "type": "rewritten", "before": content["summary"], "after": new_summary,
                            "detail": "Rewrote summary for this role (fact-checked)."})
            content["summary"] = new_summary
            report["accepted"] += 1
        else:
            report["rejected"] += 1
            report["rejections"].append({"section": "summary", "text": new_summary, "reasons": chk.violations or ["too long"]})

    rewritten = data.get("bullets") if isinstance(data.get("bullets"), dict) else {}
    for key, original in items.items():
        new = str(rewritten.get(key) or "").strip()
        if not new or new == original:
            continue
        report["checked"] += 1
        chk = check_text(new, facts, source_text=original)
        if not chk.ok or len(new) > 400:
            report["rejected"] += 1
            report["rejections"].append({"section": key, "original": original, "text": new,
                                         "reasons": chk.violations or ["too long"]})
            continue
        report["accepted"] += 1
        kind, i, j = key[0], int(key[1:].split("b")[0]), int(key.split("b")[1])
        target = content["experiences"][i] if kind == "e" else content["projects"][i]
        target["bullets"][j] = new
        changes.append({"section": "experience" if kind == "e" else "projects", "type": "rewritten",
                        "item": target.get("company") or target.get("name"), "before": original, "after": new,
                        "detail": "Rephrased bullet (fact-checked)."})
    if report["rejected"]:
        changes.append({"section": "ai", "type": "fact_check",
                        "detail": f"{report['rejected']} AI suggestion(s) were rejected because they added "
                        "information not in your profile; the original wording was kept."})
    return content, report, result.provider, result.model


def _filename(profile_data: dict, job: Job | None, ext: str) -> str:
    name = re.sub(r"[^A-Za-z0-9]+", "_", profile_data.get("full_name") or "Resume").strip("_")
    suffix = re.sub(r"[^A-Za-z0-9]+", "_", f"{job.company}_{job.title}" if job else "General").strip("_")[:60]
    return f"{name}_{suffix}{ext}"


def generate_resume(db: Session, user: User, profile: CandidateProfile, job: Job | None, *, template: str = "classic",
                    target_role: str = "", use_llm: bool = True) -> ResumeVersion:
    if profile.status != "approved":
        raise DomainError("Approve your profile before generating resumes.", status_code=409)
    if template not in TEMPLATES:
        raise DomainError(f"Unknown template '{template}'.")
    if job is not None and (job.analyzed_at is None or not job.requirements):
        analyze_job(db, job)
    profile_data = profile_to_dict(profile)
    content, changes, keywords = deterministic_tailor(profile_data, job, target_role)
    fact_report: dict = {"checked": 0, "accepted": 0, "rejected": 0, "rejections": []}
    provider = model = ""
    method = "deterministic"
    if use_llm and job is not None:
        content, fact_report, provider, model = llm_rewrite(db, user, content, profile_data, job, target_role, changes)
        if provider:
            method = "llm+factcheck"
    # Final whole-document safety net: every skill in the output must be in the profile.
    facts = build_fact_base(profile_data)
    doc_text = "\n".join([content["summary"], *[b for e in content["experiences"] for b in e["bullets"]],
                          *[b for p in content["projects"] for b in p["bullets"]]])
    final = check_text(doc_text, facts)
    fact_report["final_check"] = {"ok": not any("not in your profile" in v for v in final.violations),
                                  "notes": final.violations[:10]}
    content["target_role"] = target_role or (job.title if job else "")
    content["job"] = {"company": job.company, "title": job.title} if job else None
    content["keyword_report"] = keywords

    n = (db.scalar(select(func.max(ResumeVersion.version_number)).where(ResumeVersion.user_id == user.id,
                                                                        ResumeVersion.job_id == (job.id if job else None)))
         or 0) if job else (db.scalar(select(func.max(ResumeVersion.version_number)).where(
             ResumeVersion.user_id == user.id, ResumeVersion.job_id.is_(None))) or 0)
    settings = get_settings()
    docx_rel = store_bytes(settings.generated_dir, user.id, render_docx(content, template), ".docx")
    pdf_rel = store_bytes(settings.generated_dir, user.id, render_pdf(content, template), ".pdf")
    rv = ResumeVersion(
        user_id=user.id, profile_id=profile.id, job_id=job.id if job else None, version_number=n + 1,
        label=f"{job.company} — {job.title}"[:300] if job else f"General resume ({target_role or 'all roles'})",
        target_role=(target_role or (job.title if job else ""))[:120], template=template, content=content,
        profile_snapshot=profile_data | {"_version": profile.version}, change_log=changes, fact_check=fact_report,
        generation_method=method, provider=provider, model=model, docx_path=docx_rel, pdf_path=pdf_rel,
        created_at=datetime.now(UTC),
    )
    db.add(rv)
    audit(db, user.id, "resume_version.generated", target_type="resume_version", target_id=rv.id,
          data={"job_id": str(job.id) if job else "", "method": method})
    db.commit()
    db.refresh(rv)
    return rv


def rerender(db: Session, user: User, rv: ResumeVersion, content: dict, template: str | None = None) -> ResumeVersion:
    """Create a new version from user-edited content (the user is the source of truth for their edits)."""
    template = template or rv.template
    if template not in TEMPLATES:
        raise DomainError(f"Unknown template '{template}'.")
    settings = get_settings()
    n = (db.scalar(select(func.max(ResumeVersion.version_number)).where(ResumeVersion.user_id == user.id,
                                                                        ResumeVersion.job_id == rv.job_id)) or 0)
    new = ResumeVersion(
        user_id=user.id, profile_id=rv.profile_id, job_id=rv.job_id, parent_version_id=rv.id, version_number=n + 1,
        label=rv.label, target_role=rv.target_role, template=template, content=content,
        profile_snapshot=rv.profile_snapshot, fact_check=rv.fact_check, generation_method="user_edit",
        change_log=[*rv.change_log, {"section": "all", "type": "user_edit", "detail": "Edited by you."}],
        provider=rv.provider, model=rv.model,
        docx_path=store_bytes(settings.generated_dir, user.id, render_docx(content, template), ".docx"),
        pdf_path=store_bytes(settings.generated_dir, user.id, render_pdf(content, template), ".pdf"),
        created_at=datetime.now(UTC),
    )
    db.add(new)
    db.commit()
    db.refresh(new)
    return new


def download_name(rv: ResumeVersion, ext: str) -> str:
    job = rv.content.get("job") or {}
    ref = SimpleNamespace(company=job.get("company", ""), title=job.get("title", "")) if job else None
    return _filename(rv.profile_snapshot, ref, ext)  # type: ignore[arg-type]
