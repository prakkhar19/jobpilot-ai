"""Playwright helpers: isolated, ephemeral browser contexts with navigation guards."""

from __future__ import annotations

import contextlib
from collections.abc import Iterator
from urllib.parse import urlsplit

from app.adapters.application_providers.base import CAPTCHA_SELECTORS, LOGIN_SELECTORS, HumanActionRequired
from app.core.config import get_settings
from app.security.ssrf import UnsafeURLError, validate_url


@contextlib.contextmanager
def isolated_page(allowed_private_hosts: set[str] | None = None) -> Iterator[object]:
    """Yield a Playwright page in a fresh, isolated context (no shared cookies/storage between runs)."""
    from playwright.sync_api import sync_playwright

    allowed_private_hosts = allowed_private_hosts or set()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=get_settings().browser_headless,
                                    args=["--disable-dev-shm-usage", "--no-first-run"])
        try:
            context = browser.new_context(accept_downloads=False, java_script_enabled=True,
                                          user_agent=get_settings().outbound_user_agent)

            def guard(route) -> None:  # noqa: ANN001
                url = route.request.url
                if url.startswith(("data:", "blob:", "about:")):
                    return route.continue_()
                host = (urlsplit(url).hostname or "").lower()
                try:
                    validate_url(url, allow_private=host in allowed_private_hosts)
                except UnsafeURLError:
                    return route.abort()
                return route.continue_()

            context.route("**/*", guard)
            page = context.new_page()
            page.set_default_timeout(20000)
            yield page
            context.close()
        finally:
            browser.close()


def ensure_no_human_gate(page) -> None:  # noqa: ANN001
    for sel in CAPTCHA_SELECTORS:
        if page.query_selector(sel):
            raise HumanActionRequired("A CAPTCHA is present. JobPilot never bypasses CAPTCHAs — please complete "
                                      "and submit this application yourself.")
    for sel in LOGIN_SELECTORS:
        if page.query_selector(sel):
            raise HumanActionRequired("The application requires signing in. Please apply on the employer's site.")
