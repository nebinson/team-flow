"""MongoDB connection lifecycle, indexes, and request-scoped database access."""

from datetime import datetime, timezone

from fastapi import HTTPException, Request
from pymongo import ASCENDING, MongoClient
from pymongo.database import Database

from app.settings import settings


def initialize_database() -> tuple[MongoClient | None, Database | None]:
    if not settings.mongodb_uri:
        return None, None

    client = MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=5000, tz_aware=True)
    try:
        client.admin.command("ping")
        database = client[settings.mongodb_database]

        database.users.create_index(
            [("email", ASCENDING)], unique=True, name="users_email_unique"
        )
        database.users.create_index(
            [("username", ASCENDING)],
            unique=True,
            partialFilterExpression={"username": {"$type": "string"}},
            name="users_username_unique",
        )
        database.email_verifications.create_index(
            [("user_id", ASCENDING)], unique=True, name="email_verifications_user_unique"
        )
        database.refresh_tokens.create_index(
            [("token_hash", ASCENDING)], unique=True, name="refresh_tokens_hash_unique"
        )
        database.refresh_tokens.create_index(
            [("expires_at", ASCENDING)], expireAfterSeconds=0, name="refresh_tokens_expiry"
        )
        database.conversations.create_index(
            [("direct_key", ASCENDING)],
            unique=True,
            partialFilterExpression={"type": "direct"},
            name="conversations_direct_key_unique",
        )
        database.conversations.create_index(
            [("participant_ids", ASCENDING), ("updated_at", -1)],
            name="conversations_participants_updated",
        )
        database.friendships.create_index(
            [("pair_key", ASCENDING)], unique=True, name="friendships_pair_unique"
        )
        database.friendships.create_index(
            [("recipient_id", ASCENDING), ("status", ASCENDING), ("created_at", -1)],
            name="friendships_incoming_requests",
        )
        database.friendships.create_index(
            [("sender_id", ASCENDING), ("status", ASCENDING), ("created_at", -1)],
            name="friendships_outgoing_requests",
        )
        database.messages.create_index(
            [("conversation_id", ASCENDING), ("created_at", -1)],
            name="messages_conversation_created",
        )
        database.messages.create_index(
            [("conversation_id", ASCENDING), ("sender_id", ASCENDING), ("client_message_id", ASCENDING)],
            unique=True,
            partialFilterExpression={"client_message_id": {"$type": "string"}},
            name="messages_client_idempotency_unique",
        )
        database.call_logs.create_index([("call_id", ASCENDING)], unique=True, name="call_logs_call_id_unique")
        database.call_logs.create_index([("participant_ids", ASCENDING), ("started_at", -1)], name="call_logs_participants_started")
        database.ai_chats.create_index([("user_id", ASCENDING)], unique=True, name="ai_chats_user_unique")
        database.ai_chat_messages.create_index(
            [("chat_id", ASCENDING), ("created_at", ASCENDING)],
            name="ai_chat_messages_chat_created",
        )
        database.email_verifications.create_index(
            [("expires_at", ASCENDING)],
            expireAfterSeconds=0,
            name="email_verifications_expiry",
        )
        return client, database
    except Exception:
        client.close()
        raise


def get_database(request: Request) -> Database:
    database = getattr(request.app.state, "database", None)
    if database is None:
        raise HTTPException(status_code=503, detail="Database is not configured.")
    return database


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
