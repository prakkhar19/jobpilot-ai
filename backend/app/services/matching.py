"""Explainable job–candidate matching.

The score is a weighted average of independent, individually explained components. Components whose
inputs are unknown (e.g. the profile has no education entries) are reported as *unknown* and excluded
from the average rather than counted as a failure — missing profile data is not evidence of a gap.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, date, datetime

from sqlalchemy.orm import Session

from app.models import AgentConfiguration, CandidateProfile, Job, JobMatch
from app.services.jd_analysis import JDAnalysis, analysis_from_job, analyze_job
from app.services.skills import extract_skills, skill_key

DEFAULT_WEIGHTS: dict[str, float] = {
    "required_skills": 0.35,
    "preferred_skills": 0.10,
    "semantic_similarity": 0.20,
    "experience": 0.15,
    "role_alignment": 0.10,
    "education": 0.05,
    "location": 0.05,
}
COMPONENT_LABELS = {
    "required_skills": "Required skills",
    "preferred_skills": "Preferred skills",
    "semantic_similarity": "Overall content similarity",
    "experience": "Experience level",
    "role_alignment": "Role / title alignment",
    "education": "Education",
    "location": "Location & work style",
}

# ---------------------------------------------------------------------------------- text similarity

_STOP = set(
    """a an the and or of to in for on with at by from as is are be been was were this that these those it its we you
    your our their they he she them us will would can could should may might must have has had do does did not no
    yes all any each every more most other some such than too very just also into over under about across per via
    using use used work working team teams role job company experience years year strong ability skills skill
    including include etc new well good great looking join help build building who what when where which how why
    within while both own based knowledge understanding plus preferred required requirements responsibilities""".split()
)


def tokenize(text: str) -> list[str]:
    toks = re.findall(r"[a-z][a-z0-9+#.\-]{1,30}", (text or "").lower())
    return [t.strip(".-") for t in toks if t.strip(".-") not in _STOP and len(t.strip(".-")) > 1]


class TfidfModel:
    def __init__(self, corpus: list[str]) -> None:
        df: Counter[str] = Counter()
        for doc in corpus:
            df.update(set(tokenize(doc)))
        self.n = max(len(corpus), 1)
        self.idf = {t: math.log((1 + self.n) / (1 + c)) + 1 for t, c in df.items()}

    def vector(self, text: str) -> dict[str, float]:
        tf = Counter(tokenize(text))
        default_idf = math.log(1 + self.n) + 1
        return {t: (1 + math.log(c)) * self.idf.get(t, default_idf) for t, c in tf.items()}

    @staticmethod
    def cosine(a: dict[str, float], b: dict[str, float]) -> float:
        if not a or not b:
            return 0.0
        dot = sum(v * b.get(t, 0.0) for t, v in a.items())
        na = math.sqrt(sum(v * v for v in a.values()))
        nb = math.sqrt(sum(v * v for v in b.values()))
        return dot / (na * nb) if na and nb else 0.0


def cosine_dense(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


# ---------------------------------------------------------------------------------- candidate facts

EDU_LEVEL_PATTERNS = [
    (4, re.compile(r"(?i)\b(ph\.?\s?d|doctor)")),
    (3, re.compile(r"(?i)\b(master|m\.?s\.?c?\b|m\.?tech|mba|m\.?e\.?\b|m\.?c\.?a)")),
    (2, re.compile(r"(?i)\b(bachelor|b\.?s\.?c?\b|b\.?tech|b\.?e\.?\b|b\.?a\.?\b|b\.?c\.?a|undergraduate)")),
    (1, re.compile(r"(?i)\b(associate|diploma)")),
]
EDU_LEVEL_NAMES = {0: "secondary", 1: "associate/diploma", 2: "bachelor's", 3: "master's", 4: "doctorate"}


@dataclass
class CandidateFacts:
    skills: dict[str, str] = field(default_factory=dict)  # key -> display name
    text: str = ""
    years: float | None = None
    education_level: int | None = None
    titles: list[str] = field(default_factory=list)
    location: str = ""


def _parse_ym(value: str, *, end: bool = False) -> date | None:
    v = (value or "").strip()
    m = re.fullmatch(r"(\d{4})-(\d{2})", v)
    if m:
        return date(int(m.group(1)), int(m.group(2)), 1)
    m = re.fullmatch(r"(\d{4})", v)
    if m:
        return date(int(m.group(1)), 12 if end else 1, 1)
    return None


def total_experience_years(experiences: list) -> float | None:
    intervals: list[tuple[date, date]] = []
    today = datetime.now(UTC).date()
    for e in experiences:
        start = _parse_ym(getattr(e, "start_date", "") or "")
        end = today if getattr(e, "is_current", False) else _parse_ym(getattr(e, "end_date", "") or "", end=True)
        if start and end and end >= start:
            intervals.append((start, min(end, today)))
    if not intervals:
        return None
    intervals.sort()
    merged = [intervals[0]]
    for s, e in intervals[1:]:
        if s <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))
    days = sum((e - s).days for s, e in merged)
    return round(days / 365.25, 1)


def candidate_facts(profile: CandidateProfile) -> CandidateFacts:
    f = CandidateFacts()
    for s in profile.skills:
        f.skills.setdefault(skill_key(s.name), s.name)
    parts = [profile.headline, profile.summary]
    for e in profile.experiences:
        parts += [e.title, e.company, *e.bullets, " ".join(e.technologies)]
        for t in e.technologies:
            f.skills.setdefault(skill_key(t), t)
        f.titles.append(e.title)
    for p in profile.projects:
        parts += [p.name, p.description, *p.bullets, " ".join(p.technologies)]
        for t in p.technologies:
            f.skills.setdefault(skill_key(t), t)
    for c in profile.certifications:
        parts.append(c.name)
    parts += list(profile.achievements or [])
    f.text = "\n".join(x for x in parts if x)
    # Skills evidenced in the verified experience/project text also count.
    for s in extract_skills(f.text):
        f.skills.setdefault(skill_key(s), s)
    f.years = total_experience_years(profile.experiences)
    levels = []
    for ed in profile.educations:
        for level, pat in EDU_LEVEL_PATTERNS:
            if pat.search(f"{ed.degree} {ed.field_of_study}"):
                levels.append(level)
                break
        else:
            if ed.degree or ed.institution:
                levels.append(0 if re.search(r"(?i)high school|secondary|class x", ed.degree) else -1)
    known = [lvl for lvl in levels if lvl >= 0]
    f.education_level = max(known) if known else None
    if profile.headline:
        f.titles.insert(0, profile.headline)
    f.location = profile.location
    return f


# ---------------------------------------------------------------------------------- scoring

@dataclass
class Component:
    key: str
    score: float | None  # 0..1, None = unknown
    weight: float
    applicable: bool = True
    detail: str = ""
    matched: list[str] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "key": self.key,
            "label": COMPONENT_LABELS.get(self.key, self.key),
            "score": None if self.score is None else round(self.score * 100, 1),
            "weight": round(self.weight, 3),
            "status": "not_applicable" if not self.applicable else ("unknown" if self.score is None else "scored"),
            "detail": self.detail,
            "matched": self.matched,
            "missing": self.missing,
        }


@dataclass
class MatchResult:
    overall: float
    components: list[Component]
    strengths: list[str]
    gaps: list[str]
    unknowns: list[str]
    recommendation: str
    confidence: float
    similarity_method: str


SENIORITY_YEARS = {"intern": (0, 1), "junior": (0, 2), "mid": (2, 5), "senior": (5, 30), "lead": (6, 30),
                   "staff": (8, 30), "principal": (10, 30)}

_TITLE_STOP = {"senior", "sr", "junior", "jr", "lead", "staff", "principal", "intern", "i", "ii", "iii", "iv",
               "remote", "hybrid", "the", "and", "of", "for", "-", "–", "level", "mid", "associate", "head", "new", "grad"}


def _title_tokens(t: str) -> set[str]:
    return {w for w in re.findall(r"[a-z+#.]+", (t or "").lower()) if w not in _TITLE_STOP and len(w) > 1}


def normalize_weights(custom: dict | None) -> dict[str, float]:
    w = dict(DEFAULT_WEIGHTS)
    for k, v in (custom or {}).items():
        if k in w:
            try:
                w[k] = max(0.0, float(v))
            except (TypeError, ValueError):
                continue
    total = sum(w.values()) or 1.0
    return {k: v / total for k, v in w.items()}


def _skill_component(key: str, wanted: list[str], facts: CandidateFacts, weight: float) -> Component:
    if not wanted:
        return Component(key, None, weight, applicable=False, detail="The posting does not list these.")
    matched = [s for s in wanted if skill_key(s) in facts.skills]
    missing = [s for s in wanted if skill_key(s) not in facts.skills]
    score = len(matched) / len(wanted)
    detail = f"{len(matched)} of {len(wanted)} found in your profile."
    return Component(key, score, weight, detail=detail, matched=matched, missing=missing)


def score_match(
    job: Job,
    analysis: JDAnalysis,
    facts: CandidateFacts,
    *,
    weights: dict[str, float],
    prefs: AgentConfiguration | None = None,
    tfidf: TfidfModel | None = None,
    embedding_similarity: float | None = None,
) -> MatchResult:
    comps: list[Component] = []

    required = analysis.required_skills + analysis.mentioned_skills
    req = _skill_component("required_skills", required, facts, weights["required_skills"])
    mandatory_missing = [s for s in req.missing if s in analysis.required_skills]
    comps.append(req)
    comps.append(_skill_component("preferred_skills", analysis.preferred_skills, facts, weights["preferred_skills"]))

    # Semantic similarity
    if embedding_similarity is not None:
        sim = max(0.0, min(1.0, (embedding_similarity - 0.45) / 0.4))
        method = "embeddings"
        detail = f"Embedding cosine similarity {embedding_similarity:.2f}."
    else:
        model = tfidf or TfidfModel([job.description_text, facts.text])
        raw = TfidfModel.cosine(model.vector(f"{job.title}\n{job.description_text}"), model.vector(facts.text))
        sim = max(0.0, min(1.0, raw / 0.30))
        method = "tfidf"
        detail = f"Keyword-weighted (TF-IDF) similarity {raw:.2f}."
    comps.append(Component("semantic_similarity", sim if facts.text.strip() else None, weights["semantic_similarity"], detail=detail))

    # Experience
    exp = Component("experience", None, weights["experience"])
    lo_hi = SENIORITY_YEARS.get(analysis.seniority or job.seniority or "")
    needed = analysis.min_years if analysis.min_years is not None else (lo_hi[0] if lo_hi else None)
    if needed is None:
        exp.applicable = False
        exp.detail = "No experience requirement stated."
    elif facts.years is None:
        exp.detail = f"Requires ~{needed:g} years; your profile has no dated experience, so this is unknown."
    else:
        exp.score = 1.0 if facts.years >= needed else max(0.0, facts.years / needed) if needed else 1.0
        exp.detail = f"Requires {needed:g}+ years; your profile shows about {facts.years:g} years."
        if lo_hi and analysis.seniority in ("intern", "junior") and facts.years > lo_hi[1] + 3:
            exp.score = 0.7
            exp.detail += " You may be over-qualified for this level."
    comps.append(exp)

    # Role alignment
    jt = _title_tokens(job.title)
    targets = list(facts.titles) + list((prefs.target_roles if prefs else []) or [])
    if not jt:
        role = Component("role_alignment", None, weights["role_alignment"], applicable=False, detail="No job title.")
    elif not targets:
        role = Component("role_alignment", None, weights["role_alignment"], detail="No titles or target roles in your profile.")
    else:
        best, best_t = 0.0, ""
        for t in targets:
            tt = _title_tokens(t)
            if tt:
                ov = len(jt & tt) / len(jt)
                if ov > best:
                    best, best_t = ov, t
        role = Component("role_alignment", best, weights["role_alignment"],
                         detail=f"Closest match: '{best_t}'." if best_t else "No similar titles found.")
    comps.append(role)

    # Education
    edu = Component("education", None, weights["education"])
    if analysis.education_level is None:
        edu.applicable = False
        edu.detail = "No education requirement stated."
    elif facts.education_level is None:
        edu.detail = f"Asks for a {EDU_LEVEL_NAMES[analysis.education_level]} degree; your profile has no education entries."
    else:
        ok = facts.education_level >= analysis.education_level
        edu.score = 1.0 if ok else (0.6 if not analysis.education_mandatory else 0.3)
        edu.detail = (
            f"Asks for {EDU_LEVEL_NAMES[analysis.education_level]}; your highest is "
            f"{EDU_LEVEL_NAMES.get(facts.education_level, 'unknown')}."
            + ("" if ok or analysis.education_mandatory else " Equivalent experience is accepted.")
        )
    comps.append(edu)

    # Location / work style
    loc = Component("location", None, weights["location"])
    wanted_locs = [x.lower() for x in (prefs.locations if prefs else []) or [] if x]
    wanted_types = [x.lower() for x in (prefs.workplace_types if prefs else []) or [] if x]
    if not wanted_locs and not wanted_types:
        loc.applicable = False
        loc.detail = "No location preferences set."
    else:
        jl = (job.location or "").lower()
        wt = job.workplace_type
        type_ok = not wanted_types or wt in wanted_types or wt == "unknown"
        loc_ok = not wanted_locs or any(w in jl for w in wanted_locs) or (wt == "remote" and "remote" in wanted_types)
        loc.score = 1.0 if (type_ok and loc_ok) else (0.5 if (type_ok or loc_ok) else 0.0)
        loc.detail = f"Job: {job.location or 'location not stated'} ({wt})."
    comps.append(loc)

    known = [c for c in comps if c.applicable and c.score is not None]
    weight_known = sum(c.weight for c in known)
    weight_applicable = sum(c.weight for c in comps if c.applicable)
    overall = (sum(c.weight * c.score for c in known) / weight_known * 100) if weight_known else 0.0
    confidence = weight_known / weight_applicable if weight_applicable else 0.0

    strengths: list[str] = []
    gaps: list[str] = []
    unknowns: list[str] = []
    if req.applicable and req.matched:
        strengths.append(f"Matches {len(req.matched)}/{len(required)} listed skills: {', '.join(req.matched[:8])}.")
    pref_c = comps[1]
    if pref_c.applicable and pref_c.matched:
        strengths.append(f"Has preferred skills: {', '.join(pref_c.matched[:6])}.")
    if mandatory_missing:
        gaps.append(f"Required skills not found in your profile: {', '.join(mandatory_missing[:8])}.")
    other_missing = [s for s in req.missing if s not in mandatory_missing]
    if other_missing:
        gaps.append(f"Mentioned skills not found in your profile: {', '.join(other_missing[:8])}.")
    if pref_c.applicable and pref_c.missing:
        gaps.append(f"Preferred (optional) skills not in your profile: {', '.join(pref_c.missing[:6])}.")
    if exp.score is not None:
        (strengths if exp.score >= 1 else gaps).append(exp.detail)
    if edu.score is not None and edu.score < 1:
        gaps.append(edu.detail)
    elif edu.score is not None:
        strengths.append(edu.detail)
    if role.score is not None and role.score >= 0.6:
        strengths.append(f"Your background aligns with the '{job.title}' title. {role.detail}")
    for c in comps:
        if c.applicable and c.score is None:
            unknowns.append(f"{COMPONENT_LABELS[c.key]}: {c.detail}")
    if gaps:
        gaps.append("If you do have any of these, add them to your profile — missing data is not treated as a lack of skill.")

    if overall >= 75:
        rec = "strong_match"
    elif overall >= 60:
        rec = "good_match"
    elif overall >= 45:
        rec = "consider"
    else:
        rec = "weak_match"
    if analysis.required_skills and len(mandatory_missing) / len(analysis.required_skills) > 0.6 and rec in ("strong_match", "good_match"):
        rec = "consider"
    return MatchResult(round(overall, 1), comps, strengths, gaps, unknowns, rec, round(confidence, 2), method)


RECOMMENDATION_TEXT = {
    "strong_match": "Strong match — worth applying.",
    "good_match": "Good match — consider applying.",
    "consider": "Partial match — review the gaps before applying.",
    "weak_match": "Weak match — probably not worth applying.",
}


def compute_and_store(
    db: Session,
    job: Job,
    profile: CandidateProfile,
    *,
    prefs: AgentConfiguration | None,
    facts: CandidateFacts | None = None,
    tfidf: TfidfModel | None = None,
    embedding_similarity: float | None = None,
) -> JobMatch:
    if job.analyzed_at is None or not job.requirements:
        analysis = analyze_job(db, job)
    else:
        analysis = analysis_from_job(job)
    facts = facts or candidate_facts(profile)
    weights = normalize_weights(prefs.matching_weights if prefs else None)
    result = score_match(job, analysis, facts, weights=weights, prefs=prefs, tfidf=tfidf,
                         embedding_similarity=embedding_similarity)
    match = db.query(JobMatch).filter(JobMatch.user_id == job.user_id, JobMatch.job_id == job.id).one_or_none()
    if match is None:
        match = JobMatch(user_id=job.user_id, job_id=job.id)
        db.add(match)
    match.profile_id = profile.id
    match.profile_version = profile.version
    match.overall_score = result.overall
    match.components = [c.as_dict() for c in result.components] + [{"key": "_confidence", "value": result.confidence}]
    match.strengths = result.strengths
    match.gaps = result.gaps
    match.unknowns = result.unknowns
    match.recommendation = result.recommendation
    match.weights = weights
    match.similarity_method = result.similarity_method
    match.computed_at = datetime.now(UTC)
    return match
