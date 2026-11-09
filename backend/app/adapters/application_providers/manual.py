from __future__ import annotations

from app.adapters.application_providers.base import ApplicationProvider, FormField


class ManualProvider(ApplicationProvider):
    """Fallback for unsupported sites: JobPilot prepares documents; the user applies and records it."""

    key = "manual"
    label = "Manual (unsupported site)"
    note = ("This site isn't supported for automation. Open the posting, apply yourself with the generated "
            "documents, then mark the application as submitted.")

    def detect_application_form(self, url: str) -> bool:
        return True

    def inspect_fields(self, job) -> list[FormField]:  # noqa: ANN001
        return []
