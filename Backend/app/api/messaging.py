"""Authenticated direct-message APIs and local WebSocket fan-out."""

import asyncio
import io
import json
import logging
import re
import zipfile
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen
from collections import defaultdict
from datetime import datetime
from pathlib import PurePosixPath
from uuid import uuid4

from bson import ObjectId
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect, status
from pymongo.database import Database
from pymongo.errors import DuplicateKeyError
from starlette.concurrency import run_in_threadpool
from starlette.responses import StreamingResponse

from app.api.auth import get_current_user
from app.db import get_database, utc_now
from app.models.documents import ConversationDocument, MessageDocument
from app.schemas.messaging import (
    ConversationResponse,
    CallLogResponse,
    CreateMessageRequest,
    DirectConversationRequest,
    FriendRequestResponse,
    GroupConversationRequest,
    FriendRequestsResponse,
    LastMessageSummary,
    MessageAttachmentResponse,
    MessageResponse,
    PeopleResponse,
    PersonEntry,
    UserSearchResponse,
    UserSummary,
)
from app.security import decode_access_token
from app.services import r2_storage
from app.services.sentiment import predict_sentiment, predict_sentiments
from app.settings import settings

router = APIRouter(tags=["messaging"])
logger = logging.getLogger(__name__)
_CALL_SIGNAL_TYPES = {"call_offer", "call_answer", "call_ice", "call_reject", "call_end", "call_busy", "call_missed"}
_IMAGE_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp"}
_DOCUMENT_TYPES = {
    ".pdf": "application/pdf", ".txt": "text/plain", ".csv": "text/csv", ".md": "text/markdown",
    ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}
_VOICE_TYPES = {".webm": "audio/webm", ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac"}


@router.get("/calls/ice-servers")
def get_call_ice_servers(user: dict = Depends(get_current_user)) -> dict:
    """Return short-lived Cloudflare TURN credentials for an authenticated call."""
    del user  # Authentication is the permission check for ephemeral call credentials.
    if not settings.cloudflare_turn_key_id or not settings.cloudflare_turn_key_token:
        try:
            servers = json.loads(settings.ice_servers_json)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=503, detail="Call networking is not configured.") from exc
        return {"ice_servers": servers}

    ttl = max(300, min(settings.cloudflare_turn_credential_ttl, 172800))
    endpoint = (
        "https://rtc.live.cloudflare.com/v1/turn/keys/"
        f"{quote(settings.cloudflare_turn_key_id, safe='')}/credentials/generate-ice-servers"
    )
    request = Request(
        endpoint,
        data=json.dumps({"ttl": ttl}).encode(),
        headers={
            "Authorization": f"Bearer {settings.cloudflare_turn_key_token}",
            "Content-Type": "application/json",
            # Cloudflare returns 1010 for urllib's default Python-urllib User-Agent.
            "User-Agent": "TeamFlow-Backend/0.1",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=8) as response:
            payload = json.loads(response.read())
    except HTTPError as exc:
        body = exc.read(512).decode("utf-8", "replace")
        provider_error = re.search(r"error code:\s*(\d+)", body, re.IGNORECASE)
        provider_code = f", Cloudflare error {provider_error.group(1)}" if provider_error else ""
        logger.warning(
            "Cloudflare TURN credential generation rejected the request (HTTP %s%s).",
            exc.code,
            provider_code,
        )
        raise HTTPException(
            status_code=502,
            detail=f"Cloudflare denied TURN credential generation (HTTP {exc.code}{provider_code}).",
        ) from exc
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        logger.warning("Could not complete the Cloudflare TURN credential request (%s).", type(exc).__name__)
        raise HTTPException(status_code=502, detail="Could not obtain call network credentials.") from exc
    ice_servers = payload.get("iceServers")
    if not isinstance(ice_servers, list) or not ice_servers:
        raise HTTPException(status_code=502, detail="Cloudflare returned invalid call network credentials.")
    return {"ice_servers": ice_servers}


class ConversationConnectionManager:
    """Track signed-in users and fan out presence and chat events in-process."""

    def __init__(self) -> None:
        self.connections: dict[str, set[WebSocket]] = defaultdict(set)
        self.focused_connections: dict[str, set[WebSocket]] = defaultdict(set)
        self.event_loop: asyncio.AbstractEventLoop | None = None

    async def connect(self, user_id: str, websocket: WebSocket) -> bool:
        self.event_loop = asyncio.get_running_loop()
        await websocket.accept(subprotocol="teamflow")
        was_offline = not self.focused_connections[user_id]
        self.connections[user_id].add(websocket)
        self.focused_connections[user_id].add(websocket)
        return was_offline

    def disconnect(self, user_id: str, websocket: WebSocket) -> bool:
        was_online = self.is_online(user_id)
        self.connections[user_id].discard(websocket)
        self.focused_connections[user_id].discard(websocket)
        if not self.focused_connections[user_id]:
            self.focused_connections.pop(user_id, None)
        if not self.connections[user_id]:
            self.connections.pop(user_id, None)
        return was_online and not self.is_online(user_id)

    def set_focused(self, user_id: str, websocket: WebSocket, focused: bool) -> bool | None:
        if websocket not in self.connections.get(user_id, set()):
            return None
        was_online = self.is_online(user_id)
        if focused:
            self.focused_connections[user_id].add(websocket)
        else:
            self.focused_connections[user_id].discard(websocket)
            if not self.focused_connections[user_id]:
                self.focused_connections.pop(user_id, None)
        is_online = self.is_online(user_id)
        return is_online if is_online != was_online else None

    def is_online(self, user_id: str) -> bool:
        return bool(self.focused_connections.get(user_id))

    async def broadcast(self, user_ids: list[str], event: dict) -> None:
        targets = {socket for user_id in user_ids for socket in self.connections.get(user_id, ())}
        for websocket in targets:
            try:
                await websocket.send_json(event)
            except (RuntimeError, WebSocketDisconnect):
                for user_id in user_ids:
                    self.disconnect(user_id, websocket)

    def publish(self, user_ids: list[str], event: dict) -> None:
        loop = self.event_loop
        if loop is not None and loop.is_running():
            asyncio.run_coroutine_threadsafe(self.broadcast(user_ids, event), loop)


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
        online=connections.is_online(str(user["_id"])),
        last_seen_at=user.get("last_seen_at"),
    )


