"""Validated registration/login payloads and public auth responses."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator


class RegisterRequest(BaseModel):
    first_name: str = Field(min_length=1, max_length=50)
    last_name: str = Field(min_length=1, max_length=50)
    username: str = Field(min_length=3, max_length=24, pattern=r"^[a-z0-9_]+$")
    email: EmailStr
    gender: Literal["female", "male", "non_binary", "other", "prefer_not_to_say"]
    password: str = Field(min_length=8, max_length=128)

    @field_validator("first_name", "last_name")
    @classmethod
    def normalize_name_part(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Name fields cannot be blank.")
        return normalized

    @field_validator("username", mode="before")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        return str(value).strip().casefold().removeprefix("@")

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        return str(value).strip().casefold()


class LoginRequest(BaseModel):
    identifier: str = Field(min_length=1, max_length=320)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("identifier")
    @classmethod
    def normalize_identifier(cls, value: str) -> str:
        normalized = str(value).strip().casefold()
        return normalized if "@" in normalized else normalized.removeprefix("@")


class IdentifierRequest(BaseModel):
    identifier: str = Field(min_length=1, max_length=320)

    @field_validator("identifier")
    @classmethod
    def normalize_identifier(cls, value: str) -> str:
        normalized = str(value).strip().casefold()
        return normalized if "@" in normalized else normalized.removeprefix("@")


class VerifyEmailRequest(BaseModel):
    identifier: str = Field(min_length=1, max_length=320)
    code: str = Field(pattern=r"^[0-9]{6}$")

    @field_validator("identifier")
    @classmethod
    def normalize_identifier(cls, value: str) -> str:
        normalized = str(value).strip().casefold()
        return normalized if "@" in normalized else normalized.removeprefix("@")


class AuthMessage(BaseModel):
    message: str
    email_hint: str | None = None


class AccessTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    refresh_token: str
    refresh_expires_in: int


class RefreshSessionRequest(BaseModel):
    refresh_token: str = Field(min_length=40, max_length=256)


class UserResponse(BaseModel):
    id: str
    name: str
    username: str
    first_name: str
    last_name: str
    email: EmailStr
    email_verified: bool
    created_at: datetime
    gender: str | None = None
    avatar_url: str | None = None


class ProfileUpdateRequest(BaseModel):
    first_name: str = Field(min_length=1, max_length=50)
    last_name: str = Field(min_length=1, max_length=50)
    username: str = Field(min_length=3, max_length=24, pattern=r"^[a-z0-9_]+$")

    @field_validator("first_name", "last_name")
    @classmethod
    def normalize_name_part(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Name fields cannot be blank.")
        return normalized

    @field_validator("username", mode="before")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        return str(value).strip().casefold().removeprefix("@")


class EmailChangeRequest(BaseModel):
    email: EmailStr

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        return str(value).strip().casefold()


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)
    current_refresh_token: str = Field(min_length=40, max_length=256)


class EmailCodeRequest(BaseModel):
    code: str = Field(pattern=r"^[0-9]{6}$")
