"""Authenticated direct-message APIs and local WebSocket fan-out."""

import asyncio
import re
from collections import defaultdict
from datetime import datetime

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from pymongo.database import Database
from pymongo.errors import DuplicateKeyError

from app.api.auth import get_current_user
from app.db import get_database, utc_now
from app.models.documents import ConversationDocument, MessageDocument
from app.schemas.messaging import (
    ConversationResponse,
    CreateMessageRequest,
    DirectConversationRequest,
    LastMessageSummary,
    MessageResponse,
    UserSearchResponse,
    UserSummary,
)
from app.security import decode_access_token
from app.settings import settings

router = APIRouter(tags=["messaging"])


class ConversationConnectionManager:
    """Keep development WebSockets by conversation and fan out saved messages."""

    def __init__(self) -> None:
        self.connections: dict[str, set[WebSocket]] = defaultdict(set)
        self.event_loop: asyncio.AbstractEventLoop | None = None

    async def connect(self, conversation_id: str, websocket: WebSocket) -> None:
        self.event_loop = asyncio.get_running_loop()
        await websocket.accept(subprotocol="teamflow")
        self.connections[conversation_id].add(websocket)

    def disconnect(self, conversation_id: str, websocket: WebSocket) -> None:
        self.connections[conversation_id].discard(websocket)
        if not self.connections[conversation_id]:
            self.connections.pop(conversation_id, None)

    async def broadcast(self, conversation_id: str, event: dict) -> None:
        for websocket in tuple(self.connections.get(conversation_id, ())):
            try:
                await websocket.send_json(event)
            except (RuntimeError, WebSocketDisconnect):
                self.disconnect(conversation_id, websocket)

    def publish(self, conversation_id: str, event: dict) -> None:
        loop = self.event_loop
        if loop is not None and loop.is_running():
            asyncio.run_coroutine_threadsafe(self.broadcast(conversation_id, event), loop)


connections = ConversationConnectionManager()


def _user_summary(user: dict) -> UserSummary:
    name = user.get("name", "TeamFlow user")
    parts = name.split(maxsplit=1)
    first_name = user.get("first_name") or parts[0]
    last_name = user.get("last_name") or (parts[1] if len(parts) > 1 else "")
    return UserSummary(
        id=str(user["_id"]),
        username=user.get("username", ""),
        first_name=first_name,
        last_name=last_name,
        name=f"{first_name} {last_name}".strip(),
    )


def _serialize_conversations(
    database: Database, conversations: list[dict]
) -> list[ConversationResponse]:
    user_ids: set[ObjectId] = set()
    for conversation in conversations:
        user_ids.update(conversation["participant_ids"])
        last_message = conversation.get("last_message")
        if last_message:
            user_ids.add(last_message["sender_id"])
    users = {
        user["_id"]: _user_summary(user)
        for user in database.users.find({"_id": {"$in": list(user_ids)}})
    }

    serialized = []
    for conversation in conversations:
        preview = conversation.get("last_message")
        sender = users.get(preview["sender_id"]) if preview else None
        serialized.append(
            ConversationResponse(
                id=str(conversation["_id"]),
                type=conversation["type"],
                participants=[
                    users[user_id]
                    for user_id in conversation["participant_ids"]
                    if user_id in users
                ],
                last_message=(
                    LastMessageSummary(
                        body=preview["body"],
                        sender=sender,
                        created_at=preview["created_at"],
                    )
                    if preview and sender
                    else None
                ),
                created_at=conversation["created_at"],
                updated_at=conversation["updated_at"],
            )
        )
    return serialized


def _serialize_messages(database: Database, messages: list[dict]) -> list[MessageResponse]:
    sender_ids = {message["sender_id"] for message in messages}
    senders = {
        user["_id"]: _user_summary(user)
        for user in database.users.find({"_id": {"$in": list(sender_ids)}})
    }
    return [
        MessageResponse(
            id=str(message["_id"]),
            conversation_id=str(message["conversation_id"]),
            sender=senders[message["sender_id"]],
            body=message["body"],
            message_type=message.get("message_type", "text"),
            created_at=message["created_at"],
        )
        for message in messages
        if message["sender_id"] in senders
    ]


def _get_member_conversation(
    database: Database, conversation_id: str, user_id: ObjectId
) -> dict:
    try:
        object_id = ObjectId(conversation_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=404, detail="Conversation not found.")
    conversation = database.conversations.find_one(
        {"_id": object_id, "participant_ids": user_id}
    )
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return conversation


@router.get("/users/search", response_model=UserSearchResponse)
def search_users(
    q: str = Query(min_length=2, max_length=50),
    user: dict = Depends(get_current_user),
    database: Database = Depends(get_database),
) -> UserSearchResponse:
    """Find verified workspace members by username or name."""
    pattern = re.escape(q.strip().removeprefix("@").casefold())
    found = database.users.find(
        {
            "_id": {"$ne": user["_id"]},
            "email_verified": True,
            "username": {"$type": "string"},
            "$or": [
                {"username": {"$regex": pattern, "$options": "i"}},
                {"first_name": {"$regex": pattern, "$options": "i"}},
                {"last_name": {"$regex": pattern, "$options": "i"}},
                {"name": {"$regex": pattern, "$options": "i"}},
            ],
        }
    ).limit(20)
    return UserSearchResponse(users=[_user_summary(record) for record in found])


