"""Lever application forms: field inspection from the public apply page; assisted fill via Playwright."""

from __future__ import annotations

import re

from bs4 import BeautifulSoup

from app.adapters.application_providers.base import ApplicationProvider, FillResult, FormField, ProviderError
from app.adapters.application_providers.browser import ensure_no_human_gate
from app.adapters.job_sources.base import robots_allows
from app.security.ssrf import SafeHttpClient, UnsafeURLError

_URL = re.compile(r"jobs\.(?:eu\.)?lever\.co/[A-Za-z0-9_\-.]+/[A-Za-z0-9\-]{8,64}")


class LeverProvider(ApplicationProvider):
    key = "lever"
    label = "Lever"
    supports_inspection = True
    supports_fill = True
    supports_submit = False
    note = "Fields are read from the public apply page. JobPilot can pre-fill the form for review; you submit it."

    def detect_application_form(self, url: str) -> bool:
        return bool(_URL.search(url or ""))

    def _apply_url(self, job) -> str:  # noqa: ANN001
        base = (job.posting_url or job.application_url or "").split("?")[0].rstrip("/")
        if not _URL.search(base):
            raise ProviderError("Not a Lever posting URL.")
        return base if base.endswith("/apply") else f"{base}/apply"

    def inspect_fields(self, job) -> list[FormField]:  # noqa: ANN001
        url = self._apply_url(job)
        try:
            with SafeHttpClient() as client:
                if not robots_allows(client, url):
                    raise ProviderError("robots.txt disallows reading this application page.")
                res = client.get(url)
        except UnsafeURLError as exc:
            raise ProviderError(str(exc)) from exc
        if res.status_code != 200:
            raise ProviderError(f"Lever returned HTTP {res.status_code}")
        soup = BeautifulSoup(res.text, "html.parser")
        form = soup.find("form")
        if form is None:
            raise ProviderError("No application form found.")
        fields: list[FormField] = []
        seen: set[str] = set()
        for el in form.find_all(["input", "textarea", "select"]):
            name = el.get("name") or ""
            if not name or name in seen or el.get("type") in ("hidden", "submit", "button"):
                continue
            seen.add(name)
            wrapper = el.find_parent(["li", "div", "label"])
            label_el = wrapper.find(class_=re.compile("application-label|text")) if wrapper else None
            label = (label_el.get_text(" ", strip=True) if label_el else name).replace("✱", "").strip()
            ftype = el.name if el.name in ("select", "textarea") else (el.get("type") or "text")
            kind = "resume" if name == "resume" else ("question" if name.startswith("cards[") else "standard")
            required = el.has_attr("required") or "✱" in (wrapper.get_text() if wrapper else "")
            opts = [o.get_text(strip=True) for o in el.find_all("option") if o.get("value")] if el.name == "select" else []
            fields.append(FormField(name=name, label=label, type=ftype, required=required, options=opts, kind=kind))
        return fields

    def prepare_application(self, page, job, fields, answers, files) -> FillResult:  # noqa: ANN001
        page.goto(self._apply_url(job), wait_until="domcontentloaded")
        ensure_no_human_gate(page)
        filled, skipped = [], []
        for f in fields:
            el = page.query_selector(f'[name="{f.name}"]')
            if el is None:
                skipped.append(f.name)
                continue
            try:
                if f.type == "file":
                    if files.get(f.kind):
                        el.set_input_files(files[f.kind])
                        filled.append(f.name)
                    else:
                        skipped.append(f.name)
                    continue
                value = (answers.get(f.name) or {}).get("value", "")
                if not value or f.type in ("select", "radio", "checkbox"):
                    skipped.append(f.name)
                    continue
                el.fill(value)
                filled.append(f.name)
            except Exception:  # noqa: BLE001
                skipped.append(f.name)
        return FillResult(filled, skipped, page.screenshot(full_page=True),
                          "Form pre-filled for review. Review it on the employer's site and submit it yourself.")
