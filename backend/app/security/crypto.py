"""Encryption at rest for secrets such as user API keys (Fernet, key derived from the app secret)."""

from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings


def _fernet() -> Fernet:
    secret = get_settings().secret_key.encode()
    key = hashlib.pbkdf2_hmac("sha256", secret, b"jobpilot-at-rest-v1", 200_000, dklen=32)
    return Fernet(base64.urlsafe_b64encode(key))


_cache: dict[str, Fernet] = {}


def _get() -> Fernet:
    secret = get_settings().secret_key
    if secret not in _cache:
        _cache.clear()
        _cache[secret] = _fernet()
    return _cache[secret]


def encrypt(plaintext: str) -> str:
    if not plaintext:
        return ""
    return _get().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    if not ciphertext:
        return ""
    try:
        return _get().decrypt(ciphertext.encode()).decode()
    except InvalidToken as exc:
        raise ValueError("Stored secret could not be decrypted (was APP_SECRET_KEY changed?)") from exc
