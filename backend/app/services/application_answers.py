"""Answers to the free-text questions on job application forms ("Why this role?", "Relevant experience").

Answers use only facts from the user's approved profile plus the job posting. With an AI provider the answers are
written by the model and fact-checked sentence by sentence; without one (or if checking strips too much) they are
assembled from the profile. Questions only the candidate can answer (salary, notice period, relocation...) are
flagged instead of guessed.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.adapters.llm.base import LLMError, untrusted
from app.models import CandidateProfile, Job, User
from app.services.cover_letters import _best, _facts_block, _strip_unverified
from app.services.factcheck import build_fact_base
from app.services.jd_analysis import analysis_from_job, analyze_job
from app.services.llm_service import get_runner
from app.services.matching import TfidfModel, total_experience_years
from app.services.profiles import profile_to_dict
from app.services.skills import skill_key

MAX_QUESTIONS = 10
MAX_INPUT_CHARS = 6000

_PERSONAL = re.compile(
    r"(?i)\b(salary|ctc|compensation|pay|notice period|join(ing)? date|start date|when can you (join|start)|relocat\w*|"
    r"visa|sponsorship|work permit|authori[sz]ed to work|gender|age|date of birth|dob|disab\w*|veteran|"
    r"phone|mobile|address|linkedin url|github url|portfolio url|current location|expected)\b"
)
_WHY = re.compile(r"(?i)\b(why|interest\w*|motivat\w*|draws you|excite\w*|attract\w*|contribute|first (few|90|30)|"
                  r"cover letter|fit for)\b")
_EXPERIENCE = re.compile(r"(?i)\b(experience|background|tell (us|me) about yourself|about you|introduce|"
                         r"roles?|tenure|worked)\b")
_PROJECT = re.compile(r"(?i)\b(project|built|achievement|proud|challenge|problem you solved|example)\b")
_SKILLS = re.compile(r"(?i)\b(skills?|tech(nology|nical)? stack|tools|strength|proficien\w*|languages?)\b")

_SYSTEM = """You answer the free-text questions on a job application form, in the candidate's own voice
(first person, plain professional English, 60-150 words per answer, no headings, no bullet points, no placeholders).
STRICT RULES:
- Use ONLY the candidate facts provided. Never invent experience, skills, numbers, employers, degrees, certifications,
  or knowledge of the company beyond what the job posting says.
- Do not claim a skill the job asks for unless it is in the candidate facts.
- If a question needs information that is not in the facts (salary, notice period, relocation, personal details),
  answer with exactly: NEEDS_YOU