def _pair_key(first_user_id: ObjectId, second_user_id: ObjectId) -> str:
    return ":".join(sorted((str(first_user_id), str(second_user_id))))


def _existing_direct_conversation(database: Database, first_user_id: ObjectId, second_user_id: ObjectId) -> dict | None:
    return database.conversations.find_one({"direct_key": _pair_key(first_user_id, second_user_id)})


def _relationship(database: Database, user_id: ObjectId, other_user_id: ObjectId) -> str:
    pair_key = _pair_key(user_id, other_user_id)
    friendship = database.friendships.find_one({"pair_key": pair_key})
    if friendship:
        if friendship.get("status") == "accepted":
            return "friends"
        return "outgoing" if friendship.get("sender_id") == user_id else "incoming"
    # Existing direct chats predate friend requests and remain established connections.
    return "friends" if _existing_direct_conversation(database, user_id, other_user_id) else "none"


def _relationships_for_users(database: Database, user_id: ObjectId, users: list[dict]) -> dict[ObjectId, str]:
    pair_keys = {_pair_key(user_id, person["_id"]): person["_id"] for person in users}
    if not pair_keys:
        return {}
    relationships: dict[ObjectId, str] = {}
    for friendship in database.friendships.find({"pair_key": {"$in": list(pair_keys)}}):
        other_id = pair_keys[friendship["pair_key"]]
        relationships[other_id] = (
            "friends" if friendship.get("status") == "accepted"
            else "outgoing" if friendship.get("sender_id") == user_id
            else "incoming"
        )
    established = {
        conversation["direct_key"]
        for conversation in database.conversations.find({"direct_key": {"$in": list(pair_keys)}})
    }
    for pair_key, other_id in pair_keys.items():
        if pair_key in established:
            relationships[other_id] = "friends"
        else:
            relationships.setdefault(other_id, "none")
    return relationships


def _publish_people_changed(user_ids: list[ObjectId]) -> None:
    connections.publish([str(user_id) for user_id in user_ids], {"type": "friend_request_changed"})


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
                name=conversation.get("name"),
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


