import hashlib
import secrets
from datetime import timedelta

import jwt
from pwdlib import PasswordHash

from app.db import utc_now
from app.settings import settings

_password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return _password_hash.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _password_hash.verify(password, password_hash)


def create_access_token(user_id: str) -> str:
    now = utc_now()
    expires_at = now + timedelta(minutes=settings.access_token_minutes)
    return jwt.encode(
        {"sub": user_id, "iat": now, "exp": expires_at},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )


def create_email_verification_token() -> str:
    return secrets.token_urlsafe(32)


def hash_email_verification_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
