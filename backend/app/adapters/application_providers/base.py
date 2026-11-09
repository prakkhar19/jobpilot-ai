"""Application provider interface.

Providers inspect application forms, map verified candidate data to fields, and (where supported and
authorised) fill and submit forms with Playwright. Every provider must stop when it encounters a
CAPTCHA, MFA or login wall — those are never bypassed.
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field


class ProviderError(Exception):
    pass


class HumanActionRequired(ProviderError):
    """Raised when the flow needs a human (CAPTCHA, MFA, login, unexpected form)."""


@dataclass
class FormField:
    name: str
    label: str
    type: str = "text"  # text | textarea | email | tel | url | file | select | checkbox | radio
    required: bool = False
    options: list[str] = field(default_factory=list)
    kind: str = "standard"  # standard | question | resume | cover_letter

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass
class SubmissionResult:
    submitted: bool
    confirmation_text: str = ""
    screenshot: bytes | None = None
    message: str = ""


@dataclass
class FillResult:
    filled: list[str]
    skipped: list[str]
    screenshot: bytes | None = None
    message: str = ""


CAPTCHA_SELECTORS = [
    "iframe[src*='recaptcha']", ".g-recaptcha", "iframe[src*='hcaptcha']", ".h-captcha", ".cf-turnstile",
    "iframe[src*='challenges.cloudflare.com']", "[data-captcha]", "#captcha",
]
LOGIN_SELECTORS = ["input[type='password']"]


def normalize_label(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (label or "").lower()).strip()[:300]


# Intent → (regex on the field label/name, profile key or application_facts keywords)
_STANDARD = [
    (re.compile(r"(?i)^(first[\s_]*name|given[\s_]*name|fname)$"), "first_name"),
    (re.compile(r"(?i)^(last[\s_]*name|surname|family[\s_]*name|lname)$"), "last_name"),
    (re.compile(r"(?i)^(full[\s_]*name|name|your name)$"), "full_name"),
    (re.compile(r"(?i)e-?mail"), "email"),
    (re.compile(r"(?i)phone|mobile|tel"), "phone"),
    (re.compile(r"(?i)linkedin"), "linkedin_url"),
    (re.compile(r"(?i)github"), "github_url"),
    (re.compile(r"(?i)^(website|portfolio|personal (site|website)|other website|url)"), "portfolio_url"),
    (re.compile(r"(?i)^(location|city|current location|where are you (based|located))"), "location"),
]
_FACT_INTENTS = [
    (re.compile(r"(?i)(legally )?(authori[sz]ed|eligible|right) to work"), ("work authorization", "work authorisation", "authorized to work", "right to work")),
    (re.compile(r"(?i)sponsor"), ("sponsorship", "visa sponsorship", "require sponsorship")),
    (re.compile(r"(?i)notice period|start date|when can you start|availability"), ("notice period", "availability", "start date")),
    (re.compile(r"(?i)salary|compensation expectation|expected (ctc|compensation)"), ("salary expectation", "expected salary", "compensation")),
    (re.compile(r"(?i)relocat"), ("relocation", "willing to relocate")),
    (re.compile(r"(?i)pronoun"), ("pronouns",)),
    (re.compile(r"(?i)how did you hear"), ("how did you hear", "referral source")),
]


def map_candidate_data(fields: list[FormField], profile: dict, answer_bank: dict[str, str],
                       existing: dict | None = None) -> tuple[dict, list[dict]]:
    """Map verified data to form fields. Returns (answers, missing_required).

    answers: {field_name: {"value": str, "source": "profile|facts|answer_bank|user|document"}}
    Unknown required answers are never guessed — they are returned as missing.
    """
    answers: dict = {k: v for k, v in (existing or {}).items() if v.get("source") == "user"}
    full = (profile.get("full_name") or "").strip()
    first, _, last = full.partition(" ")
    derived = {"first_name": first, "last_name": last.strip(), "full_name": full}
    facts = {normalize_label(k): str(v) for k, v in (profile.get("application_facts") or {}).items() if str(v).strip()}
    missing: list[dict] = []
    for f in fields:
        if f.name in answers:
            continue
        if f.kind in ("resume", "cover_letter"):
            answers[f.name] = {"value": f.kind, "source": "document"}
            continue
        value, source = "", ""
        bank = answer_bank.get(normalize_label(f.label)) or answer_bank.get(normalize_label(f.name))
        if bank:
            value, source = bank, "answer_bank"
        if not value:
            for pat, key in _STANDARD:
                if pat.search(f.label.strip()) or pat.search(f.name.replace("_", " ").strip()):
                    value = derived.get(key) or str(profile.get(key) or "")
                    source = "profile"
                    break
        if not value:
            for pat, keys in _FACT_INTENTS:
                if pat.search(f.label):
                    for k in keys:
                        if normalize_label(k) in facts:
                            value, source = facts[normalize_label(k)], "facts"
                            break
                    break
        if not value and normalize_label(f.label) in facts:
            value, source = facts[normalize_label(f.label)], "facts"
        if value and f.options:
            # Only accept a value that is one of the allowed options (case-insensitive).
            opt = next((o for o in f.options if o.lower() == value.lower()), None)
            if opt is None:
                opt = next((o for o in f.options if value.lower() in ("yes", "no") and o.lower().startswith(value.lower())), None)
            value = opt or ""
        if value:
            answers[f.name] = {"value": value, "source": source}
        elif f.required:
            missing.append(f.as_dict())
    return answers, missing


class ApplicationProvider(ABC):
    key: str = ""
    label: str = ""
    supports_inspection: bool = False
    supports_fill: bool = False
    supports_submit: bool = False
    note: str = ""

    @abstractmethod
    def detect_application_form(self, url: str) -> bool: ...

    @abstractmethod
    def inspect_fields(self, job) -> list[FormField]: ...  # noqa: ANN001

    def map_candidate_data(self, fields: list[FormField], profile: dict, answer_bank: dict[str, str],
                           existing: dict | None = None) -> tuple[dict, list[dict]]:
        return map_candidate_data(fields, profile, answer_bank, existing)

    def validate_application(self, fields: list[FormField], answers: dict) -> list[str]:
        errors = []
        for f in fields:
            if f.required and not (answers.get(f.name) or {}).get("value"):
                errors.append(f"'{f.label}' is required")
        return errors

    def prepare_application(self, page, job, fields, answers, files) -> FillResult:  # noqa: ANN001
        raise ProviderError(f"{self.label} does not support automated form filling.")

    def submit_application(self, page, job, fields, answers, files) -> SubmissionResult:  # noqa: ANN001
        raise ProviderError(f"{self.label} does not support automated submission. Submit on the employer's site.")

    def verify_submission(self, page) -> SubmissionResult:  # noqa: ANN001
        raise ProviderError("Verification not supported.")

    def capabilities(self) -> dict:
        return {"key": self.key, "label": self.label, "inspection": self.supports_inspection,
                "assisted_fill": self.supports_fill, "automated_submit": self.supports_submit, "note": self.note}
