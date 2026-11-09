"""Factual-consistency checking for generated text.

Every piece of AI-generated resume or cover-letter text is compared against the verified profile:

* **Skills** — any technology/skill mentioned must exist in the profile.
* **Numbers** — any number (metrics, percentages, years, counts) must appear in the source text the rewrite
  was based on (or anywhere in the profile, for summaries/letters).
* **Credentials** — degree and certification claims must exist in the profile.
* **Organisations / proper nouns** — capitalised terms that appear nowhere in the profile (or the job
  posting, for cover letters that name the employer) are flagged as unverified.

Text that fails is rejected and the original (verified) text is used instead.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.services.skills import extract_skills, skill_key

_NUM_RE = re.compile(r"(?<![A-Za-z])(\d+(?:[.,]\d+)?)\s*(%|x|k|m|b|\+)?", re.IGNORECASE)
_CRED_RE = re.compile(
    r"(?i)\b(ph\.?\s?d|doctorate|master'?s|m\.?sc|mba|bachelor'?s|b\.?sc|certified|certification|certificate|"
    r"licensed|award(?:ed)?|patent(?:ed)?|published|publication)\b"
)
_COMMON = set(
    """I A An The And Or But For With In On At To Of By As From Into Over Under Led Built Designed Developed Created
    Implemented Improved Reduced Increased Delivered Managed Owned Drove Launched Optimized Optimised Collaborated
    Worked Partnered Mentored Automated Architected Engineered Shipped Maintained Migrated Established Spearheaded
    Streamlined Enhanced Contributed Analyzed Analysed Deployed Integrated Wrote Researched Trained Scaled Supported
    Coordinated Conducted Defined Directed Facilitated Ran Using Used Through Across This That These Those My Our
    Your Their We You He She They It Its Dear Hiring Manager Sincerely Regards Best Thank Thanks Hello Hi Team
    Experience Experienced Skilled Proven Strong Results Passionate Motivated Seeking Looking Excited Eager Engineer
    Developer Software Senior Junior Lead Staff Principal Data Machine Learning Backend Frontend Full Stack Cloud
    Platform Product Services Service Systems System Applications Application Summary Professional Highlights
    Responsible Responsibilities Key Core Technical Skills Projects Project Education Work Additional Currently
    Previously Also Additionally Furthermore Moreover However Overall Today Over Within Both Each Every All Most
    January February March April May June July August September October November December Present Remote
    AI ML API APIs UI UX QA CI CD SaaS B2B B2C KPI KPIs OKR OKRs SLA SLAs ETL ELT REST JSON SQL NoSQL""".split()
)


@dataclass
class FactBase:
    skills: set[str] = field(default_factory=set)
    numbers: set[str] = field(default_factory=set)
    text_norm: str = ""
    credential_text: str = ""

    def has_term(self, term: str) -> bool:
        t = re.sub(r"[^a-z0-9+#]+", " ", term.lower()).strip()
        return bool(t) and f" {t} " in f" {self.text_norm} "


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9+#]+", " ", text.lower()).strip()


def numbers_in(text: str) -> set[str]:
    out = set()
    for m in _NUM_RE.finditer(text or ""):
        n = m.group(1).replace(",", "")
        n = n.rstrip("0").rstrip(".") if "." in n else n
        out.add(n)
    return out


def build_fact_base(profile_data: dict, extra_texts: list[str] | None = None) -> FactBase:
    """``profile_data`` is the dict produced by profiles.profile_to_dict."""
    texts: list[str] = []
    for k in ("full_name", "headline", "summary", "location", "motivation"):
        texts.append(str(profile_data.get(k) or ""))
    texts += list(profile_data.get("achievements") or []) + list(profile_data.get("publications") or [])
    texts += [f"{k} {v}" for k, v in (profile_data.get("application_facts") or {}).items()]
    cred: list[str] = []
    for e in profile_data.get("experiences") or []:
        texts += [e.get("company", ""), e.get("title", ""), e.get("location", ""), *e.get("bullets", []),
                  *e.get("technologies", []), e.get("start_date", ""), e.get("end_date", "")]
    for p in profile_data.get("projects") or []:
        texts += [p.get("name", ""), p.get("description", ""), *p.get("bullets", []), *p.get("technologies", [])]
    for ed in profile_data.get("educations") or []:
        piece = " ".join(str(ed.get(k, "")) for k in ("institution", "degree", "field_of_study", "grade", "details",
                                                      "start_date", "end_date"))
        texts.append(piece)
        cred.append(piece)
    for c in profile_data.get("certifications") or []:
        piece = " ".join(str(c.get(k, "")) for k in ("name", "issuer", "issue_date"))
        texts.append(piece)
        cred.append(piece)
    cred += list(profile_data.get("achievements") or []) + list(profile_data.get("publications") or [])
    full = "\n".join(t for t in texts if t)
    fb = FactBase()
    fb.skills = {skill_key(s.get("name", "")) for s in profile_data.get("skills") or []}
    fb.skills |= {skill_key(s) for s in extract_skills(full)}
    fb.numbers = numbers_in(full)
    extra = "\n".join(extra_texts or [])
    fb.text_norm = _norm(full + "\n" + extra)
    fb.credential_text = _norm("\n".join(cred))
    return fb


@dataclass
class CheckResult:
    ok: bool
    violations: list[str]


def check_text(text: str, facts: FactBase, *, source_text: str | None = None) -> CheckResult:
    """Validate generated ``text``. If ``source_text`` is given (a rewrite of a specific bullet), numbers must
    come from that source; otherwise from anywhere in the profile."""
    v: list[str] = []
    for s in extract_skills(text):
        if skill_key(s) not in facts.skills:
            v.append(f"mentions '{s}', which is not in your profile")
    allowed_numbers = numbers_in(source_text) if source_text is not None else facts.numbers
    allowed_numbers = allowed_numbers | (facts.numbers if source_text is None else set())
    for n in numbers_in(text) - allowed_numbers:
        if source_text is not None and n in facts.numbers and len(n) == 4:  # a year from the same profile
            continue
        v.append(f"introduces the number '{n}' that is not in the original")
    for m in _CRED_RE.finditer(text):
        window = _norm(text[max(0, m.start() - 40): m.end() + 60])
        word = _norm(m.group(0))
        if word and word not in facts.credential_text and word not in (_norm(source_text or "")):
            v.append(f"makes a credential claim ('{m.group(0)}') not supported by your profile")
            break
        _ = window
    # Proper nouns not found anywhere in the profile
    for sentence in re.split(r"(?<=[.!?;:])\s+|\n", text):
        words = re.findall(r"\b[A-Z][A-Za-z0-9&.\-]{1,}\b", sentence)
        for i, w in enumerate(words):
            if (sentence.strip().startswith(w) and i == 0) or w in _COMMON or w.rstrip(".") in _COMMON:
                continue
            if not facts.has_term(w.rstrip(".")) and not (source_text and w.lower() in source_text.lower()):
                v.append(f"names '{w}', which does not appear in your profile")
    # de-duplicate, keep order
    seen: set[str] = set()
    uniq = [x for x in v if not (x in seen or seen.add(x))]
    return CheckResult(not uniq, uniq)
