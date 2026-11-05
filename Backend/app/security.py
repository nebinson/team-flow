"""Password hashing, access-token creation, and verification-code utilities."""

import hashlib
import hmac
import secrets
from datetime import timedelta

import jwt
from pwdlib import PasswordHash

from app.db import utc_now
from app.settings import settings

_password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    """Return an Argon2 password hash suitable for storing in MongoDB."""
    return _password_hash.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Compare a candidate password with its stored Argon2 hash."""
    return _password_hash.verify(password, password_hash)


def create_access_token(user_id: str) -> str:
    """Create an HS256 token containing the user ID and configured expiry."""
    now = utc_now()
    expires_at = now + timedelta(minutes=settings.access_token_minutes)
    return jwt.encode(
        {"sub": user_id, "iat": now, "exp": expires_at},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )


def decode_access_token(token: str) -> str | None:
    """Return the subject for a valid configured JWT, else None."""
    try:
        claims = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
            options={"require": ["exp", "sub"]},
        )
    except jwt.InvalidTokenError:
        return None
    subject = claims.get("sub")
    return subject if isinstance(subject, str) else None


def create_email_verification_code() -> str:
    """Generate a zero-padded, cryptographically random six-digit code."""
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_email_verification_code(code: str) -> str:
    """HMAC the low-entropy code so database exposure alone cannot reveal it."""
    return hmac.new(
        settings.jwt_secret.encode("utf-8"),
        code.encode("ascii"),
        hashlib.sha256,
    ).hexdigest()
