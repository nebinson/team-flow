"""Typed document shapes stored in MongoDB collections."""

from datetime import datetime
from typing import NotRequired, TypedDict

from bson import ObjectId


class UserDocument(TypedDict):
    _id: NotRequired[ObjectId]
    name: str
    username: NotRequired[str]
    first_name: NotRequired[str]
    last_name: NotRequired[str]
    gender: NotRequired[str]
    email: str
    password_hash: str
    email_verified: bool
    created_at: datetime
    updated_at: datetime


class ConversationDocument(TypedDict):
    _id: NotRequired[ObjectId]
    type: str
    participant_ids: list[ObjectId]
    direct_key: str
    created_at: datetime
    updated_at: datetime
    last_message: dict | None
    last_read_at: NotRequired[dict[str, datetime]]


class MessageDocument(TypedDict):
    _id: NotRequired[ObjectId]
    conversation_id: ObjectId
    sender_id: ObjectId
    body: str
    message_type: str
    created_at: datetime
    sentiment: NotRequired[str]


class CallLogDocument(TypedDict):
    _id: NotRequired[ObjectId]
    call_id: str
    conversation_id: ObjectId
    participant_ids: list[ObjectId]
    caller_id: ObjectId
    callee_id: ObjectId
    call_kind: str
    status: str
    started_at: datetime
    connected_at: datetime | None
    ended_at: datetime | None


class EmailVerificationDocument(TypedDict):
    user_id: ObjectId
    code_hash: str
    expires_at: datetime
    created_at: datetime
    last_sent_at: datetime
    attempt_count: int


class RefreshTokenDocument(TypedDict):
    _id: NotRequired[ObjectId]
    token_hash: str
    user_id: ObjectId
    created_at: datetime
    expires_at: datetime


class AiChatDocument(TypedDict):
    _id: NotRequired[ObjectId]
    user_id: ObjectId
    created_at: datetime
    updated_at: datetime


class AiChatMessageDocument(TypedDict):
    _id: NotRequired[ObjectId]
    chat_id: ObjectId
    role: str
    content: str
    created_at: datetime
    provider: NotRequired[str]