def _serialize_messages(
    database: Database,
    messages: list[dict],
    read_at: datetime | None = None,
    current_user_id: ObjectId | None = None,
) -> list[MessageResponse]:
    missing = [message for message in messages if not message.get("sentiment")]
    predictions = predict_sentiments([message.get("body", "") for message in missing])
    for message, prediction in zip(missing, predictions):
        if prediction:
            message["sentiment"] = prediction
            database.messages.update_one(
                {"_id": message["_id"], "sentiment": {"$exists": False}},
                {"$set": {"sentiment": prediction}},
            )
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
            read=bool(
                read_at
                and message["created_at"] <= read_at
                and message["sender_id"] == current_user_id
            ),
            sentiment=message.get("sentiment"),
            client_message_id=message.get("client_message_id"),
            attachment=(
                MessageAttachmentResponse(
                    file_name=message["attachment"]["file_name"],
                    content_type=message["attachment"]["content_type"],
                    size=message["attachment"]["size"],
                    download_url=f"/api/v1/messages/{message['_id']}/attachment",
                )
                if message.get("attachment")
                else None
            ),
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
    found = list(database.users.find(
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
    ).limit(100))
    relationships = _relationships_for_users(database, user["_id"], found)
    friends = [record for record in found if relationships.get(record["_id"]) == "friends"]
    return UserSearchResponse(users=[_user_summary(record) for record in friends[:20]])


@router.get("/people", response_model=PeopleResponse)
def list_people(
    q: str = Query(default="", max_length=50),
    user: dict = Depends(get_current_user),
    database: Database = Depends(get_database),
) -> PeopleResponse:
    """List verified coworkers with their friend-request state."""
    filters: dict = {
        "_id": {"$ne": user["_id"]},
        "email_verified": True,
        "username": {"$type": "string"},
    }
    query = q.strip().removeprefix("@").casefold()
    if query:
        pattern = re.escape(query)
        filters["$or"] = [
            {"username": {"$regex": pattern, "$options": "i"}},
            {"first_name": {"$regex": pattern, "$options": "i"}},
            {"last_name": {"$regex": pattern, "$options": "i"}},
            {"name": {"$regex": pattern, "$options": "i"}},
        ]
    records = list(database.users.find(filters).sort([("first_name", 1), ("last_name", 1)]).limit(100))
    relationships = _relationships_for_users(database, user["_id"], records)
    return PeopleResponse(people=[PersonEntry(
        user=_user_summary(record), relationship=relationships[record["_id"]]
    ) for record in records])


@router.get("/people/requests", response_model=FriendRequestsResponse)
def list_friend_requests(
    user: dict = Depends(get_current_user),
    database: Database = Depends(get_database),
) -> FriendRequestsResponse:
    """Return incoming and outgoing pending friend requests."""
    rows = list(database.friendships.find({"status": "pending", "$or": [
        {"sender_id": user["_id"]}, {"recipient_id": user["_id"]},
    ]}).sort("created_at", -1).limit(200))
    incoming_ids = [row["sender_id"] for row in rows if row["recipient_id"] == user["_id"]]
    outgoing_ids = [row["recipient_id"] for row in rows if row["sender_id"] == user["_id"]]
    profiles = {
        record["_id"]: _user_summary(record)
        for record in database.users.find({"_id": {"$in": incoming_ids + outgoing_ids}, "email_verified": True})
    }
    return FriendRequestsResponse(
        incoming=[profiles[item] for item in incoming_ids if item in profiles],
        outgoing=[profiles[item] for item in outgoing_ids if item in profiles],
    )


