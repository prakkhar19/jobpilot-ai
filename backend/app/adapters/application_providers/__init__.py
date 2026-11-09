from app.adapters.application_providers.base import (
    ApplicationProvider,
    FormField,
    HumanActionRequired,
    ProviderError,
    SubmissionResult,
)
from app.adapters.application_providers.greenhouse import GreenhouseProvider
from app.adapters.application_providers.lever import LeverProvider
from app.adapters.application_providers.manual import ManualProvider
from app.adapters.application_providers.mock import MockPortalProvider

PROVIDERS: dict[str, ApplicationProvider] = {
    p.key: p for p in (MockPortalProvider(), GreenhouseProvider(), LeverProvider(), ManualProvider())
}


def provider_for_job(job) -> ApplicationProvider:  # noqa: ANN001
    url = job.application_url or job.posting_url or ""
    if job.is_demo and PROVIDERS["mock"].detect_application_form(url):
        return PROVIDERS["mock"]
    for key in ("greenhouse", "lever"):
        if PROVIDERS[key].detect_application_form(url) or PROVIDERS[key].detect_application_form(job.posting_url or ""):
            return PROVIDERS[key]
    return PROVIDERS["manual"]


__all__ = ["PROVIDERS", "ApplicationProvider", "FormField", "HumanActionRequired", "ProviderError",
           "SubmissionResult", "provider_for_job"]
