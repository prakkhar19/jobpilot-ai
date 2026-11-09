"""Sandbox mock portal provider — the only provider that performs fully automated submission.

It targets the local /mock-portal served by JobPilot itself (DEMO_MODE), so end-to-end tests and demos
never contact a real employer.
"""

from __future__ import annotations

import re
from urllib.parse import urlsplit

from bs4 import BeautifulSoup

from app.adapters.application_providers.base import (
    ApplicationProvider,
    FillResult,
    FormField,
    ProviderError,
    SubmissionResult,
)
from app.adapters.application_providers.browser import ensure_no_human_gate
from app.core.config import get_settings


def internal_url(url: str) -> str:
    """Rewrite the public mock-portal URL to the container-internal backend address."""
    path = urlsplit(url).path
    q = urlsplit(url).query
    return f"{get_settings().internal_base_url.rstrip('/')}{path}" + (f"?{q}" if q else "")


def parse_form(html: str) -> list[FormField]:
    soup = BeautifulSoup(html, "html.parser")
    form = soup.find("form", id="application-form")
    if form is None:
        raise ProviderError("No application form found on the page.")
    fields: list[FormField] = []
    for el in form.find_all(["input", "select", "textarea"]):
        name = el.get("name")
        if not name or el.get("type") in ("hidden", "submit"):
            continue
        label_el = soup.find("label", attrs={"for": el.get("id")}) if el.get("id") else None
        label = label_el.get_text(" ", strip=True).rstrip("*").strip() if label_el else name
        ftype = el.name if el.name in ("select", "textarea") else (el.get("type") or "text")
        kind = "standard"
        if ftype == "file":
            kind = "resume" if "resume" in name else "cover_letter"
        elif name.startswith("q_"):
            kind = "question"
        options = [o.get_text(strip=True) for o in el.find_all("option") if o.get("value")] if el.name == "select" else []
        fields.append(FormField(name=name, label=label, type=ftype, required=el.has_attr("required"),
                                options=options, kind=kind))
    return fields


class MockPortalProvider(ApplicationProvider):
    key = "mock"
    label = "JobPilot sandbox portal"
    supports_inspection = True
    supports_fill = True
    supports_submit = True
    note = "Fictional sandbox used for demos and tests. Never contacts a real employer."

    def detect_application_form(self, url: str) -> bool:
        return "/mock-portal/apply/" in url

    def inspect_fields(self, job) -> list[FormField]:  # noqa: ANN001
        import httpx

        try:
            res = httpx.get(internal_url(job.application_url), timeout=15)
        except httpx.HTTPError as exc:
            raise ProviderError(f"Could not reach the sandbox portal: {type(exc).__name__}") from exc
        if res.status_code != 200:
            raise ProviderError(f"Sandbox portal returned HTTP {res.status_code}")
        return parse_form(res.text)

    def prepare_application(self, page, job, fields, answers, files) -> FillResult:  # noqa: ANN001
        page.goto(internal_url(job.application_url), wait_until="domcontentloaded")
        ensure_no_human_gate(page)
        filled, skipped = [], []
        for f in fields:
            sel = f"[name='{f.name}']"
            if page.query_selector(sel) is None:
                skipped.append(f.name)
                continue
            if f.type == "file":
                path = files.get(f.kind)
                if path:
                    page.set_input_files(sel, path)
                    filled.append(f.name)
                else:
                    skipped.append(f.name)
                continue
            value = (answers.get(f.name) or {}).get("value", "")
            if not value:
                skipped.append(f.name)
                continue
            if f.type == "select":
                page.select_option(sel, label=value)
            else:
                page.fill(sel, value)
            filled.append(f.name)
        return FillResult(filled, skipped, page.screenshot(full_page=True), "Form filled; not submitted.")

    def submit_application(self, page, job, fields, answers, files) -> SubmissionResult:  # noqa: ANN001
        fill = self.prepare_application(page, job, fields, answers, files)
        missing = [f.name for f in fields if f.required and f.name in fill.skipped]
        if missing:
            raise ProviderError(f"Required fields could not be filled: {', '.join(missing)}")
        ensure_no_human_gate(page)
        page.click("#submit-application")
        page.wait_for_load_state("domcontentloaded")
        return self.verify_submission(page)

    def verify_submission(self, page) -> SubmissionResult:  # noqa: ANN001
        el = page.query_selector("#confirmation")
        if el is None:
            raise ProviderError("No confirmation was shown after submitting.")
        text = el.inner_text()
        m = re.search(r"MOCK-[A-Z0-9]+", text)
        return SubmissionResult(True, m.group(0) if m else text[:200], page.screenshot(full_page=True),
                                "Submission confirmed by the sandbox portal.")