Return ONLY a JSON array of strings, one answer per question, in the same order."""


@dataclass
class Answer:
    question: str
    answer: str
    method: str  # "llm+factcheck" | "template" | "needs_you"
    note: str = ""
    removed: list[str] = field(default_factory=list)


def split_questions(text: str) -> list[str]:
    """Split pasted form text into questions. A question starts after a blank line or on a line ending in '?'
    or '*' (required-field marker); the lines that follow (the form's hint text) stay attached to it."""
    blocks: list[list[str]] = []
    new_block = True
    for raw in (text or "")[:MAX_INPUT_CHARS].splitlines():
        line = raw.strip()
        if not line:
            new_block = True
            continue
        if new_block or not blocks or _is_question(line):
            blocks.append([line])
        else:
            blocks[-1].append(line)
        new_block = False
    out = [" ".join(b).strip() for b in blocks if b]
    return [q for q in out if len(q) > 2][:MAX_QUESTIONS]


def _is_question(line: str) -> bool:
    return line.rstrip(" *").endswith("?") or line.endswith("*")


def _sentences_from(bullet: str) -> str:
    b = bullet.strip().rstrip(".")
    return b[0].lower() + b[1:] if b else ""


def template_answer(p: dict, job: Job, question: str) -> Answer:
    if _PERSONAL.search(question) and not _EXPERIENCE.search(question.split("?")[0]):
        return Answer(question, "", "needs_you", "Only you can answer this one (personal details, salary, dates...).")
    a = analysis_from_job(job)
    jd_skills = {skill_key(s) for s in a.required_skills + a.mentioned_skills + a.preferred_skills}
    text_for_terms = f"{job.title}\n{job.description_text}\n{question}"
    vec = TfidfModel([text_for_terms]).vector(text_for_terms)
    jd_terms = {t for t, _ in sorted(vec.items(), key=lambda kv: -kv[1])[:40]}
    skills = [s["name"] for s in p.get("skills") or []]
    matched = [s for s in skills if skill_key(s) in jd_skills][:5] or _skills_for_title(skills, job.title)[:5]
    jd_skills = jd_skills or {skill_key(s) for s in matched}
    exps = p.get("experiences") or []
    projects = p.get("projects") or []
    years = total_experience_years([_Exp(e) for e in exps])

    def experience() -> str:
        parts = []
        if years is not None and years > 0:
            parts.append(f"I have about {_years_text(years)} of professional experience.")
        for i, e in enumerate(exps[:2]):
            when = "Currently I work" if e.get("is_current") else ("Before that, I worked" if i else "I worked")
            line = f"{when} as {_a(e['title'])} at {e['company']}"
            best = _best(e.get("bullets") or [], jd_terms, jd_skills)
            parts.append(f"{line}, where I {_sentences_from(best)}." if best else f"{line}.")
        if projects:
            pr = max(projects, key=lambda x: len({skill_key(t) for t in x.get("technologies") or []} & jd_skills))
            desc = (pr.get("description") or "").strip().rstrip(".")
            if desc:
                parts.append(f"I also built {pr['name']}, {desc[0].lower() + desc[1:]}.")
        eds = p.get("educations") or []
        if eds and eds[0].get("degree"):
            ed = eds[0]
            parts.append(f"I hold a {ed['degree']} in {ed.get('field_of_study') or 'my field'} from {ed.get('institution')}."
                         if ed.get("institution") else "")
        return " ".join(x for x in parts if x)

    def why() -> str:
        parts = [f"The {job.title} role at {job.company} matches the work I enjoy most and the skills I use every day"
                 + (f", especially {_join(matched[:3])}." if matched else ".")]
        if exps:
            e = exps[0]
            best = _best(e.get("bullets") or [], jd_terms, jd_skills)
            if best:
                parts.append(f"As {_a(e['title'])} at {e['company']}, I {_sentences_from(best)}.")
        if p.get("motivation"):
            parts.append(p["motivation"].strip())
        parts.append("In my first few months I would learn the codebase and the team's way of working quickly, take "
                     "ownership of well-scoped features and fixes, and ship reliable, well-tested work.")
        return " ".join(parts)

    def project() -> str:
        if not projects:
            return experience()
        pr = max(projects, key=lambda x: len({skill_key(t) for t in x.get("technologies") or []} & jd_skills)
                 + len(set((x.get("description") or "").lower().split()) & jd_terms))
        bullets = pr.get("bullets") or []
        parts = [f"One project I'm proud of is {pr['name']}"
                 + (f": {_sentences_from(pr['description'])}." if pr.get("description") else ".")]
        desc_key = _sentences_from(pr.get("description") or "").lower()
        parts += [f"I {_sentences_from(b)}." for b in bullets[:3]
                  if b.strip() and desc_key not in _sentences_from(b).lower()][:2]
        return " ".join(parts)

    def skills_answer() -> str:
        parts = [f"My core skills are {_join(matched)}."]
        if exps:
            e = exps[0]
            best = _best(e.get("bullets") or [], jd_terms, jd_skills)
            if best:
                parts.append(f"At {e['company']} I {_sentences_from(best)}.")
        return " ".join(parts)

    head = question.split("?")[0] if "?" in question else question
    if _WHY.search(head):
        text = why()
    elif _PROJECT.search(head):
        text = project()
    elif _SKILLS.search(head) and not _EXPERIENCE.search(head):
        text = skills_answer()
    else:
        text = experience()
    if not text.strip():
        text = (p.get("summary") or "").strip()
    return Answer(question, text, "template")


_TITLE_GROUPS = [
    (re.compile(r"(?i)\b(ai|ml|llm|genai|gen ai|machine learning|data scien\w*|nlp|artificial intelligence)\b"),
     ("python", "generative ai", "large language models", "llm", "natural language processing", "flask")),
    (re.compile(r"(?i)\b(front[- ]?end|react|ui)\b"), ("react", "javascript", "rest apis", "firebase", "vercel")),
    (re.compile(r"(?i)\b(back[- ]?end|node|api|python)\b"),
     ("node.js", "express", "python", "rest apis", "mongodb", "docker")),
    (re.compile(r"(?i)\b(devops|cloud|sre|platform)\b"), ("docker", "linux", "git", "railway", "vercel")),
    (re.compile(r"(?i)\b(full[- ]?stack|mern|web|software|developer|engineer|sde)\b"),
     ("react", "node.js", "express", "mongodb", "javascript", "python", "rest apis")),
]


def _skills_for_title(skills: list[str], title: str) -> list[str]:
    """When the posting text is too short to name skills, pick the profile skills that fit the job title."""
    for pattern, wanted in _TITLE_GROUPS:
        if pattern.search(title or ""):
            picked = [s for w in wanted for s in skills if s.lower() == w or s.lower().startswith(w)]
            if picked:
                return list(dict.fromkeys(picked))
    return skills


def _a(noun: str) -> str:
    """'a' or 'an': by sound, so 'an SDE Intern', 'an AI Engineer', 'a Software Engineer'."""
    word = (noun or "").split(" ")[0]
    vowel_sound = word[:1].lower() in "aeiou" or (word.isupper() and word[:1] in "AEFHILMNORSX")
    return f"{'an' if vowel_sound else 'a'} {noun}"


class _Exp:
    """Adapter so total_experience_years can read profile dicts."""

    def __init__(self, d: dict) -> None:
        self.start_date = d.get("start_date") or ""
        self.end_date = d.get("end_date") or ""
        self.is_current = bool(d.get("is_current"))


def _years_text(y: float) -> str:
    if y < 1.25:
        return "1 year"
    return f"{round(y * 2) / 2:g} years"


def _join(items: list[str]) -> str:
    items = [i for i in items if i]
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def answer_questions(db: Session, user: User, profile: CandidateProfile, job: Job, text: str, *,
                     use_llm: bool = True) -> list[Answer]:
    questions = split_questions(text)
    if not questions:
        return []
    if job.analyzed_at is None or not job.requirements:
        analyze_job(db, job)
    p = profile_to_dict(profile)
    answers = [template_answer(p, job, q) for q in questions]
    runner = get_runner(db, user) if use_llm else None
    if runner is None:
        return answers
    numbered = "\n".join(f"{i + 1}. {q}" for i, q in enumerate(questions))
    prompt = (f"Candidate facts (the ONLY facts you may use):\n{_facts_block(p)}\n\n"
              f"Job: {job.title} at {job.company}\n{untrusted('job_posting', job.description_text, 6000)}\n\n"
              f"Questions:\n{untrusted('form_questions', numbered, 4000)}")
    try:
        result = runner.complete(_SYSTEM, prompt, max_tokens=2500)
        raw = json.loads(re.search(r"\[.*\]", result.text, re.S).group(0))  # type: ignore[union-attr]
    except (LLMError, AttributeError, ValueError) as exc:
        for a in answers:
            a.note = a.note or f"AI unavailable ({str(exc)[:80]}); answered from your profile."
        return answers
    facts = build_fact_base(p, extra_texts=[job.company, job.title, job.description_text])
    for i, a in enumerate(answers):
        if a.method == "needs_you" or i >= len(raw) or not isinstance(raw[i], str):
            continue
        if raw[i].strip() == "NEEDS_YOU":
            answers[i] = Answer(a.question, "", "needs_you", "Only you can answer this one.")
            continue
        checked, removed = _strip_unverified(raw[i].strip(), facts, job)
        if len(checked) >= 0.6 * len(raw[i].strip()) and len(checked) > 40:
            answers[i] = Answer(a.question, checked, "llm+factcheck", removed=removed)
        else:
            a.note = "The AI answer failed fact-checking; this one is built from your profile."
    return answers
