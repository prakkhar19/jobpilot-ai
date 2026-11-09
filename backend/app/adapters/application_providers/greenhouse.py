"""Greenhouse application forms: field inspection via the public Job Board API, assisted fill via Playwright.

Automated *submission* to real employers is intentionally not supported: Greenhouse boards commonly use
CAPTCHA protection, and submitting on a user's behalf is left to the user after reviewing the filled form.
"""

from __future__ import annotations

import re

from app.adapters.application_providers.base import ApplicationProvider, FillResult, FormField, ProviderError
from app.adapters.application_providers.browser import ensure_no_human_gate
from app.adapters.job_sources.base import html_to_text
from app.security.ssrf import SafeHttpClient, UnsafeURLError

_URL = re.compile(r"(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io/([A-Za-z0-9_\-]+)/jobs/(\d+)")
_TYPES = {"input_text": "text", "input_file": "file", "textarea": "textarea", "multi_value_single_select": "select",
          "multi_value_multi_select": "select", "input_hidden": "hidden"}


class GreenhouseProvider(ApplicationProvider):
    key = "greenhouse"
    label = "Greenhouse"
    supports_inspection = True
    supports_fill = True
    supports_submit = False
    note = "Fields are read from Greenhouse's public API. JobPilot can pre-fill the form for review; you submit it."

    def detect_application_form(self, url: str) -> bool:
        return bool(_URL.search(url or ""))

    def _ids(self, job) -> tuple[str, str]:  # noqa: ANN001
        m = _URL.search(job.application_url or "") or _URL.search(job.posting_url or "")
        if m:
            return m.group(1), m.group(2)
        if job.source_kind == "greenhouse" and ":" in job.external_id:
            token, jid = job.external_id.split(":", 1)
            return token, jid
        raise ProviderError("Cannot determine the Greenhouse board and job id.")

    def inspect_fields(self, job) -> list[FormField]:  # noqa: ANN001
        token, jid = self._ids(job)
        try:
            with SafeHttpClient() as client:
                res = client.get(f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{jid}",
                                 params={"questions": "true"})
        except UnsafeURLError as exc:
            raise ProviderError(str(exc)) from exc
        if res.status_code == 404:
            raise ProviderError("This Greenhouse job is no longer open.")
        if res.status_code != 200:
            raise ProviderError(f"Greenhouse returned HTTP {res.status_code}")
        data = res.json()
        out: list[FormField] = []
        for q in data.get("questions") or []:
            label = html_to_text(q.get("label") or "").strip()
            for fdef in q.get("fields") or []:
                ftype = _TYPES.get(fdef.get("type", ""), "text")
                if ftype == "hidden":
                    continue
                name = fdef.get("name") or ""
                kind = "standard"
                if ftype == "file":
                    kind = "resume" if "resume" in name else ("cover_letter" if "cover" in name else "question")
                elif name.startswith("question_"):
                    kind = "question"
                opts = [str(v.get("label")) for v in fdef.get("values") or [] if v.get("label")]
                out.append(FormField(name=name, label=label or name, type=ftype, required=bool(q.get("required")),
                                     options=opts, kind=kind))
        return out

    def prepare_application(self, page, job, fields, answers, files) -> FillResult:  # noqa: ANN001
        page.goto(job.application_url, wait_until="domcontentloaded")
        ensure_no_human_gate(page)
        filled, skipped = [], []
        for f in fields:
            sel = f"[name='{f.name}'], #{f.name}" if re.fullmatch(r"[A-Za-z_][\w\-]*", f.name) else f"[name='{f.name}']"
            el = page.query_selector(sel)
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
                if not value or f.type == "select":
                    skipped.append(f.name)  # custom selects are left for the user to confirm
                    continue
                el.fill(value)
                filled.append(f.name)
            except Exception:  # noqa: BLE001
                skipped.append(f.name)
        return FillResult(filled, skipped, page.screenshot(full_page=True),
                          "Form pre-filled for review. Review it on the employer's site and submit it yourself.")