@router.post(
    "/conversations/direct",
    response_model=ConversationResponse,
    status_code=status.HTTP_200_OK,
)
def create_direct_conversation(
    payload: DirectConversationRequest,
    user: dict = Depends(get_current_user),
    database: Database = Depends(get_database),
) -> ConversationResponse:
    """Return the existing one-to-one thread or create it idempotently."""
    other_user = database.users.find_one(
        {"username": payload.username, "email_verified": True}
    )
    if other_user is None:
        raise HTTPException(status_code=404, detail="No verified user has that username.")
    if other_user["_id"] == user["_id"]:
        raise HTTPException(status_code=400, detail="You cannot start a chat with yourself.")

    participant_ids = sorted([user["_id"], other_user["_id"]], key=str)
    direct_key = ":".join(str(participant_id) for participant_id in participant_ids)
    conversation = database.conversations.find_one({"direct_key": direct_key})
    if conversation is None:
        now = utc_now()
        new_conversation: ConversationDocument = {
            "type": "direct",
            "participant_ids": participant_ids,
            "direct_key": direct_key,
            "created_at": now,
            "updated_at": now,
            "last_message": None,
        }
        try:
            result = database.conversations.insert_one(new_conversation)
            new_conversation["_id"] = result.inserted_id
            conversation = new_conversation
        except DuplicateKeyError:
            conversation = database.conversations.find_one({"direct_key": direct_key})

    if conversation is None:
        raise HTTPException(status_code=503, detail="Could not open the conversation.")
    return _serialize_conversations(database, [conversation])[0]


@router.get("/conversations", response_model=list[ConversationResponse])
def list_conversations(
    user: dict = Depends(get_current_user),
    database: Database = Depends(get_database),
) -> list[ConversationResponse]:
    """List the current user's direct conversations, newest activity first."""
    conversations = list(
        database.conversations.find({"participant_ids": user["_id"]})
        .sort("updated_at", -1)
        .limit(100)
    )
    return _serialize_conversations(database, conversations)


@router.get(
    "/conversations/{conversation_id}/messages",
    response_model=list[MessageResponse],
)
def list_messages(
    conversation_id: str,
    before: datetime | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    user: dict = Depends(get_current_user),
    database: Database = Depends(get_database),
) -> list[MessageResponse]:
    """Load a page of a conversation's history for one of its members."""
    conversation = _get_member_conversation(database, conversation_id, user["_id"])
    criteria = {"conversation_id": conversation["_id"]}
    if before is not None:
        criteria["created_at"] = {"$lt": before}
    messages = list(
        database.messages.find(criteria).sort("created_at", -1).limit(limit)
    )
    messages.reverse()
    return _serialize_messages(database, messages)


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=MessageResponse,
    status_code=status.HTTP_201_CREATED,
)
def send_message(
    conversation_id: str,
    payload: CreateMessageRequest,
    user: dict = Depends(get_current_user),
    database: Database = Depends(get_database),
) -> MessageResponse:
    """Persist a text message, update the conversation preview, then fan it out."""
    conversation = _get_member_conversation(database, conversation_id, user["_id"])
    now = utc_now()
    message: MessageDocument = {
        "conversation_id": conversation["_id"],
        "sender_id": user["_id"],
        "body": payload.body,
        "message_type": "text",
        "created_at": now,
    }
    result = database.messages.insert_one(message)
    message["_id"] = result.inserted_id
    database.conversations.update_one(
        {"_id": conversation["_id"]},
        {
            "$set": {
                "updated_at": now,
                "last_message": {
                    "body": payload.body,
                    "sender_id": user["_id"],
                    "created_at": now,
                },
            }
        },
    )
    response = _serialize_messages(database, [message])[0]
    connections.publish(
        str(conversation["_id"]),
        {"type": "message", "message": response.model_dump(mode="json")},
    )
    return response


@router.websocket("/ws/conversations/{conversation_id}")
async def conversation_socket(websocket: WebSocket, conversation_id: str) -> None:
    """Authenticate using a WebSocket subprotocol and stream new messages."""
    protocol_items = websocket.headers.get("sec-websocket-protocol", "").split(",")
    protocols = [item.strip() for item in protocol_items]
    bearer = next(
        (item.removeprefix("bearer.") for item in protocols if item.startswith("bearer.")),
        None,
    )
    database = getattr(websocket.app.state, "database", None)
    subject = decode_access_token(bearer) if bearer and len(settings.jwt_secret) >= 32 else None
    if database is None or subject is None or "teamflow" not in protocols:
        await websocket.close(code=1008)
        return

    try:
        user_id = ObjectId(subject)
        conversation_object_id = ObjectId(conversation_id)
    except (TypeError, ValueError):
        await websocket.close(code=1008)
        return

    is_member = database.conversations.find_one(
        {"_id": conversation_object_id, "participant_ids": user_id}, {"_id": 1}
    )
    if is_member is None:
        await websocket.close(code=1008)
        return

    room_id = str(conversation_object_id)
    await connections.connect(room_id, websocket)
    try:
        while True:
            event = await websocket.receive_json()
            if isinstance(event, dict) and event.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        connections.disconnect(room_id, websocket)
