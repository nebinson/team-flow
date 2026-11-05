import jwt
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pwdlib.exceptions import UnknownHashError
from pymongo.database import Database
from pymongo.errors import DuplicateKeyError

from app.db import get_database, utc_now
from app.models.documents import UserDocument
from app.schemas.auth import (
    AccessTokenResponse,
    AuthMessage,
    EmailRequest,
    LoginRequest,
    RegisterRequest,
    UserResponse,
    VerifyEmailRequest,
)
from app.security import (
    create_access_token,
    hash_email_verification_token,
    hash_password,
    verify_password,
)
from app.services.email_verification import (
    EmailDeliveryError,
    email_verification_is_configured,
    send_verification_email,
)
from app.settings import settings

router = APIRouter(prefix="/auth", tags=["authentication"])
_DUMMY_PASSWORD_HASH = hash_password("not-a-real-teamflow-password")
_bearer = HTTPBearer(auto_error=False)
_REGISTRATION_MESSAGE = (
    "If this address can be registered, a verification email will be sent."
)


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
    return UserResponse(
        id=str(user["_id"]),
        name=user["name"],
        email=user["email"],
        email_verified=user["email_verified"],
        created_at=user["created_at"],
    )


def _send_verification(database: Database, user: dict) -> None:
    try:
        send_verification_email(database, user)
    except EmailDeliveryError:
        # Keep the response indistinguishable for existing and unknown email addresses.
        return


@router.post(
    "/register",
    response_model=AuthMessage,
    status_code=status.HTTP_202_ACCEPTED,
)
def register(payload: RegisterRequest, database: Database = Depends(get_database)) -> AuthMessage:
    _require_auth_configuration(email=True)
    now = utc_now()
    user = database.users.find_one({"email": payload.email})

    if user is None:
        user: UserDocument = {
            "name": payload.name,
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
            user = database.users.find_one({"email": payload.email})

    if user and not user.get("email_verified", False):
        _send_verification(database, user)

    return AuthMessage(message=_REGISTRATION_MESSAGE)


@router.post(
    "/resend-verification",
    response_model=AuthMessage,
    status_code=status.HTTP_202_ACCEPTED,
)
def resend_verification(
    payload: EmailRequest, database: Database = Depends(get_database)
) -> AuthMessage:
    _require_auth_configuration(email=True)
    user = database.users.find_one({"email": payload.email})
    if user and not user.get("email_verified", False):
        _send_verification(database, user)
    return AuthMessage(message=_REGISTRATION_MESSAGE)


@router.post("/verify-email", response_model=AuthMessage)
def verify_email(
    payload: VerifyEmailRequest, database: Database = Depends(get_database)
) -> AuthMessage:
    token_hash = hash_email_verification_token(payload.token)
    verification = database.email_verifications.find_one_and_delete(
        {"token_hash": token_hash, "expires_at": {"$gt": utc_now()}}
    )
    if verification is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The verification link is invalid or has expired.",
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
    return AuthMessage(message="Email verified. You can now sign in.")


@router.post("/login", response_model=AccessTokenResponse)
def login(
    payload: LoginRequest,
    database: Database = Depends(get_database),
) -> AccessTokenResponse:
    _require_auth_configuration()
    user = database.users.find_one({"email": payload.email})
    password_hash = (
        user.get("password_hash", _DUMMY_PASSWORD_HASH)
        if user
        else _DUMMY_PASSWORD_HASH
    )
    try:
        password_matches = verify_password(payload.password, password_hash)
    except (UnknownHashError, ValueError):
        password_matches = False

    if not user or not password_matches:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email or password is incorrect.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.get("email_verified", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Verify your email before signing in.",
        )

    token = create_access_token(str(user["_id"]))
    return AccessTokenResponse(
        access_token=token,
        expires_in=settings.access_token_minutes * 60,
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    database: Database = Depends(get_database),
) -> dict:
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
    try:
        claims = jwt.decode(
            credentials.credentials,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
            options={"require": ["exp", "sub"]},
        )
        user = database.users.find_one({"_id": ObjectId(claims["sub"])})
    except (jwt.InvalidTokenError, ValueError, TypeError):
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
