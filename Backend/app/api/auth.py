"""Registration, email verification, login, and current-user endpoints.

The registration and resend responses are intentionally generic. Verification
codes are scoped to an email address, expire, and allow at most five attempts.
"""

import hmac
import uuid
from datetime import timedelta

from bson import ObjectId
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pwdlib.exceptions import UnknownHashError
from pymongo import ReturnDocument
from pymongo.database import Database
from pymongo.errors import DuplicateKeyError

from app.db import get_database, utc_now
from app.models.documents import UserDocument
from app.schemas.auth import (
    AccessTokenResponse,
    AuthMessage,
    EmailChangeRequest,
    EmailCodeRequest,
    IdentifierRequest,
    LoginRequest,
    PasswordChangeRequest,
    ProfileUpdateRequest,
    RefreshSessionRequest,
    RegisterRequest,
    UserResponse,
    VerifyEmailRequest,
)
from app.security import (
    create_access_token,
    create_refresh_token,
    decode_access_token,
    hash_email_verification_code,
    hash_password,
    hash_refresh_token,
    verify_password,
)
from app.services.email_verification import (
    EmailDeliveryError,
    email_verification_is_configured,
    send_verification_email,
)
from app.services import r2_storage
from app.settings import settings

router = APIRouter(prefix="/auth", tags=["authentication"])
_bearer = HTTPBearer(auto_error=False)
_REGISTRATION_MESSAGE = (
    "If this address can be registered, a verification email will be sent."
)


def _mask_email(address: str) -> str:
    local_part, domain = address.split("@", 1)
    return f"{local_part[:1]}{'*' * max(2, len(local_part) - 1)}@{domain}"


def _require_auth_configuration(*, email: bool = False) -> None:
    if len(settings.jwt_secret) < 32:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication is not configured.",
        )
    if email and not email_verification_is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Email verification is not configured.",
        )


def _public_user(user: UserDocument) -> UserResponse:
    full_name = user.get("name", "TeamFlow user")
    name_parts = full_name.split(maxsplit=1)
    first_name = user.get("first_name") or name_parts[0]
    last_name = user.get("last_name") or (name_parts[1] if len(name_parts) > 1 else "")
    updated_at = user.get("updated_at", user["created_at"])
    avatar_version = int(updated_at.timestamp() * 1000) if hasattr(updated_at, "timestamp") else 0
    return UserResponse(
        id=str(user["_id"]),
        name=f"{first_name} {last_name}".strip(),
        username=user.get("username", ""),
        first_name=first_name,
        last_name=last_name,
        email=user["email"],
        email_verified=user["email_verified"],
        created_at=user["created_at"],
        gender=user.get("gender"),
        avatar_url=f"/api/v1/auth/me/avatar?v={avatar_version}" if user.get("avatar_key") else None,
    )


def _send_verification(database: Database, user: dict) -> None:
    try:
        send_verification_email(database, user)
    except EmailDeliveryError:
        # Keep the response indistinguishable for existing and unknown email addresses.
        return


def _issue_session(user_id: ObjectId, database: Database) -> AccessTokenResponse:
    now = utc_now()
    refresh_expires_at = now + timedelta(days=max(1, settings.refresh_token_days))
    refresh_token = create_refresh_token()
    database.refresh_tokens.insert_one({
        "token_hash": hash_refresh_token(refresh_token),
        "user_id": user_id,
        "created_at": now,
        "expires_at": refresh_expires_at,
    })
    return AccessTokenResponse(
        access_token=create_access_token(str(user_id)),
        expires_in=settings.access_token_minutes * 60,
        refresh_token=refresh_token,
        refresh_expires_in=max(1, settings.refresh_token_days) * 86400,
    )


