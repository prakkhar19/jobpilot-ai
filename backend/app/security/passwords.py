"""Argon2id password hashing."""

from __future__ import annotations

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_hasher = PasswordHasher()  # argon2id with library-recommended parameters

MIN_PASSWORD_LENGTH = 10


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


def validate_password_strength(password: str) -> list[str]:
    problems: list[str] = []
    if len(password) < MIN_PASSWORD_LENGTH:
        problems.append(f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
    if len(password) > 256:
        problems.append("Password must be at most 256 characters.")
    if password.lower() == password or password.upper() == password:
        if not any(c.isdigit() for c in password) and not any(not c.isalnum() for c in password):
            problems.append("Use a mix of letters with numbers or symbols.")
    return problems


# A pre-computed hash used to equalise timing when the user does not exist.
DUMMY_HASH = _hasher.hash("timing-equaliser-not-a-real-password")
