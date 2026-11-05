"""Request and response schemas for directory, conversations, and messages."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class UserSummary(BaseModel):
    id: str
    username: str = ""
    first_name: str
    last_name: str
    name: str
    online: bool = False
    last_seen_at: datetime | None = None


class LastMessageSummary(BaseModel):
    body: str
    sender: UserSummary
    created_at: datetime


class ConversationResponse(BaseModel):
    id: str
    type: Literal["direct", "group"]
    participants: list[UserSummary]
    last_message: LastMessageSummary | None = None
    created_at: datetime
    updated_at: datetime


class DirectConversationRequest(BaseModel):
    username: str = Field(min_length=3, max_length=24, pattern=r"^[a-z0-9_]+$")

    @field_validator("username", mode="before")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        return str(value).strip().casefold().removeprefix("@")


class CreateMessageRequest(BaseModel):
    body: str = Field(min_length=1, max_length=4000)

    @field_validator("body")
    @classmethod
    def trim_body(cls, value: str) -> str:
        body = value.strip()
        if not body:
            raise ValueError("Message cannot be blank.")
        return body


class MessageResponse(BaseModel):
    id: str
    conversation_id: str
    sender: UserSummary
    body: str
    message_type: Literal["text"] = "text"
    created_at: datetime
    read: bool = False


class UserSearchResponse(BaseModel):
    users: list[UserSummary]


class CallLogResponse(BaseModel):
    id: str
    conversation_id: str
    peer: UserSummary
    call_kind: Literal["audio", "video"]
    direction: Literal["incoming", "outgoing"]
    status: Literal["ringing", "ongoing", "completed", "missed", "declined", "busy", "cancelled"]
    started_at: datetime
    connected_at: datetime | None = None
    ended_at: datetime | None = None
    duration_seconds: int | None = None