@router.post(
    "/register",
    response_model=AuthMessage,
    status_code=status.HTTP_202_ACCEPTED,
)
def register(payload: RegisterRequest, database: Database = Depends(get_database)) -> AuthMessage:
    """Create an unverified account and send a code without disclosing account state."""
    _require_auth_configuration(email=True)
    now = utc_now()
    user = database.users.find_one({"email": payload.email})

    if user is not None:
        if not user.get("email_verified", False):
            _send_verification(database, user)
            return AuthMessage(message=_REGISTRATION_MESSAGE)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account already uses this email. Sign in with your username or email.",
        )

    if database.users.find_one({"username": payload.username}, {"_id": 1}):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That username is already taken. Choose another one.",
        )

    if user is None:
        full_name = f"{payload.first_name} {payload.last_name}"
        user: UserDocument = {
            "name": full_name,
            "first_name": payload.first_name,
            "last_name": payload.last_name,
            "username": payload.username,
            "gender": payload.gender,
            "email": payload.email,
            "password_hash": hash_password(payload.password),
            "email_verified": False,
            "created_at": now,
            "updated_at": now,
        }
        try:
            result = database.users.insert_one(user)
            user["_id"] = result.inserted_id
        except DuplicateKeyError:
            existing_email = database.users.find_one({"email": payload.email})
            if existing_email and not existing_email.get("email_verified", False):
                _send_verification(database, existing_email)
                return AuthMessage(message=_REGISTRATION_MESSAGE)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="That username or email is already in use.",
            )
        _send_verification(database, user)

    return AuthMessage(message=_REGISTRATION_MESSAGE)


@router.post(
    "/resend-verification",
    response_model=AuthMessage,
    status_code=status.HTTP_202_ACCEPTED,
)
def resend_verification(
    payload: IdentifierRequest, database: Database = Depends(get_database)
) -> AuthMessage:
    """Request another code; the service enforces a per-account cooldown."""
    _require_auth_configuration(email=True)
    lookup = {"email": payload.identifier} if "@" in payload.identifier else {"username": payload.identifier}
    user = database.users.find_one(lookup)
    if user and not user.get("email_verified", False):
        _send_verification(database, user)
    return AuthMessage(message=_REGISTRATION_MESSAGE)


@router.post("/verify-email", response_model=AuthMessage)
def verify_email(
    payload: VerifyEmailRequest, database: Database = Depends(get_database)
) -> AuthMessage:
    """Consume a valid email/code pair while atomically incrementing attempts."""
    code_hash = hash_email_verification_code(payload.code)
    lookup = {"email": payload.identifier} if "@" in payload.identifier else {"username": payload.identifier}
    user = database.users.find_one({**lookup, "email_verified": False})
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The code is invalid, expired, or the attempt limit was reached.",
        )

    verification = database.email_verifications.find_one_and_update(
        {
            "user_id": user["_id"],
            "expires_at": {"$gt": utc_now()},
            "attempt_count": {"$lt": 5},
        },
        {"$inc": {"attempt_count": 1}},
        return_document=ReturnDocument.AFTER,
    )
    if verification is None or not hmac.compare_digest(code_hash, verification["code_hash"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The code is invalid, expired, or the attempt limit was reached.",
        )

    database.email_verifications.delete_one(
        {"_id": verification["_id"], "code_hash": code_hash}
    )

    result = database.users.update_one(
        {"_id": verification["user_id"], "email_verified": False},
        {"$set": {"email_verified": True, "updated_at": utc_now()}},
    )
    if result.matched_count == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The account could not be verified.",
        )
    return AuthMessage(message="Email verified.")


@router.post("/login", response_model=AccessTokenResponse)
def login(
    payload: LoginRequest,
    database: Database = Depends(get_database),
) -> AccessTokenResponse:
    """Authenticate a verified account and issue a short-lived bearer token."""
    _require_auth_configuration()
    lookup = (
        {"email": payload.identifier}
        if "@" in payload.identifier
        else {"username": payload.identifier}
    )
    user = database.users.find_one(lookup)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="We couldn't find an account with that username or email. New user? Register now.",
        )
    password_hash = user.get("password_hash", "")
    try:
        password_matches = verify_password(payload.password, password_hash)
    except (UnknownHashError, ValueError):
        password_matches = False

    if not password_matches:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Password is incorrect.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.get("email_verified", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "email_unverified",
                "message": "This account's email is not verified.",
                "email_hint": _mask_email(user["email"]),
            },
        )

    return _issue_session(user["_id"], database)