@router.post("/people/requests/{target_user_id}", response_model=FriendRequestResponse, status_code=status.HTTP_201_CREATED)
def send_friend_request(
    target_user_id: str,
    user: dict = Depends(get_current_user),
    database: Database = Depends(get_database),
) -> FriendRequestResponse:
    """Send a friend request to a verified coworker."""
    try:
        target_id = ObjectId(target_user_id)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=404, detail="Coworker not found.") from exc
    if target_id == user["_id"]:
        raise HTTPException(status_code=400, detail="You cannot send a friend request to yourself.")
    target = database.users.find_one({"_id": target_id, "email_verified": True})
    if target is None:
        raise HTTPException(status_code=404, detail="Coworker not found.")

    pair_key = _pair_key(user["_id"], target_id)
    existing = database.friendships.find_one({"pair_key": pair_key})
    if existing:
        if existing.get("status") == "accepted":
            return FriendRequestResponse(relationship="friends")
        if existing.get("sender_id") == user["_id"]:
            return FriendRequestResponse(relationship="outgoing")
        raise HTTPException(status_code=409, detail="This coworker has already sent you a request.")
    if _existing_direct_conversation(database, user["_id"], target_id):
        return FriendRequestResponse(relationship="friends")

    now = utc_now()
    try:
        database.friendships.insert_one({
            "pair_key": pair_key,
            "sender_id": user["_id"],
            "recipient_id": target_id,
            "status": "pending",
            "created_at": now,
            "updated_at": now,
        })
    except DuplicateKeyError:
        existing = database.friendships.find_one({"pair_key": pair_key})
        if existing and existing.get("sender_id") == user["_id"]:
            return FriendRequestResponse(relationship="outgoing")
        raise HTTPException(status_code=409, detail="A friend request already exists.")
    _publish_people_changed([user["_id"], target_id])
    return FriendRequestResponse(relationship="outgoing")


@router.post("/people/requests/{target_user_id}/accept", response_model=FriendRequestResponse)
def accept_friend_request(
    target_user_id: str,
    user: dict = Depends(get_current_user),
    database: Database = Depends(get_database),
) -> FriendRequestResponse:
    """Accept a coworker's incoming friend request."""
    try:
        target_id = ObjectId(target_user_id)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=404, detail="Friend request not found.") from exc
    now = utc_now()
    result = database.friendships.update_one(
        {"pair_key": _pair_key(user["_id"], target_id), "sender_id": target_id, "recipient_id": user["_id"], "status": "pending"},
        {"$set": {"status": "accepted", "accepted_at": now, "updated_at": now}},
    )
    if not result.modified_count:
        raise HTTPException(status_code=404, detail="Incoming friend request not found.")
    _publish_people_changed([user["_id"], target_id])
    return FriendRequestResponse(relationship="friends")


@router.delete("/people/requests/{target_user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_friend_request(
    target_user_id: str,
    user: dict = Depends(get_current_user),
    database: Database = Depends(get_database),
) -> None:
    """Decline an incoming request or cancel an outgoing request."""
    try:
        target_id = ObjectId(target_user_id)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=404, detail="Friend request not found.") from exc
    result = database.friendships.delete_one({
        "pair_key": _pair_key(user["_id"], target_id),
        "status": "pending",
        "$or": [{"sender_id": user["_id"]}, {"recipient_id": user["_id"]}],
    })
    if not result.deleted_count:
        raise HTTPException(status_code=404, detail="Pending friend request not found.")
    _publish_people_changed([user["_id"], target_id])


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
        friendship = database.friendships.find_one({"pair_key": direct_key, "status": "accepted"})
        if friendship is None:
            raise HTTPException(status_code=403, detail="Send and accept a friend request before starting a conversation.")
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
    connections.publish(
        [str(participant_id) for participant_id in conversation["participant_ids"]],
        {"type": "conversation_changed"},
    )
    return _serialize_conversations(database, [conversation])[0]


@router.post("/conversations/group", response_model=ConversationResponse, status_code=status.HTTP_201_CREATED)
def create_group_conversation(
    payload: GroupConversationRequest,
    user: dict = Depends(get_current_user),
    database: Database = Depends(get_database),
) -> ConversationResponse:
    """Create a group thread with the current user and accepted teammates."""
    try:
        requested_ids = [ObjectId(value) for value in payload.participant_ids]
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="A selected teammate is invalid.") from exc
    if len(set(requested_ids)) != len(requested_ids) or user["_id"] in requested_ids:
        raise HTTPException(status_code=400, detail="Select each teammate once.")
    users = list(database.users.find({"_id": {"$in": requested_ids}, "email_verified": True}))
    if len(users) != len(requested_ids):
        raise HTTPException(status_code=400, detail="One or more selected teammates are unavailable.")
    for member_id in requested_ids:
        if _relationship(database, user["_id"], member_id) != "friends":
            raise HTTPException(status_code=403, detail="Group chats are available with accepted teammates only.")
    participant_ids = sorted([user["_id"], *requested_ids], key=str)
    now = utc_now()
    conversation = {
        "type": "group", "participant_ids": participant_ids,
        "name": payload.name, "created_by": user["_id"],
        "created_at": now, "updated_at": now, "last_message": None,
    }
    result = database.conversations.insert_one(conversation)
    conversation["_id"] = result.inserted_id
    connections.publish([str(member_id) for member_id in participant_ids], {"type": "conversation_changed"})
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


