"""Opaque random tokens, hashing and CSRF derivation."""

from __future__ import annotations

import hashlib
import hmac
import secrets

from app.core.config import get_settings


def new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def csrf_for_session(session_token: str) -> str:
    """CSRF token bound to the session: HMAC(secret, session_token)."""
    key = get_settings().secret_key.encode()
    return hmac.new(key, b"csrf:" + session_token.encode(), hashlib.sha256).hexdigest()


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())