@router.post("/refresh", response_model=AccessTokenResponse)
def refresh_session(
    payload: RefreshSessionRequest,
    database: Database = Depends(get_database),
) -> AccessTokenResponse:
    """Rotate a single-use refresh token and issue a fresh access token."""
    _require_auth_configuration()
    now = utc_now()
    stored = database.refresh_tokens.find_one_and_delete({
        "token_hash": hash_refresh_token(payload.refresh_token),
        "expires_at": {"$gt": now},
    })
    if stored is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh session expired. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = database.users.find_one({"_id": stored["user_id"], "email_verified": True})
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh session is no longer valid. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _issue_session(user["_id"], database)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    payload: RefreshSessionRequest,
    database: Database = Depends(get_database),
) -> None:
    """Revoke the current refresh session; expired or reused tokens are harmless."""
    database.refresh_tokens.delete_one({"token_hash": hash_refresh_token(payload.refresh_token)})
    return None


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    database: Database = Depends(get_database),
) -> dict:
    """Resolve a required bearer token to its MongoDB user document."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if len(settings.jwt_secret) < 32:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication is not configured.",
        )
    subject = decode_access_token(credentials.credentials)
    try:
        user = database.users.find_one({"_id": ObjectId(subject)}) if subject else None
    except (ValueError, TypeError):
        user = None

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


@router.get("/me", response_model=UserResponse)
def read_current_user(user: dict = Depends(get_current_user)) -> UserResponse:
    return _public_user(user)
    PasswordChangeRequest,
    ProfileUpdateRequest,


@router.patch("/me", response_model=UserResponse)
def update_profile(
    payload: ProfileUpdateRequest,
    user: dict = Depends(get_current_user),
    database: Database = Depends(get_database),
) -> UserResponse:
    changes = {
        "first_name": payload.first_name,
        "last_name": payload.last_name,
        "name": f"{payload.first_name} {payload.last_name}",
        "username": payload.username,
        "updated_at": utc_now(),
    }
    try:
        database.users.update_one({"_id": user["_id"]}, {"$set": changes})
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="That username is already taken.") from exc
    return _public_user({**user, **changes})


@router.post("/me/email-change", response_model=AuthMessage, status_code=status.HTTP_202_ACCEPTED)
def request_email_change(
    payload: EmailChangeRequest,
    user: dict = Depends(get_current_user),
    database: Database = Depends(get_database),
) -> AuthMessage:
    _require_auth_configuration(email=True)
    if payload.email == user["email"]:
        raise HTTPException(status_code=400, detail="That is already your account email.")
    if database.users.find_one({"email": payload.email, "_id": {"$ne": user["_id"]}}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="An account already uses that email.")
    try:
        sent = send_verification_email(
            database,
            user,
            recipient_email=payload.email,
            purpose="email_change",
            pending_email=payload.email,
        )
    except EmailDeliveryError as exc:
        raise HTTPException(status_code=502, detail="Could not send the verification email. Please try again.") from exc
    if not sent:
        pending = database.email_verifications.find_one({"user_id": user["_id"], "purpose": "email_change"}, {"pending_email": 1})
        if pending and pending.get("pending_email") != payload.email:
            raise HTTPException(status_code=429, detail="A verification code was recently sent to another address. Wait briefly before requesting a code for this one.")
    return AuthMessage(message="A verification code was sent to the new email address." if sent else "A verification code was sent recently. Check your new email or try again shortly.")


@router.post("/me/email-change/verify", response_model=UserResponse)
def verify_email_change(
    payload: EmailCodeRequest,
    user: dict = Depends(get_current_user),
    database: Database = Depends(get_database),
) -> UserResponse:
    code_hash = hash_email_verification_code(payload.code)
    verification = database.email_verifications.find_one_and_update(
        {"user_id": user["_id"], "purpose": "email_change", "expires_at": {"$gt": utc_now()}, "attempt_count": {"$lt": 5}},
        {"$inc": {"attempt_count": 1}},
        return_document=ReturnDocument.AFTER,
    )
    if verification is None or not hmac.compare_digest(code_hash, verification["code_hash"]):
        raise HTTPException(status_code=400, detail="The code is invalid, expired, or the attempt limit was reached.")
    new_email = verification.get("pending_email")
    if not new_email:
        raise HTTPException(status_code=400, detail="The email change request is invalid. Request a new code.")
    try:
        result = database.users.update_one(
            {"_id": user["_id"], "email": user["email"]},
            {"$set": {"email": new_email, "email_verified": True, "updated_at": utc_now()}},
        )
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="An account already uses that email.") from exc
    database.email_verifications.delete_one({"_id": verification["_id"]})
    if result.matched_count == 0:
        raise HTTPException(status_code=409, detail="Your account email changed in another session. Reload your profile.")
    return _public_user({**user, "email": new_email, "email_verified": True})


@router.post("/me/password", response_model=AuthMessage)
def change_password(
    payload: PasswordChangeRequest,
    user: dict = Depends(get_current_user),
    database: Database = Depends(get_database),
) -> AuthMessage:
    try:
        matches = verify_password(payload.current_password, user.get("password_hash", ""))
    except (UnknownHashError, ValueError):
        matches = False
    if not matches:
        raise HTTPException(status_code=400, detail="Current password is incorrect.")
    database.users.update_one({"_id": user["_id"]}, {"$set": {"password_hash": hash_password(payload.new_password), "updated_at": utc_now()}})
    database.refresh_tokens.delete_many({"user_id": user["_id"], "token_hash": {"$ne": hash_refresh_token(payload.current_refresh_token)}})
    return AuthMessage(message="Password updated. Other signed-in devices were signed out.")


@router.post("/me/avatar", response_model=UserResponse)
async def upload_avatar(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
    database: Database = Depends(get_database),
) -> UserResponse:
    if not r2_storage.is_configured():
        raise HTTPException(status_code=503, detail="Cloudflare R2 is not configured.")
    image_types = {"image/jpeg": ("jpg", lambda data: data.startswith(b"\xff\xd8\xff")), "image/png": ("png", lambda data: data.startswith(b"\x89PNG\r\n\x1a\n")), "image/webp": ("webp", lambda data: len(data) > 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"), "image/gif": ("gif", lambda data: data.startswith((b"GIF87a", b"GIF89a")))}
    if file.content_type not in image_types:
        raise HTTPException(status_code=415, detail="Choose a JPEG, PNG, WebP, or GIF profile picture.")
    data = await file.read(settings.r2_max_upload_bytes + 1)
    if not data or len(data) > min(settings.r2_max_upload_bytes, 5 * 1024 * 1024):
        raise HTTPException(status_code=413, detail="Profile pictures must be smaller than 5 MB.")
    extension, validate = image_types[file.content_type]
    if not validate(data):
        raise HTTPException(status_code=415, detail="The selected file does not match its image type.")
    key = f"users/{user['_id']}/profile/{uuid.uuid4().hex}.{extension}"
    try:
        await run_in_threadpool(r2_storage.put_object, key, data, file.content_type)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Could not upload the profile picture.") from exc
    old_key = user.get("avatar_key")
    updated_at = utc_now()
    database.users.update_one({"_id": user["_id"]}, {"$set": {"avatar_key": key, "updated_at": updated_at}})
    if old_key:
        try:
            await run_in_threadpool(r2_storage.delete_object, old_key)
        except Exception:
            pass
    return _public_user({**user, "avatar_key": key, "updated_at": updated_at})


@router.delete("/me/avatar", response_model=UserResponse)
async def delete_avatar(
    user: dict = Depends(get_current_user),
    database: Database = Depends(get_database),
) -> UserResponse:
    old_key = user.get("avatar_key")
    updated_at = utc_now()
    database.users.update_one({"_id": user["_id"]}, {"$unset": {"avatar_key": ""}, "$set": {"updated_at": updated_at}})
    if old_key:
        try:
            await run_in_threadpool(r2_storage.delete_object, old_key)
        except Exception:
            pass
    return _public_user({**user, "avatar_key": None, "updated_at": updated_at})


@router.get("/me/avatar")
async def read_avatar(user: dict = Depends(get_current_user)):
    key = user.get("avatar_key")
    if not key:
        raise HTTPException(status_code=404, detail="No profile picture is set.")
    try:
        result = await run_in_threadpool(r2_storage.get_object, key)
    except Exception as exc:
        raise HTTPException(status_code=404, detail="Profile picture not found.") from exc
    return StreamingResponse(result["Body"], media_type=result.get("ContentType", "application/octet-stream"), headers={"Cache-Control": "private, max-age=300"})