@router.get("/calls/logs", response_model=list[CallLogResponse])
def list_call_logs(
    limit: int = Query(default=100, ge=1, le=200),
    user: dict = Depends(get_current_user),
    database: Database = Depends(get_database),
) -> list[CallLogResponse]:
    """List recent calls involving the authenticated workspace member."""
    rows = list(database.call_logs.find({"participant_ids": user["_id"]}).sort("started_at", -1).limit(limit))
    peer_ids = {row["callee_id"] if row["caller_id"] == user["_id"] else row["caller_id"] for row in rows}
    peers = {item["_id"]: item for item in database.users.find({"_id": {"$in": list(peer_ids)}})}
    result = []
    for row in rows:
        peer_id = row["callee_id"] if row["caller_id"] == user["_id"] else row["caller_id"]
        peer = peers.get(peer_id)
        if peer is None:
            continue
        connected_at, ended_at = row.get("connected_at"), row.get("ended_at")
        duration = max(0, int((ended_at - connected_at).total_seconds())) if connected_at and ended_at else None
        result.append(CallLogResponse(
            id=row["call_id"], conversation_id=str(row["conversation_id"]), peer=_user_summary(peer),
            call_kind=row["call_kind"], direction="outgoing" if row["caller_id"] == user["_id"] else "incoming",
            status=row["status"], started_at=row["started_at"], connected_at=connected_at,
            ended_at=ended_at, duration_seconds=duration,
        ))
    return result


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
    other_user_ids = [
        participant_id
        for participant_id in conversation["participant_ids"]
        if participant_id != user["_id"]
    ]
    read_markers = conversation.get("last_read_at") or {}
    other_read_at = max(
        (read_markers.get(str(participant_id)) for participant_id in other_user_ids if read_markers.get(str(participant_id))),
        default=None,
    )
    return _serialize_messages(database, messages, other_read_at, user["_id"])


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
    sentiment = predict_sentiment(payload.body)
    message: MessageDocument = {
        "conversation_id": conversation["_id"],
        "sender_id": user["_id"],
        "body": payload.body,
        "message_type": "text",
        "created_at": now,
    }
    if payload.client_message_id:
        message["client_message_id"] = payload.client_message_id
    if sentiment:
        message["sentiment"] = sentiment
    try:
        result = database.messages.insert_one(message)
    except DuplicateKeyError:
        if not payload.client_message_id:
            raise
        saved_message = database.messages.find_one({
            "conversation_id": conversation["_id"],
            "sender_id": user["_id"],
            "client_message_id": payload.client_message_id,
        })
        if saved_message is None:
            raise
        return _serialize_messages(database, [saved_message])[0]
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
        [str(participant_id) for participant_id in conversation["participant_ids"]],
        {
            "type": "message",
            "conversation_id": str(conversation["_id"]),
            "message": response.model_dump(mode="json"),
        },
    )
    return response


def _safe_attachment_name(filename: str | None) -> str:
    name = PurePosixPath((filename or "attachment").replace("\\", "/")).name
    name = "".join(character for character in name if character.isprintable() and character not in "\r\n\x00").strip(" .")
    return name[:180] or "attachment"


