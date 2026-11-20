"""API for the JobPilot Auto-Apply browser extension.

The extension runs in the user's own Chrome (their own logged-in LinkedIn / Naukri / Instahyre / company career
pages). For every job it finds it asks this API: is this a good match? → tailored resume + answers for the form's
questions → it fills and submits → reports the result here so the tracker stays complete.

Auth: ``POST /api/ext/login`` returns a bearer token (a normal JobPilot session). Every other call sends
``Authorization: Bearer <token>``. No cookies, so no CSRF.

Answers are never invented: anything the profile, application facts or answer bank can't answer comes back as
``null`` and the extension skips that job and puts it in "Needs you". Every answer the user gives later is saved to
the answer bank, so the bot needs the user less over time.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.adapters.application_providers.base import FormField, map_candidate_data, normalize_label
from app.agents.runner import get_config
from app.api.deps import DB, client_ip, get_owned_or_404, resolve_session
from app.core.config import get_settings
from app.core.database import bind_tenant
from app.core.errors import DomainError
from app.core.ratelimit import limiter
from app.models import Application, CoverLetter, Job, JobMatch, ResumeVersion, ScreeningAnswer, User
from app.security.uploads import resolve_within
from app.services import accounts, application_answers, cover_letters, discovery, tailoring
from app.services import applications as svc
from app.services.match_service import match_jobs
from app.services.matching import total_experience_years
from app.services.profiles import profile_to_dict, require_active_profile
from app.services.skills import skill_key

router = APIRouter(prefix="/api/ext", tags=["extension"])


# ------------------------------------------------------------------------------------------------ auth

def get_ext_user(request: Request, db: DB) -> User:
    header = request.headers.get("authorization", "")
    token = header[7:].strip() if header.lower().startswith("bearer ") else ""
    resolved = resolve_session(db, token)
    if resolved is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated. Log in again from the extension.")
    sess, user = resolved
    request.state.user_id = user.id
    request.state.session_id = sess.id
    bind_tenant(db, user.id)
    return user


ExtUser = Annotated[User, Depends(get_ext_user)]


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=200)


@router.post("/login")
def login(body: LoginIn, request: Request, db: DB) -> dict:
    ip = client_ip(request)
    if not limiter.hit(f"ext-login:{ip}", get_settings().rate_limit_login_per_minute, 60):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many login attempts. Try again in a minute.")
    user = accounts.authenticate(db, body.email, body.password, ip)
    token = accounts.create_session(db, user, ip, "JobPilot extension")
    return {"token": token, "name": user.full_name, "email": user.email}


# ---------------------------------------------------------------------------------------------- config

def _applied_today(db: DB, user: User, tz_name: str) -> int:
    try:
        tz = ZoneInfo(tz_name or "UTC")
    except ZoneInfoNotFoundError:
        tz = ZoneInfo("UTC")
    start = datetime.now(tz).replace(hour=0, minute=0, second=0, microsecond=0)
    return db.scalar(select(func.count(Application.id)).where(Application.user_id == user.id,
                                                              Application.submitted_at >= start)) or 0


@router.get("/config")
def config(db: DB, user: ExtUser) -> dict:
    cfg = get_config(db, user.id)
    profile = require_active_profile(db, user)
    p = profile_to_dict(profile)
    skills = [s["name"] for s in p.get("skills") or []]
    roles = cfg.target_roles or ([p["headline"]] if p.get("headline") else [])
    return {
        "target_roles": roles,
        "keywords": cfg.keywords,
        "excluded_keywords": cfg.excluded_keywords,
        "locations": cfg.locations,
        "countries": cfg.countries,
        "workplace_types": cfg.workplace_types,
        "exclude_companies": cfg.exclude_companies,
        "min_match_score": cfg.min_match_score,
        "applied_today": _applied_today(db, user, cfg.timezone),
        "profile": {
            "full_name": p.get("full_name", ""), "email": p.get("email") or user.email, "phone": p.get("phone", ""),
            "location": p.get("location", ""), "linkedin_url": p.get("linkedin_url", ""),
            "github_url": p.get("github_url", ""), "portfolio_url": p.get("portfolio_url", ""),
            "headline": p.get("headline", ""), "skills": skills[:30],
        },
    }


# -------------------------------------------------------------------------------------------- evaluate

class JobIn(BaseModel):
    platform: str = Field(default="web", max_length=40)  # linkedin | naukri | instahyre | greenhouse | ...
    url: str = Field(min_length=8, max_length=1000)
    title: str = Field(min_length=1, max_length=300)
    company: str = Field(min_length=1, max_length=300)
    location: str = Field(default="", max_length=300)
    workplace_type: str = Field(default="unknown", max_length=20)
    description: str = Field(default="", max_length=60000)


def _latest(db: DB, model: type, user: User, job_id: uuid.UUID):  # noqa: ANN202
    return db.scalar(select(model).where(model.user_id == user.id, model.job_id == job_id)
                     .order_by(model.created_at.desc()).limit(1))


# Postings scraped from job boards rarely state skills/experience in a parseable way, so their scores run low.
# When the title clearly matches a target role, a lower bar applies.
TITLE_MATCH_MIN_SCORE = 40.0
_SENIOR = re.compile(r"(?i)\b(principal|lead|architect|manager|staff|director|head|vp|vice president|sr\.?|senior)\b")


class _ExpRow:
    def __init__(self, d: dict) -> None:
        self.start_date = d.get("start_date") or ""
        self.end_date = d.get("end_date") or ""
        self.is_current = bool(d.get("is_current"))


def _excluded(cfg, job: JobIn) -> str:  # noqa: ANN001
    text = f"{job.title}\n{job.description}".lower()
    for kw in cfg.excluded_keywords or []:
        if kw and re.search(rf"\b{re.escape(kw.lower())}\b", text):
            return f"contains excluded keyword '{kw}'"
    for c in cfg.exclude_companies or []:
        if c and c.lower() == job.company.lower().strip():
            return f"company {job.company} is excluded"
    return ""


@router.post("/evaluate")
def evaluate(body: JobIn, db: DB, user: ExtUser) -> dict:
    """Import the job, score it, and if it passes the threshold prepare a tailored resume + cover letter."""
    profile = require_active_profile(db, user)
    cfg = get_config(db, user.id)
    description = body.description.strip() or f"{body.title} at {body.company}. {body.location}"
    url = body.url.split("#")[0]
    job = discovery.import_manual(db, user, title=body.title, company=body.company, description=description,
                                  location=body.location, url=url, workplace_type=body.workplace_type)
    if job.duplicate_of_id:
        job = db.get(Job, job.duplicate_of_id) or job
    app = db.scalar(select(Application).where(Application.user_id == user.id, Application.job_id == job.id))
    if app is not None and app.status in svc.POST_SUBMISSION:
        return {"job_id": str(job.id), "decision": "skip", "reason": "already applied", "score": app.match_score}

    reason = _excluded(cfg, body)
    if reason:
        return {"job_id": str(job.id), "decision": "skip", "reason": reason, "score": None}
    try:
        match_jobs(db, user, [job.id], use_embeddings=False)
    except DomainError:
        pass
    m = db.scalar(select(JobMatch).where(JobMatch.user_id == user.id, JobMatch.job_id == job.id))
    score = round(m.overall_score, 1) if m else 0.0
    p = profile_to_dict(profile)
    years = total_experience_years([_ExpRow(e) for e in p.get("experiences") or []]) or 0.0
    if years < 3 and _SENIOR.search(job.title):
        db.commit()
        return {"job_id": str(job.id), "decision": "skip", "score": score,
                "reason": f"senior role ({_SENIOR.search(job.title).group(0)}) for {years:.1f} years of experience"}
    title_match = next((c.get("score") or 0 for c in (m.components if m else []) if c.get("key") == "role_alignment"), 0)
    threshold = min(cfg.min_match_score, TITLE_MATCH_MIN_SCORE) if title_match >= 80 else cfg.min_match_score
    if score < threshold:
        db.commit()
        return {"job_id": str(job.id), "decision": "skip", "score": score,
                "reason": f"match {score} is below your minimum {threshold}"}

    return _prepare(db, user, profile, cfg, job, score, body.platform)


def _prepare(db: DB, user: User, profile, cfg, job: Job, score: float, platform: str) -> dict:  # noqa: ANN001
    rv = _latest(db, ResumeVersion, user, job.id)
    if rv is None:
        rv = tailoring.generate_resume(db, user, profile, job, template=cfg.resume_template, use_llm=cfg.use_llm)
    cl = _latest(db, CoverLetter, user, job.id)
    if cl is None:
        cl = cover_letters.generate(db, user, profile, job, use_llm=cfg.use_llm)
    app, _ = svc.get_or_create(db, user, job, actor="agent")
    app.resume_version_id, app.cover_letter_id = rv.id, cl.id
    app.match_score = score
    app.provider = f"ext:{platform}"[:30]
    if app.status in ("discovered", "shortlisted"):
        svc.event(db, app, "documents_ready", "Tailored resume and cover letter prepared by the extension.",
                  actor="agent", to_status="resume_generated")
    db.commit()
    return {"job_id": str(job.id), "decision": "apply", "score": score, "reason": "",
            "resume_version_id": str(rv.id), "resume_filename": tailoring.download_name(rv, ".pdf"),
            "cover_letter": cl.content}


@router.post("/jobs/{job_id}/prepare")
def prepare_known_job(job_id: uuid.UUID, db: DB, user: ExtUser) -> dict:
    """For jobs JobPilot already discovered (the company-board queue): make sure documents exist."""
    job = get_owned_or_404(db, Job, job_id, user, "Job")
    app = db.scalar(select(Application).where(Application.user_id == user.id, Application.job_id == job.id))
    if app is not None and app.status in svc.POST_SUBMISSION:
        return {"job_id": str(job.id), "decision": "skip", "reason": "already applied", "score": app.match_score}
    m = db.scalar(select(JobMatch).where(JobMatch.user_id == user.id, JobMatch.job_id == job.id))
    return _prepare(db, user, require_active_profile(db, user), get_config(db, user.id), job,
                    round(m.overall_score, 1) if m else 0.0, "company")


@router.get("/jobs/{job_id}/resume.pdf")
def resume_pdf(job_id: uuid.UUID, db: DB, user: ExtUser) -> FileResponse:
    job = get_owned_or_404(db, Job, job_id, user, "Job")
    rv = _latest(db, ResumeVersion, user, job.id)
    if rv is None:
        raise DomainError("No tailored resume for this job yet.", status_code=404)
    path = resolve_within(get_settings().generated_dir, rv.pdf_path)
    if not path.exists():
        raise DomainError("Resume file missing; regenerate it.", status_code=404)
    return FileResponse(path, media_type="application/pdf", filename=tailoring.download_name(rv, ".pdf"))


# --------------------------------------------------------------------------------------------- answers

class FieldIn(BaseModel):
    key: str = Field(max_length=300)  # the extension's own id for the field, echoed back
    label: str = Field(max_length=1000)
    type: str = Field(default="text", max_length=30)  # text|number|textarea|select|radio|checkbox|email|tel|url
    options: list[str] = Field(default_factory=list, max_length=200)
    required: bool = False


class AnswersIn(BaseModel):
    job_id: uuid.UUID
    fields: list[FieldIn] = Field(max_length=60)


_YEARS = re.compile(r"(?i)how many years|years of (work |professional |relevant )?experience|years.*experience")
_YES_NO_SKILL = re.compile(r"(?i)(do you have|have you (worked|used)|are you (familiar|proficient|comfortable|experienced)"
                           r" (?:with|in)|experience (?:with|in|using))\s+(?P<thing>.+?)\??$")


def _profile_skills(p: dict) -> set[str]:
    return {skill_key(s["name"]) for s in p.get("skills") or []}


# Broad areas recruiters ask about ("years in AIML", "Open API") → profile skills that count as experience in them.
_AREAS = [
    (re.compile(r"(?i)\b(ai\s*/?\s*ml|aiml|ai|ml|machine learning|artificial intelligence|deep learning|gen\s*ai|"
                r"generative ai|llms?|nlp|data science|agentic)\b"),
     ("generative ai", "large language models", "natural language processing", "machine learning", "llm training",
      "llm fine tuning", "deep learning")),
    (re.compile(r"(?i)\b(open\s*api|apis?|rest(ful)?|backend)\b"), ("rest apis", "node js", "express", "flask")),
    (re.compile(r"(?i)\b(mern|full\s*stack|web development)\b"), ("mern stack", "react", "node js")),
]


def _mentions(label: str, skills: set[str]) -> list[str]:
    hits = [m.group(0) for pat, wanted in _AREAS for m in [pat.search(label)]
            if m and any(skill_key(w) in skills for w in wanted)]
    return hits + _direct_mentions(label, skills)


def _direct_mentions(label: str, skills: set[str]) -> list[str]:
    words = re.findall(r"[a-z0-9+#.\-]+(?:\s[a-z0-9+#.\-]+)?", label.lower())
    found = []
    for w in words:
        for cand in (w, w.split(" ")[0]):
            if skill_key(cand) in skills:
                found.append(cand)
    return found


def _pick(options: list[str], wanted: str) -> str | None:
    if not options:
        return wanted
    for o in options:
        if o.strip().lower() == wanted.lower():
            return o
    for o in options:
        if o.strip().lower().startswith(wanted.lower()):
            return o
    return None


def _number_option(options: list[str], n: int) -> str | None:
    """Pick the option for n years from ranges like '0-1', '2-3 years', '5+'."""
    if not options:
        return str(n)
    for o in options:
        nums = [int(x) for x in re.findall(r"\d+", o)]
        if len(nums) >= 2 and nums[0] <= n <= nums[1]:
            return o
        if len(nums) == 1 and ("+" in o or "more" in o.lower()) and n >= nums[0]:
            return o
        if len(nums) == 1 and nums[0] == n:
            return o
    return None


def _derived_answer(f: FieldIn, p: dict, years: float | None) -> str | None:
    """Answers that follow directly from the verified profile: years of experience, 'do you know X' questions."""
    label = f.label.strip()
    skills = _profile_skills(p)
    if _YEARS.search(label) and years is not None:
        mentioned = _mentions(label, skills)
        asks_specific = bool(re.search(r"(?i)\b(with|in|using|of)\b\s+\w", label.split("experience")[-1]))
        if asks_specific and not mentioned:
            n = 0  # a skill not in the profile: truthful answer is no experience
        else:
            n = max(0, int(round(years)))
        return _number_option(f.options, n) if f.type in ("select", "radio") else str(n)
    m = _YES_NO_SKILL.search(label)
    if m and (f.type in ("select", "radio", "checkbox") or {o.lower() for o in f.options} >= {"yes", "no"}):
        has = bool(_mentions(m.group("thing"), skills))
        return _pick(f.options, "Yes" if has else "No")
    return None


def _notice_option(options: list[str], p: dict) -> str | None:
    """Map an 'Immediate' notice-period fact onto choice buttons like '15 days or less' / '0-15 days'."""
    facts = {normalize_label(k): str(v) for k, v in (p.get("application_facts") or {}).items()}
    val = facts.get("notice period", "")
    if not re.search(r"(?i)immediate|^0\b|none|no notice", val):
        return None
    for pat in (r"(?i)immediate", r"(?i)\b0\s*(days?)?\b", r"(?i)15 days or less|less than 15|0\s*-\s*15|within 15|upto 15|up to 15",
                r"(?i)serving notice", r"(?i)1 month or less|less than (a|1) month|0\s*-\s*30|within 30"):
        hit = next((o for o in options if re.search(pat, o)), None)
        if hit:
            return hit
    return None


@router.post("/answers")
def answers(body: AnswersIn, db: DB, user: ExtUser) -> dict:
    """Answer the fields of an application form. ``null`` = only the user can answer it."""
    job = get_owned_or_404(db, Job, body.job_id, user, "Job")
    profile = require_active_profile(db, user)
    cfg = get_config(db, user.id)
    p = profile_to_dict(profile)
    bank = {r.question_key: r.answer for r in db.scalars(select(ScreeningAnswer).where(ScreeningAnswer.user_id == user.id))}
    years = total_experience_years([type("E", (), {"start_date": e.get("start_date") or "",
                                                    "end_date": e.get("end_date") or "",
                                                    "is_current": bool(e.get("is_current"))})
                                    for e in p.get("experiences") or []])
    ftype = {"number": "text", "radio": "select", "checkbox": "select"}
    form = [FormField(name=f.key, label=f.label, type=ftype.get(f.type, f.type), required=f.required,
                      options=f.options) for f in body.fields]
    mapped, _missing = map_candidate_data(form, p, bank)
    out: dict[str, str | None] = {}
    free_text: list[FieldIn] = []
    for f in body.fields:
        v = (mapped.get(f.key) or {}).get("value")
        if not v:
            v = _derived_answer(f, p, years)
        if not v and f.options and re.search(r"(?i)notice|join|start", f.label):
            v = _notice_option(f.options, p)
        if not v and f.type == "textarea" or (not v and f.type == "text" and len(f.label) > 40):
            free_text.append(f)
            continue
        out[f.key] = v or None
    if free_text:
        text = "\n\n".join(f.label.rstrip("*").strip() + ("" if f.label.strip().endswith("?") else "?")
                           for f in free_text[:application_answers.MAX_QUESTIONS])
        drafted = application_answers.answer_questions(db, user, profile, job, text, use_llm=cfg.use_llm)
        for i, f in enumerate(free_text):
            a = drafted[i] if i < len(drafted) else None
            out[f.key] = a.answer if a and a.method != "needs_you" and a.answer.strip() else None
    db.commit()
    return {"answers": out}


class BankIn(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    answer: str = Field(min_length=1, max_length=5000)


@router.post("/answer-bank", status_code=204)
def save_answer(body: BankIn, db: DB, user: ExtUser) -> None:
    key = normalize_label(body.question)
    row = db.scalar(select(ScreeningAnswer).where(ScreeningAnswer.user_id == user.id, ScreeningAnswer.question_key == key))
    if row is None:
        db.add(ScreeningAnswer(user_id=user.id, question_key=key, question_text=body.question, answer=body.answer))
    else:
        row.answer, row.question_text = body.answer, body.question
    db.commit()


# ---------------------------------------------------------------------------------------------- result

class ResultIn(BaseModel):
    job_id: uuid.UUID
    outcome: Literal["submitted", "needs_you", "failed"]
    note: str = Field(default="", max_length=2000)
    missing: list[str] = Field(default_factory=list, max_length=60)
    # The employer's own application page, when the extension followed "Apply on company site" to it.
    apply_url: str = Field(default="", max_length=1000)


@router.post("/result")
def result(body: ResultIn, db: DB, user: ExtUser) -> dict:
    job = get_owned_or_404(db, Job, body.job_id, user, "Job")
    if body.apply_url.startswith(("https://", "http://")) and not job.official_url:
        job.official_url = job.application_url = body.apply_url
    app, _ = svc.get_or_create(db, user, job, actor="agent")
    if body.outcome == "submitted":
        if app.status not in svc.POST_SUBMISSION:
            app.submitted_at = datetime.now(UTC)
            app.submitted_by = "agent"
            app.mode = "authorized"
            app.confirmation_text = body.note[:2000]
            svc.event(db, app, "submitted", body.note or "Submitted by the JobPilot extension.", actor="agent",
                      to_status="submitted")
    elif body.outcome == "needs_you":
        app.missing_fields = [{"name": m, "label": m, "required": True} for m in body.missing]
        svc.event(db, app, "needs_input", body.note or "The extension needs your input to finish this one.",
                  actor="agent", to_status="needs_input", data={"missing": body.missing})
    else:
        svc.event(db, app, "automation_failed", body.note or "The extension could not finish this application.",
                  actor="agent")
    db.commit()
    return {"status": app.status}


@router.get("/needs-you")
def needs_you(db: DB, user: ExtUser) -> list[dict]:
    rows = db.execute(select(Application, Job).join(Job, Job.id == Application.job_id)
                      .where(Application.user_id == user.id, Application.status == "needs_input")
                      .order_by(Application.updated_at.desc()).limit(100)).all()
    return [{"job_id": str(j.id), "title": j.title, "company": j.company, "url": j.posting_url or j.application_url,
             "missing": [m.get("label") for m in a.missing_fields or []]} for a, j in rows]


# -------------------------------------------------------------------------------------------- outreach

class NoteIn(BaseModel):
    job_id: uuid.UUID
    person_name: str = Field(default="", max_length=200)
    person_title: str = Field(default="", max_length=300)


def _first(name: str) -> str:
    return (name or "").strip().split(" ")[0].title() if name else "there"


@router.post("/outreach-note")
def outreach_note(body: NoteIn, db: DB, user: ExtUser) -> dict:
    """A LinkedIn connection note (≤300 chars) built only from verified profile facts."""
    job = get_owned_or_404(db, Job, body.job_id, user, "Job")
    p = profile_to_dict(require_active_profile(db, user))
    skills = [s["name"] for s in p.get("skills") or []]
    jd = (job.description_text or "").lower()
    relevant = [s for s in skills if s.lower() in jd][:3] or skills[:3]
    who = p.get("headline") or (p.get("experiences") or [{}])[0].get("title") or "engineer"
    is_recruiter = bool(re.search(r"(?i)recruit|talent|hr\b|people|hiring", body.person_title))
    ask = ("Would love to be considered — happy to share more." if is_recruiter
           else "Would you be open to referring me or pointing me to the hiring manager?")
    skill_txt = f" ({', '.join(relevant)})" if relevant else ""
    note = (f"Hi {_first(body.person_name)}, I just applied for the {job.title} role at {job.company}. "
            f"I'm a {who}{skill_txt}. {ask} Thanks! — {_first(p.get('full_name', ''))}")
    if len(note) > 300:
        note = (f"Hi {_first(body.person_name)}, I just applied for {job.title} at {job.company}. "
                f"I'm a {who}{skill_txt}. {ask}")
    if len(note) > 300:
        note = f"Hi {_first(body.person_name)}, I just applied for {job.title} at {job.company}. {ask}"
    return {"note": note[:300]}


class OutreachLogIn(BaseModel):
    job_id: uuid.UUID
    person_name: str = Field(default="", max_length=200)
    person_title: str = Field(default="", max_length=300)
    profile_url: str = Field(default="", max_length=1000)
    note: str = Field(default="", max_length=400)


@router.post("/outreach-log", status_code=204)
def outreach_log(body: OutreachLogIn, db: DB, user: ExtUser) -> None:
    job = get_owned_or_404(db, Job, body.job_id, user, "Job")
    app, _ = svc.get_or_create(db, user, job, actor="agent")
    svc.event(db, app, "outreach_sent", f"Connection request sent to {body.person_name} ({body.person_title}).",
              actor="agent", data={"profile_url": body.profile_url, "note": body.note})
    db.commit()


# ----------------------------------------------------------------------------- company career-page queue

_ATS = re.compile(r"(?i)greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com")
_LINKEDIN_JOB = re.compile(r"(?i)^https://(www\.)?linkedin\.com/(comm/)?jobs/view/(\d+)")
_NAUKRI_JOB = re.compile(r"(?i)^https://(www\.)?naukri\.com/(jd/)?(job-listings-[^?#\s]+)")


def queue_step(job: Job) -> dict | None:
    """How the extension should apply to this job: on the company page, or via its LinkedIn/Naukri page
    (which follows "Apply on company site" when there's no in-site apply)."""
    official = job.official_url or ""
    if _ATS.search(official):
        return {"kind": "ats", "url": official}
    url = job.application_url or job.posting_url or ""
    if _ATS.search(url):
        return {"kind": "ats", "url": url}
    m = _LINKEDIN_JOB.match(url)
    if m:
        return {"kind": "linkedin-job", "url": f"https://www.linkedin.com/jobs/view/{m.group(3)}/"}
    m = _NAUKRI_JOB.match(url)
    if m:
        return {"kind": "naukri-job", "url": f"https://www.naukri.com/{m.group(3)}"}
    return None


@router.get("/queue")
def queue(db: DB, user: ExtUser, limit: int = 30) -> list[dict]:
    """Best unapplied jobs JobPilot already found and scored (company boards and job-alert emails), for the
    extension to apply to first."""
    from app.api.apply_queue import _queue_rows

    cfg = get_config(db, user.id)
    out = []
    for job, score, app in _queue_rows(db, user, cfg.min_match_score):
        if app is not None and app.status == "needs_input":
            continue
        step = queue_step(job)
        if step is None:
            continue
        out.append({"job_id": str(job.id), "title": job.title, "company": job.company, "score": round(score, 1), **step})
        if len(out) >= max(1, min(limit, 100)):
            break
    return out


# ------------------------------------------------------------------------------------------ activity log

_ext_log = __import__("logging").getLogger("jobpilot.extension")


class LogIn(BaseModel):
    lines: list[str] = Field(max_length=50)


@router.post("/log", status_code=204)
def ext_log(body: LogIn, user: ExtUser) -> None:
    """The extension mirrors its activity log here so it shows up in the server logs."""
    for line in body.lines:
        _ext_log.info("ext %s | %s", user.email, line[:500])
