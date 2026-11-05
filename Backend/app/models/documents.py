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


class MessageDocument(TypedDict):
    _id: NotRequired[ObjectId]
    conversation_id: ObjectId
    sender_id: ObjectId
    body: str
    message_type: str
    created_at: datetime


class EmailVerificationDocument(TypedDict):
    user_id: ObjectId
    code_hash: str
    expires_at: datetime
    created_at: datetime
    last_sent_at: datetime
    attempt_count: int
