"""Rule-based resume parser.

Turns extracted resume text into a structured *draft* profile. It is deliberately conservative: it only
copies text that is present in the resume, never infers qualifications, and reports what it could not
find as warnings so the user can complete the profile during review.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.services.skills import canonicalize, category_of, extract_skills

SECTION_ALIASES: dict[str, list[str]] = {
    "summary": ["summary", "professional summary", "profile", "about me", "about", "objective",
                "career objective", "professional profile", "career summary"],
    "experience": ["experience", "work experience", "professional experience", "employment",
                   "employment history", "work history", "career history", "internships", "internship",
                   "relevant experience"],
    "education": ["education", "academic background", "academics", "educational qualifications",
                  "education and training", "academic qualifications"],
    "skills": ["skills", "technical skills", "core skills", "key skills", "technologies", "tech stack",
               "skills and tools", "technical proficiencies", "core competencies", "tools and technologies",
               "skills & tools", "technical skills & tools"],
    "projects": ["projects", "personal projects", "academic projects", "key projects", "selected projects",
                 "side projects", "project experience"],
    "certifications": ["certifications", "certificates", "licenses and certifications", "courses",
                       "certifications and courses", "licenses & certifications"],
    "achievements": ["achievements", "awards", "honors", "honours", "awards and achievements",
                     "accomplishments", "awards & achievements", "honors and awards"],
    "publications": ["publications", "research", "papers", "research publications"],
    "languages": ["languages", "spoken languages", "language proficiency"],
    "other": ["interests", "hobbies", "volunteering", "volunteer experience", "extracurricular activities",
              "references", "positions of responsibility", "leadership"],
}
_HEADING_LOOKUP = {alias: key for key, aliases in SECTION_ALIASES.items() for alias in aliases}

MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3, "apr": 4, "april": 4, "may": 5,
    "jun": 6, "june": 6, "jul": 7, "july": 7, "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10, "nov": 11, "november": 11, "dec": 12, "december": 12,
}
_MONTH_RE = r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
_DATE_RE = rf"(?:{_MONTH_RE}\.?\s*,?\s*\d{{4}}|\d{{1,2}}[/.\-]\d{{4}}|\d{{4}}[/.\-]\d{{1,2}}|\d{{4}})"
_PRESENT_RE = r"(?:present|current|now|till date|to date|ongoing)"
DATE_RANGE_RE = re.compile(
    rf"(?P<start>{_DATE_RE})\s*(?:-|–|—|to|until|till|→)\s*(?P<end>{_DATE_RE}|{_PRESENT_RE})", re.IGNORECASE
)
SINGLE_DATE_RE = re.compile(rf"(?:expected\s+)?(?P<date>{_DATE_RE})", re.IGNORECASE)

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(r"(?:(?<=\s)|^|(?<=[|:]))(\+?\d[\d\s().\-]{7,}\d)")
URL_RE = re.compile(r"(?:https?://)?(?:www\.)?[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+(?:/[^\s|,;]*)?")
LINKEDIN_RE = re.compile(r"(?:https?://)?(?:[a-z]{2,3}\.)?linkedin\.com/in/[A-Za-z0-9_\-%]+/?", re.IGNORECASE)
GITHUB_RE = re.compile(r"(?:https?://)?(?:www\.)?github\.com/[A-Za-z0-9_\-]+/?", re.IGNORECASE)
BULLET_RE = re.compile(r"^\s*(?:[•●▪◦‣∙·○■□➢➤►\-–—*]|\d+[.)])\s+")

TITLE_WORDS = re.compile(
    r"(?i)\b(engineer|developer|intern|internship|manager|analyst|scientist|lead|consultant|architect|designer|"
    r"researcher|associate|specialist|administrator|officer|director|head|vp|president|founder|co-founder|"
    r"programmer|technician|assistant|fellow|trainee|contractor|freelancer|sde|swe|devops|tester|qa|"
    r"executive|coordinator|instructor|teacher|professor|student)\b"
)
DEGREE_RE = re.compile(
    r"(?i)\b(b\.?\s?tech|b\.?\s?e\.?|b\.?\s?s\.?c?|b\.?a\.?|bachelor[a-z']*|m\.?\s?tech|m\.?\s?e\.?|m\.?\s?s\.?c?|"
    r"master[a-z']*|mba|m\.?c\.?a|b\.?c\.?a|ph\.?\s?d|doctor(?:ate)?|diploma|associate(?:'s)? degree|"
    r"high school|secondary|higher secondary|hsc|ssc|class xii|class x|a-levels|gcse)\b"
)
INSTITUTION_RE = re.compile(
    r"(?i)\b(university|college|institute|school|academy|polytechnic|iit|nit|iiit|bits|mit|vidyalaya|"
    r"universit[äa]t|école|ecole)\b"
)
GRADE_RE = re.compile(r"(?i)\b(?:c?gpa|grade|percentage|score)\s*[:\-]?\s*([\d.]+\s*(?:/\s*[\d.]+)?\s*%?)|(\d{2}(?:\.\d+)?\s*%)")
LOCATION_RE = re.compile(r"^[A-Z][A-Za-z.' \-]+,\s*[A-Z][A-Za-z.' \-]+(?:,\s*[A-Z][A-Za-z.' \-]+)?$")


@dataclass
class ParsedResume:
    data: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


def normalize_date(value: str) -> str:
    """Normalise a date token to 'YYYY-MM' or 'YYYY'. Returns '' if unparseable; 'present' for ongoing."""
    v = (value or "").strip().lower().rstrip(".")
    if not v:
        return ""
    if re.fullmatch(_PRESENT_RE, v):
        return "present"
    m = re.match(rf"({_MONTH_RE})\.?\s*,?\s*(\d{{4}})", v)
    if m:
        month = MONTHS.get(m.group(1)[:4].rstrip("t") if m.group(1).startswith("sept") else m.group(1)[:3], 0)
        month = month or MONTHS.get(m.group(1), 0)
        return f"{m.group(2)}-{month:02d}" if month else m.group(2)
    m = re.match(r"(\d{1,2})[/.\-](\d{4})", v)
    if m and 1 <= int(m.group(1)) <= 12:
        return f"{m.group(2)}-{int(m.group(1)):02d}"
    m = re.match(r"(\d{4})[/.\-](\d{1,2})", v)
    if m and 1 <= int(m.group(2)) <= 12:
        return f"{m.group(1)}-{int(m.group(2)):02d}"
    m = re.match(r"(\d{4})", v)
    if m and 1950 <= int(m.group(1)) <= 2100:
        return m.group(1)
    return ""


def _heading_key(line: str) -> str | None:
    clean = re.sub(r"[^A-Za-z& ]", "", line).strip().lower()
    clean = re.sub(r"\s+", " ", clean)
    if not clean or len(clean) > 40:
        return None
    return _HEADING_LOOKUP.get(clean)


def split_sections(lines: list[str]) -> tuple[list[str], dict[str, list[str]]]:
    header: list[str] = []
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for line in lines:
        key = _heading_key(line) if len(line) < 45 else None
        if key:
            current = key
            sections.setdefault(key, [])
            continue
        if current is None:
            header.append(line)
        else:
            sections[current].append(line)
    return header, sections


def _is_bullet(line: str) -> bool:
    return bool(BULLET_RE.match(line))


def _strip_bullet(line: str) -> str:
    return BULLET_RE.sub("", line).strip()


def _blocks(lines: list[str]) -> list[dict]:
    """Group section lines into entries of {'header': [...], 'bullets': [...]}."""
    blocks: list[dict] = []
    cur: dict | None = None
    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        if _is_bullet(line):
            if cur is None:
                cur = {"header": [], "bullets": []}
                blocks.append(cur)
            cur["bullets"].append(_strip_bullet(line))
        elif cur is not None and cur["bullets"] and (line[0].islower() or line[0] in ",;&(") and len(line) > 2:
            cur["bullets"][-1] += " " + line  # wrapped bullet continuation
        else:
            starts_new = cur is None or cur["bullets"] or (
                DATE_RANGE_RE.search(line) and any(DATE_RANGE_RE.search(h) for h in cur["header"])
            )
            if cur is not None and not cur["bullets"] and len(cur["header"]) >= 3 and not DATE_RANGE_RE.search(line):
                # A long header with no bullets is probably prose bullets without glyphs.
                cur["bullets"].append(line)
                continue
            if starts_new:
                cur = {"header": [], "bullets": []}
                blocks.append(cur)
            cur["header"].append(line)
    return blocks


def _split_parts(text: str, *, allow_at: bool = True) -> list[str]:
    pattern = r"\s*(?:\||•|·|—|–|\s-\s|,\s(?=[A-Z])|\bat\b|@)\s*" if allow_at else r"\s*(?:\||•|·|—|–|\s-\s)\s*"
    parts = re.split(pattern, text)
    return [p.strip(" ,") for p in parts if p and p.strip(" ,")]


def _parse_dates(text: str) -> tuple[str, str, bool, str]:
    m = DATE_RANGE_RE.search(text)
    if m:
        start = normalize_date(m.group("start"))
        end = normalize_date(m.group("end"))
        rest = (text[: m.start()] + " " + text[m.end():]).strip(" |,-–—()")
        return start, ("" if end == "present" else end), end == "present", rest
    m = SINGLE_DATE_RE.search(text)
    if m and normalize_date(m.group("date")):
        rest = (text[: m.start()] + " " + text[m.end():]).strip(" |,-–—()")
        return "", normalize_date(m.group("date")), False, rest
    return "", "", False, text


def parse_experience(lines: list[str]) -> list[dict]:
    out: list[dict] = []
    for i, block in enumerate(_blocks(lines)):
        start = end = location = ""
        current = False
        texts: list[str] = []
        for h in block["header"]:
            s, e, cur, rest = _parse_dates(h)
            if s or e or cur:
                start, end, current = s or start, e or end, cur or current
            if rest:
                texts.append(rest)
        title = company = ""
        parts: list[str] = []
        for t in texts:
            parts.extend(_split_parts(t))
        for p in parts:
            if not title and TITLE_WORDS.search(p):
                title = p
            elif not company and not LOCATION_RE.match(p) and not TITLE_WORDS.search(p):
                company = p
            elif not location and LOCATION_RE.match(p):
                location = p
        if not company and len(parts) >= 2:
            company = next((p for p in parts if p != title), "")
        if not title and not company and not block["bullets"]:
            continue
        if not title and parts:
            title = parts[0] if parts[0] != company else ""
        bullets = [b for b in block["bullets"] if len(b) > 3]
        out.append(
            {
                "company": company[:300],
                "title": title[:300],
                "location": location[:200],
                "start_date": start,
                "end_date": end,
                "is_current": current,
                "bullets": bullets,
                "technologies": extract_skills(" ".join(bullets)),
                "sort_order": i,
            }
        )
    return out


def parse_education(lines: list[str]) -> list[dict]:
    out: list[dict] = []
    for i, block in enumerate(_blocks(lines)):
        all_text = " | ".join(block["header"] + block["bullets"])
        start, end, _cur, _ = _parse_dates(all_text)
        institution = degree = field_of_study = grade = ""
        for chunk in _split_parts(" | ".join(block["header"]), allow_at=False) + block["bullets"]:
            s, e, _c, chunk = _parse_dates(chunk)
            if not chunk:
                continue
            if not degree and DEGREE_RE.search(chunk):
                degree = chunk
                m = re.search(r"(?i)\bin\s+([A-Za-z&,/ ]{3,80})", chunk) or re.search(
                    r"(?i)\bof\s+((?!science\b|arts\b|engineering\b|technology\b)[A-Za-z&,/ ]{3,80})", chunk
                )
                if m:
                    field_of_study = m.group(1).strip(" ,")
            elif not institution and INSTITUTION_RE.search(chunk):
                institution = chunk
        g = GRADE_RE.search(all_text)
        if g:
            grade = (g.group(1) or g.group(2) or "").strip()
        if not institution and block["header"]:
            first = _parse_dates(block["header"][0])[3]
            if first and first != degree:
                institution = first.split("|")[0].strip()
        if not (institution or degree):
            continue
        out.append(
            {
                "institution": institution[:300],
                "degree": degree[:300],
                "field_of_study": field_of_study[:300],
                "start_date": start,
                "end_date": end,
                "grade": grade[:100],
                "details": "; ".join(b for b in block["bullets"] if b not in (degree, institution))[:2000],
                "sort_order": i,
            }
        )
    return out


def parse_skills(lines: list[str]) -> list[dict]:
    seen: dict[str, dict] = {}
    for line in lines:
        text = _strip_bullet(line)
        label = ""
        if ":" in text and len(text.split(":", 1)[0]) <= 40:
            label, text = text.split(":", 1)
        items = re.split(r"\s*[,;|•·]\s*|\s{2,}|\s/\s", text)
        for item in items:
            item = re.sub(r"\(.*?\)", "", item).strip(" .")
            if not item or len(item) > 50 or len(item.split()) > 5:
                # Not a list item — fall back to taxonomy extraction for this fragment.
                for sk in extract_skills(item):
                    seen.setdefault(sk.lower(), {"name": sk, "category": category_of(sk)})
                continue
            name = canonicalize(item)
            cat = category_of(name)
            if cat == "other" and label:
                cat = _label_category(label)
            seen.setdefault(name.lower(), {"name": name, "category": cat})
    return [dict(v, sort_order=i) for i, v in enumerate(seen.values())]


def _label_category(label: str) -> str:
    low = label.lower()
    for key, cat in (("language", "language"), ("framework", "framework"), ("librar", "framework"),
                     ("database", "database"), ("cloud", "cloud"), ("devops", "devops"), ("tool", "tool"),
                     ("soft", "soft"), ("ml", "ml"), ("ai", "ml"), ("data", "data")):
        if key in low:
            return cat
    return "other"


def parse_projects(lines: list[str]) -> list[dict]:
    out: list[dict] = []
    for i, block in enumerate(_blocks(lines)):
        header = " | ".join(block["header"])
        start, end, _c, rest = _parse_dates(header)
        url = ""
        um = URL_RE.search(rest)
        if um and "." in um.group(0) and not EMAIL_RE.search(rest):
            url = um.group(0)
            rest = rest.replace(url, "").strip(" |-–—")
        tech: list[str] = []
        tm = re.search(r"(?i)(?:tech(?:nologies|\s*stack)?|tools|built with|stack)\s*[:\-]\s*(.+)$", rest)
        if tm:
            tech = [canonicalize(t) for t in re.split(r"[,|/]", tm.group(1)) if t.strip()]
            rest = rest[: tm.start()].strip(" |-–—")
        name_parts = _split_parts(rest)
        name = name_parts[0] if name_parts else ""
        bullets = [b for b in block["bullets"] if len(b) > 3]
        if not name and bullets:
            name, bullets = bullets[0][:120], bullets[1:]
        if not name:
            continue
        desc_parts: list[str] = []
        for part in name_parts[1:]:
            if len(part) <= 40 and canonicalize(part) and category_of(part) != "other":
                tech.append(canonicalize(part))
            else:
                desc_parts.append(part)
        description = " ".join(desc_parts)
        tech = list(dict.fromkeys(tech + extract_skills(" ".join([description, *bullets]))))
        out.append(
            {
                "name": name[:300],
                "description": description[:2000],
                "bullets": bullets,
                "technologies": tech,
                "url": url[:500],
                "start_date": start,
                "end_date": end,
                "sort_order": i,
            }
        )
    return out


def parse_certifications(lines: list[str]) -> list[dict]:
    out: list[dict] = []
    for i, line in enumerate(x for x in lines if x.strip()):
        text = _strip_bullet(line)
        _s, end, _c, rest = _parse_dates(text)
        parts = [p for p in re.split(r"\s+(?:-|–|—|\|)\s+|,\s*(?=[A-Z])", rest) if p.strip()]
        if not parts:
            continue
        name = parts[0].strip()
        issuer = parts[1].strip() if len(parts) > 1 else ""
        m = re.match(r"(.+?)\s*\((.+?)\)$", name)
        if m and not issuer:
            name, issuer = m.group(1), m.group(2)
        out.append({"name": name[:300], "issuer": issuer[:300], "issue_date": end, "credential_url": "", "sort_order": i})
    return out


def _bullet_items(lines: list[str]) -> list[str]:
    items: list[str] = []
    for line in lines:
        if not line.strip():
            continue
        if _is_bullet(line) or not items or line[0].isupper() or line[0].isdigit():
            items.append(_strip_bullet(line))
        else:
            items[-1] += " " + line.strip()
    return [i for i in items if len(i) > 3]


def parse_header(header: list[str], full_text: str) -> dict:
    info = {k: "" for k in ("full_name", "email", "phone", "location", "linkedin_url", "github_url", "portfolio_url", "headline")}
    em = EMAIL_RE.search(full_text)
    if em:
        info["email"] = em.group(0)
    head_text = "\n".join(header[:12]) or full_text[:800]
    for m in PHONE_RE.finditer(head_text):
        digits = re.sub(r"\D", "", m.group(1))
        if 8 <= len(digits) <= 15 and not re.fullmatch(r"(19|20)\d{2}(19|20)\d{2}", digits):
            info["phone"] = m.group(1).strip()
            break
    li = LINKEDIN_RE.search(full_text)
    if li:
        info["linkedin_url"] = _with_scheme(li.group(0))
    gh = GITHUB_RE.search(full_text)
    if gh:
        info["github_url"] = _with_scheme(gh.group(0))
    for m in URL_RE.finditer(head_text):
        u = m.group(0)
        low = u.lower()
        if any(x in low for x in ("linkedin.com", "github.com")) or EMAIL_RE.search(u) or "@" in head_text[max(0, m.start() - 1): m.start() + 1]:
            continue
        if re.fullmatch(r"[\d.]+", u) or "." not in u.split("/")[0]:
            continue
        if info["email"] and u in info["email"]:
            continue
        info["portfolio_url"] = _with_scheme(u)
        break
    candidates = [ln for ln in header[:6] if ln.strip()]
    for ln in candidates:
        clean = ln.strip()
        if EMAIL_RE.search(clean) or URL_RE.fullmatch(clean) or any(ch.isdigit() for ch in clean):
            continue
        words = clean.split()
        if 1 < len(words) <= 5 and all(re.fullmatch(r"[A-Za-z.'\-]+", w) for w in words):
            info["full_name"] = " ".join(w if not w.isupper() else w.title() for w in words)
            break
    for ln in header[:8]:
        for seg in re.split(r"\s*[|•·]\s*", ln):
            seg = seg.strip()
            if seg and seg != info["full_name"] and LOCATION_RE.match(seg) and not TITLE_WORDS.search(seg):
                info["location"] = seg
                break
        if info["location"]:
            break
    for ln in header[1:5]:
        if ln.strip() and TITLE_WORDS.search(ln) and not EMAIL_RE.search(ln) and len(ln) < 120:
            info["headline"] = ln.strip()
            break
    return info


def _with_scheme(url: str) -> str:
    url = url.rstrip("/.,;")
    return url if url.lower().startswith(("http://", "https://")) else "https://" + url


def parse_resume_text(text: str) -> ParsedResume:
    lines = [ln.rstrip() for ln in text.split("\n")]
    header, sections = split_sections(lines)
    data: dict = parse_header(header, text)
    data["summary"] = " ".join(x.strip() for x in sections.get("summary", []) if x.strip())[:3000]
    data["experiences"] = parse_experience(sections.get("experience", []))
    data["educations"] = parse_education(sections.get("education", []))
    data["projects"] = parse_projects(sections.get("projects", []))
    data["certifications"] = parse_certifications(sections.get("certifications", []))
    data["achievements"] = _bullet_items(sections.get("achievements", []))
    data["publications"] = _bullet_items(sections.get("publications", []))
    data["spoken_languages"] = [x.strip() for x in re.split(r"[,|•]", " ".join(sections.get("languages", []))) if x.strip()][:20]

    skills = parse_skills(sections.get("skills", []))
    names = {s["name"].lower() for s in skills}
    # Skills evidenced in experience/project technology lists are also verified resume content.
    for item in data["experiences"] + data["projects"]:
        for t in item.get("technologies", []):
            if t.lower() not in names:
                names.add(t.lower())
                skills.append({"name": t, "category": category_of(t), "sort_order": len(skills)})
    data["skills"] = skills

    warnings: list[str] = []
    for key, label in (("full_name", "name"), ("email", "email"), ("phone", "phone number")):
        if not data.get(key):
            warnings.append(f"Could not find your {label}. Please add it.")
    if not data["experiences"]:
        warnings.append("No work experience section was detected. Add your experience manually if you have any.")
    if not data["educations"]:
        warnings.append("No education section was detected.")
    if not data["skills"]:
        warnings.append("No skills were detected.")
    if not sections:
        warnings.append("No standard section headings were found; parsing accuracy may be low.")
    return ParsedResume(data=data, warnings=warnings)
