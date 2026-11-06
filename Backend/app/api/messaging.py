"""Authenticated direct-message APIs and local WebSocket fan-out."""

import asyncio
import json
import logging
import re
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen
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
    CallLogResponse,
    CreateMessageRequest,
    DirectConversationRequest,
    FriendRequestResponse,
    FriendRequestsResponse,
    LastMessageSummary,
    MessageResponse,
    PeopleResponse,
    PersonEntry,
    UserSearchResponse,
    UserSummary,
)
from app.security import decode_access_token
from app.services.sentiment import predict_sentiment, predict_sentiments
from app.settings import settings

router = APIRouter(tags=["messaging"])
logger = logging.getLogger(__name__)
_CALL_SIGNAL_TYPES = {"call_offer", "call_answer", "call_ice", "call_reject", "call_end", "call_busy", "call_missed"}


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
