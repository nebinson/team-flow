from datetime import datetime
from typing import NotRequired, TypedDict

from bson import ObjectId


class UserDocument(TypedDict):
    _id: NotRequired[ObjectId]
    name: str
    email: str
    password_hash: str
    email_verified: bool
    created_at: datetime
    updated_at: datetime


class EmailVerificationDocument(TypedDict):
    user_id: ObjectId
    token_hash: str
    expires_at: datetime
    created_at: datetime
    last_sent_at: datetime
