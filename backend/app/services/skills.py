"""Skill extraction and normalisation against the taxonomy."""

from __future__ import annotations

import re
from functools import lru_cache

from app.data.skills import TAXONOMY

_BOUNDARY_L = r"(?<![A-Za-z0-9+#./-])"
_BOUNDARY_R = r"(?![A-Za-z0-9+#]|\.[A-Za-z0-9])"


@lru_cache(maxsize=1)
def _patterns() -> list[tuple[str, re.Pattern[str], bool]]:
    """(canonical, pattern, needs_context). Case-sensitive aliases are ambiguous English words."""
    out: list[tuple[str, re.Pattern[str], bool]] = []
    for canonical, (_cat, aliases) in TAXONOMY.items():
        insensitive: list[str] = []
        sensitive: list[str] = []
        if f"={canonical}" not in aliases:
            insensitive.append(canonical)
        for a in aliases:
            (sensitive if a.startswith("=") else insensitive).append(a.lstrip("="))
        if insensitive:
            alt = "|".join(re.escape(x) for x in sorted(set(insensitive), key=len, reverse=True))
            out.append((canonical, re.compile(_BOUNDARY_L + f"(?:{alt})" + _BOUNDARY_R, re.IGNORECASE), False))
        if sensitive:
            alt = "|".join(re.escape(x) for x in sorted(set(sensitive), key=len, reverse=True))
            out.append((canonical, re.compile(_BOUNDARY_L + f"(?:{alt})" + _BOUNDARY_R), True))
    return out


# Ambiguous words (Go, R, C, React, Spark, Swift...) only count when surrounded by technical context.
_CONTEXT_RE = re.compile(
    r"(?i)(,|/|\(|\)|:|;|\+|\band\b|\bor\b|\bwith\b|\busing\b|\bin\b|\blanguages?\b|\bprogramming\b|"
    r"\bdeveloper\b|\bengineer|\bframeworks?\b|\blibrar|\bexperience\b|\bskills?\b|\bstack\b|\bjs\b|"
    r"\bapps?\b|\bnative\b|\bhooks\b|\bcomponents?\b|\bstreaming\b|\bjobs?\b)"
)


def _has_context(text: str, start: int, end: int) -> bool:
    before = text[max(0, start - 30) : start]
    after = text[end : end + 30]
    # Sentence-initial word followed by a lowercase verb-like word ("React to change") is prose.
    if re.match(r"\s+(?:to|is|was|the|a|an|joy|of|on|for|ahead|back|out|up|down|through)\b", after) and (
        not before.strip() or before.rstrip().endswith((".", "!", "?", "\n"))
    ):
        return False
    return bool(_CONTEXT_RE.search(before[-20:]) or _CONTEXT_RE.search(after[:20]))


def extract_skills(text: str) -> list[str]:
    """Return canonical skills mentioned in ``text`` in order of first appearance."""
    if not text:
        return []
    found: dict[str, int] = {}
    for canonical, pat, needs_context in _patterns():
        for m in pat.finditer(text):
            if needs_context and not _has_context(text, m.start(), m.end()):
                continue
            if canonical not in found or m.start() < found[canonical]:
                found[canonical] = m.start()
            break
    return sorted(found, key=found.get)


def canonicalize(name: str) -> str:
    """Map a free-text skill name to its canonical form if known, else return a cleaned version."""
    clean = re.sub(r"\s+", " ", (name or "").strip(" .;:-•*\t"))
    if not clean:
        return ""
    low = clean.lower()
    for canonical, (_cat, aliases) in TAXONOMY.items():
        if low == canonical.lower() or low in {a.lstrip("=").lower() for a in aliases}:
            return canonical
    return clean


def category_of(name: str) -> str:
    entry = TAXONOMY.get(canonicalize(name))
    return entry[0] if entry else "other"


def skill_key(name: str) -> str:
    return canonicalize(name).lower()
