"""SSRF-safe outbound HTTP.

All fetching of external, user-supplied URLs (job sources, career pages, imported job links, LLM
endpoints) goes through :class:`SafeHttpClient`, which:

* allows only http/https on default or explicit ports,
* resolves the hostname and rejects private, loopback, link-local, multicast, reserved and cloud
  metadata addresses (unless the host is explicitly allow-listed),
* follows redirects manually so every hop is re-validated,
* enforces timeouts and a maximum response size,
* applies a minimum interval between requests to the same host (politeness / rate limits).
"""

from __future__ import annotations

import ipaddress
import socket
import threading
import time
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit

import httpx

from app.core.config import get_settings

MAX_REDIRECTS = 5
DEFAULT_MAX_BYTES = 8 * 1024 * 1024


class UnsafeURLError(ValueError):
    pass


_BLOCKED_HOSTNAMES = {"localhost", "metadata.google.internal", "metadata", "instance-data"}


def _ip_is_public(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
        or (isinstance(ip, ipaddress.IPv4Address) and ip in ipaddress.ip_network("100.64.0.0/10"))
    )


def validate_url(url: str, *, allow_private: bool = False, allowlist: set[str] | None = None) -> str:
    """Validate a URL and return it normalised. Raises UnsafeURLError."""
    if not url or len(url) > 2048:
        raise UnsafeURLError("URL is empty or too long")
    parts = urlsplit(url.strip())
    if parts.scheme not in {"http", "https"}:
        raise UnsafeURLError("Only http and https URLs are allowed")
    if parts.username or parts.password:
        raise UnsafeURLError("Credentials in URLs are not allowed")
    host = (parts.hostname or "").lower().rstrip(".")
    if not host:
        raise UnsafeURLError("URL has no host")
    allowlist = allowlist if allowlist is not None else get_settings().fetch_allowlist_hosts
    if host in allowlist or allow_private:
        return url.strip()
    if host in _BLOCKED_HOSTNAMES or host.endswith(".localhost") or host.endswith(".internal"):
        raise UnsafeURLError("Host is not allowed")
    try:
        infos = socket.getaddrinfo(host, parts.port or (443 if parts.scheme == "https" else 80))
    except socket.gaierror as exc:
        raise UnsafeURLError(f"Could not resolve host {host}") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if not _ip_is_public(ip):
            raise UnsafeURLError("URL resolves to a private or reserved address")
    return url.strip()


class _HostThrottle:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._last: dict[str, float] = {}

    def wait(self, host: str, min_interval: float) -> None:
        if min_interval <= 0:
            return
        with self._lock:
            now = time.monotonic()
            last = self._last.get(host, 0.0)
            delay = max(0.0, last + min_interval - now)
            self._last[host] = now + delay
        if delay:
            time.sleep(delay)


_throttle = _HostThrottle()


@dataclass
class FetchResult:
    url: str
    status_code: int
    headers: dict[str, str]
    content: bytes

    @property
    def text(self) -> str:
        return self.content.decode("utf-8", errors="replace")

    def json(self):  # noqa: ANN201
        import json

        return json.loads(self.content)


class SafeHttpClient:
    def __init__(
        self,
        *,
        allow_private: bool = False,
        timeout: float = 20.0,
        max_bytes: int = DEFAULT_MAX_BYTES,
        min_interval: float | None = None,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        s = get_settings()
        self.allow_private = allow_private
        self.max_bytes = max_bytes
        self.min_interval = s.per_host_min_interval_seconds if min_interval is None else min_interval
        self._client = httpx.Client(
            timeout=timeout,
            follow_redirects=False,
            headers={"User-Agent": s.outbound_user_agent, "Accept": "*/*"},
            transport=transport,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> SafeHttpClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def request(self, method: str, url: str, **kwargs) -> FetchResult:  # noqa: ANN003
        current = url
        for _ in range(MAX_REDIRECTS + 1):
            validate_url(current, allow_private=self.allow_private)
            host = urlsplit(current).hostname or ""
            _throttle.wait(host, self.min_interval)
            with self._client.stream(method, current, **kwargs) as resp:
                if resp.is_redirect:
                    location = resp.headers.get("location")
                    if not location:
                        raise UnsafeURLError("Redirect without location")
                    current = urljoin(current, location)
                    if resp.status_code in (301, 302, 303):
                        method, kwargs = "GET", {k: v for k, v in kwargs.items() if k in {"headers", "params"}}
                    continue
                chunks: list[bytes] = []
                total = 0
                for chunk in resp.iter_bytes():
                    total += len(chunk)
                    if total > self.max_bytes:
                        raise UnsafeURLError("Response too large")
                    chunks.append(chunk)
                return FetchResult(current, resp.status_code, dict(resp.headers), b"".join(chunks))
        raise UnsafeURLError("Too many redirects")

    def get(self, url: str, **kwargs) -> FetchResult:  # noqa: ANN003
        return self.request("GET", url, **kwargs)

    def post(self, url: str, **kwargs) -> FetchResult:  # noqa: ANN003
        return self.request("POST", url, **kwargs)