def _classify_attachment(filename: str, content: bytes) -> tuple[str, str]:
    extension = PurePosixPath(filename).suffix.casefold()
    if extension in _IMAGE_TYPES:
        valid = {
            ".jpg": content.startswith(b"\xff\xd8\xff"),
            ".jpeg": content.startswith(b"\xff\xd8\xff"),
            ".png": content.startswith(b"\x89PNG\r\n\x1a\n"),
            ".gif": content.startswith((b"GIF87a", b"GIF89a")),
            ".webp": content.startswith(b"RIFF") and content[8:12] == b"WEBP",
        }[extension]
        if valid:
            return "image", _IMAGE_TYPES[extension]
    elif extension in _DOCUMENT_TYPES:
        if extension == ".pdf":
            valid = content.startswith(b"%PDF-")
        elif extension in {".doc", ".xls", ".ppt"}:
            valid = content.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")
        elif extension in {".docx", ".xlsx", ".pptx"}:
            package_entry = {".docx": "word/document.xml", ".xlsx": "xl/workbook.xml", ".pptx": "ppt/presentation.xml"}[extension]
            try:
                with zipfile.ZipFile(io.BytesIO(content)) as archive:
                    names = set(archive.namelist())
                valid = "[Content_Types].xml" in names and package_entry in names
            except (OSError, zipfile.BadZipFile):
                valid = False
        else:
            try:
                content.decode("utf-8")
                valid = b"\x00" not in content
            except UnicodeDecodeError:
                valid = False
        if valid:
            return "document", _DOCUMENT_TYPES[extension]
    elif extension in _VOICE_TYPES:
        valid = {
            ".webm": content.startswith(b"\x1aE\xdf\xa3"),
            ".ogg": content.startswith(b"OggS"),
            ".mp3": content.startswith(b"ID3") or (len(content) > 1 and content[0] == 0xff and content[1] & 0xe0 == 0xe0),
            ".wav": content.startswith(b"RIFF") and content[8:12] == b"WAVE",
            ".m4a": len(content) > 11 and content[4:8] == b"ftyp",
            ".aac": len(content) > 1 and content[0] == 0xff and content[1] & 0xf6 == 0xf0,
        }[extension]
        if valid:
            return "voice", _VOICE_TYPES[extension]
    raise HTTPException(status_code=415, detail="Use a supported image, document, or audio recording file.")


@router.post(
    "/conversations/{conversation_id}/attachments",
    response_model=MessageResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_message_attachment(
    conversation_id: str,
    file: UploadFile = File(...),
    caption: str = Form(default="", max_length=1000),
    client_message_id: str | None = Form(default=None, min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$"),
    user: dict = Depends(get_current_user),
    database: Database = Depends(get_database),
) -> MessageResponse:
    """Upload a validated image, document, or voice recording to private R2 storage."""
    conversation = _get_member_conversation(database, conversation_id, user["_id"])
    if not r2_storage.is_configured():
        raise HTTPException(status_code=503, detail="Chat file storage is not configured. Set the Cloudflare R2 environment variables.")

    if client_message_id:
        existing = database.messages.find_one({
            "conversation_id": conversation["_id"],
            "sender_id": user["_id"],
            "client_message_id": client_message_id,
        })
        if existing:
            return _serialize_messages(database, [existing])[0]

    max_bytes = max(1, settings.r2_max_upload_bytes)
    content = await file.read(max_bytes + 1)
    if not content:
        raise HTTPException(status_code=400, detail="The selected file is empty.")
    if len(content) > max_bytes:
        raise HTTPException(status_code=413, detail=f"Attachments must be no larger than {max_bytes // (1024 * 1024)} MB.")

    file_name = _safe_attachment_name(file.filename)
    message_type, content_type = _classify_attachment(file_name, content)
    storage_key = f"{conversation['_id']}/{user['_id']}/{uuid4().hex}{PurePosixPath(file_name).suffix.casefold()}"
    try:
        await run_in_threadpool(r2_storage.put_object, storage_key, content, content_type)
    except Exception as exc:
        logger.warning("R2 attachment upload failed (%s).", type(exc).__name__)
        raise HTTPException(status_code=502, detail="Could not upload the attachment to chat storage.") from exc

    body = caption.strip() or {"image": "Sent an image", "document": "Sent a document", "voice": "Voice message"}[message_type]
    now = utc_now()
    message: MessageDocument = {
        "conversation_id": conversation["_id"],
        "sender_id": user["_id"],
        "body": body,
        "message_type": message_type,
        "created_at": now,
        "attachment": {
            "storage_key": storage_key,
            "file_name": file_name,
            "content_type": content_type,
            "size": len(content),
        },
    }
    if client_message_id:
        message["client_message_id"] = client_message_id
    sentiment = predict_sentiment(body)
    if sentiment:
        message["sentiment"] = sentiment
    try:
        result = database.messages.insert_one(message)
        message["_id"] = result.inserted_id
    except DuplicateKeyError:
        await run_in_threadpool(r2_storage.delete_object, storage_key)
        if not client_message_id:
            raise
        existing = database.messages.find_one({
            "conversation_id": conversation["_id"],
            "sender_id": user["_id"],
            "client_message_id": client_message_id,
        })
        if existing:
            return _serialize_messages(database, [existing])[0]
        raise
    except Exception as exc:
        await run_in_threadpool(r2_storage.delete_object, storage_key)
        logger.warning("Could not persist uploaded attachment message (%s).", type(exc).__name__)
        raise HTTPException(status_code=500, detail="The attachment uploaded but could not be added to the conversation.") from exc

    database.conversations.update_one(
        {"_id": conversation["_id"]},
        {"$set": {"updated_at": now, "last_message": {"body": body, "sender_id": user["_id"], "created_at": now}}},
    )
    response = _serialize_messages(database, [message])[0]
    connections.publish(
        [str(participant_id) for participant_id in conversation["participant_ids"]],
        {"type": "message", "conversation_id": str(conversation["_id"]), "message": response.model_dump(mode="json")},
    )
    return response


@router.get("/messages/{message_id}/attachment")
def download_message_attachment(
    message_id: str,
    user: dict = Depends(get_current_user),
    database: Database = Depends(get_database),
) -> StreamingResponse:
    """Stream a private attachment only to a member of its conversation."""
    try:
        message_object_id = ObjectId(message_id)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=404, detail="Attachment not found.") from exc
    message = database.messages.find_one({"_id": message_object_id})
    if message is None or not message.get("attachment"):
        raise HTTPException(status_code=404, detail="Attachment not found.")
    conversation = database.conversations.find_one({"_id": message["conversation_id"], "participant_ids": user["_id"]})
    if conversation is None:
        raise HTTPException(status_code=404, detail="Attachment not found.")
    if not r2_storage.is_configured():
        raise HTTPException(status_code=503, detail="Chat file storage is not configured.")
    attachment = message["attachment"]
    try:
        result = r2_storage.get_object(attachment["storage_key"])
    except Exception as exc:
        logger.warning("R2 attachment download failed (%s).", type(exc).__name__)
        raise HTTPException(status_code=502, detail="Could not retrieve the chat attachment.") from exc

    def chunks():
        try:
            yield from result["Body"].iter_chunks(chunk_size=64 * 1024)
        finally:
            result["Body"].close()

    disposition = "inline" if message.get("message_type") in {"image", "voice"} else "attachment"
    headers = {
        "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(attachment['file_name'])}",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
    }
    return StreamingResponse(chunks(), media_type=attachment["content_type"], headers=headers)


@router.post("/conversations/{conversation_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_conversation_read(
    conversation_id: str,
    user: dict = Depends(get_current_user),
    database: Database = Depends(get_database),
) -> None:
    """Record that the current user has read through the latest message."""
    conversation = _get_member_conversation(database, conversation_id, user["_id"])
    read_at = utc_now()
    database.conversations.update_one(
        {"_id": conversation["_id"]},
        {"$set": {f"last_read_at.{user['_id']}": read_at}},
    )
    connections.publish(
        [str(participant_id) for participant_id in conversation["participant_ids"]],
        {"type": "read", "conversation_id": conversation_id, "user_id": str(user["_id"]), "read_at": read_at.isoformat()},
    )


def _verified_user_ids(database: Database) -> list[str]:
    return [str(record["_id"]) for record in database.users.find({"email_verified": True}, {"_id": 1})]


@router.websocket("/ws")
async def workspace_socket(websocket: WebSocket) -> None:
    """Authenticate one workspace connection for chat, typing, and presence events."""
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
    except (TypeError, ValueError):
        await websocket.close(code=1008)
        return

    user = database.users.find_one({"_id": user_id, "email_verified": True})
    if user is None:
        await websocket.close(code=1008)
        return

    was_offline = await connections.connect(str(user_id), websocket)
    if was_offline:
        connections.publish(
            _verified_user_ids(database),
            {"type": "presence", "user_id": str(user_id), "online": True, "last_seen_at": None},
        )
    try:
        while True:
            event = await websocket.receive_json()
            if not isinstance(event, dict):
                continue
            if event.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            if event.get("type") == "ui_focus" and isinstance(event.get("focused"), bool):
                online = connections.set_focused(str(user_id), websocket, event["focused"])
                if online is not None:
                    last_seen_at = None
                    if not online:
                        last_seen_at = utc_now()
                        database.users.update_one({"_id": user_id}, {"$set": {"last_seen_at": last_seen_at}})
                    connections.publish(
                        _verified_user_ids(database),
                        {
                            "type": "presence",
                            "user_id": str(user_id),
                            "online": online,
                            "last_seen_at": last_seen_at.isoformat() if last_seen_at else None,
                        },
                    )
                continue

            event_type = event.get("type")
            conversation_id = event.get("conversation_id")
            if (event_type not in {"typing", "stop_typing"} | _CALL_SIGNAL_TYPES
                    or not isinstance(conversation_id, str)):
                continue
            try:
                conversation_object_id = ObjectId(conversation_id)
            except (TypeError, ValueError):
                continue
            conversation = database.conversations.find_one(
                {"_id": conversation_object_id, "participant_ids": user_id}
            )
            if conversation is None:
                continue
            peers = [str(item) for item in conversation["participant_ids"] if item != user_id]
            if event_type in _CALL_SIGNAL_TYPES:
                target_user_id = event.get("to_user_id")
                call_id = event.get("call_id")
                if not isinstance(target_user_id, str) or target_user_id not in peers:
                    continue
                if not isinstance(call_id, str) or len(call_id) > 100:
                    continue
                if event_type == "call_offer":
                    if event.get("call_kind") not in {"audio", "video"} or not isinstance(event.get("sdp"), dict):
                        continue
                    now = utc_now()
                    database.call_logs.update_one(
                        {"call_id": call_id},
                        {"$setOnInsert": {
                            "call_id": call_id,
                            "conversation_id": conversation_object_id,
                            "participant_ids": [user_id, ObjectId(target_user_id)],
                            "caller_id": user_id,
                            "callee_id": ObjectId(target_user_id),
                            "call_kind": event["call_kind"],
                            "status": "ringing",
                            "started_at": now,
                            "connected_at": None,
                            "ended_at": None,
                        }},
                        upsert=True,
                    )
                if event_type == "call_offer" and not connections.is_online(target_user_id):
                    database.call_logs.update_one({"call_id": call_id}, {"$set": {"status": "missed", "ended_at": utc_now()}})
                    connections.publish(
                        [str(user_id)],
                        {"type": "call_unavailable", "conversation_id": conversation_id, "call_id": call_id},
                    )
                    continue
                forwarded = {
                    "type": event_type,
                    "conversation_id": conversation_id,
                    "call_id": call_id,
                    "from_user_id": str(user_id),
                }
                if event_type == "call_offer":
                    forwarded.update({"call_kind": event["call_kind"], "sdp": event["sdp"]})
                elif event_type == "call_answer":
                    if not isinstance(event.get("sdp"), dict):
                        continue
                    database.call_logs.update_one(
                        {"call_id": call_id, "participant_ids": user_id},
                        {"$set": {"status": "ongoing", "connected_at": utc_now()}},
                    )
                    forwarded["sdp"] = event["sdp"]
                elif event_type == "call_ice":
                    if not isinstance(event.get("candidate"), dict):
                        continue
                    forwarded["candidate"] = event["candidate"]
                elif event_type in {"call_reject", "call_end", "call_busy", "call_missed"}:
                    terminal_status = {
                        "call_reject": "declined",
                        "call_busy": "busy",
                        "call_missed": "missed",
                    }.get(event_type)
                    now = utc_now()
                    if event_type == "call_end":
                        current = database.call_logs.find_one({"call_id": call_id, "participant_ids": user_id})
                        terminal_status = "completed" if current and current.get("connected_at") else "cancelled"
                    database.call_logs.update_one(
                        {"call_id": call_id, "participant_ids": user_id, "status": {"$in": ["ringing", "ongoing"]}},
                        {"$set": {"status": terminal_status, "ended_at": now}},
                    )
                connections.publish([target_user_id], forwarded)
            else:
                connections.publish(
                    peers,
                    {"type": event_type, "conversation_id": conversation_id, "user_id": str(user_id)},
                )
    except WebSocketDisconnect:
        went_offline = connections.disconnect(str(user_id), websocket)
        if went_offline:
            last_seen_at = utc_now()
            database.users.update_one({"_id": user_id}, {"$set": {"last_seen_at": last_seen_at}})
            connections.publish(
                _verified_user_ids(database),
                {"type": "presence", "user_id": str(user_id), "online": False, "last_seen_at": last_seen_at.isoformat()},
            )
