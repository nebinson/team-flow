"""Authenticated endpoints for AI chat and direct conversation summaries."""

from datetime import timedelta

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status
from pymongo.errors import DuplicateKeyError
from pymongo.database import Database

from app.api.auth import get_current_user
from app.db import get_database, utc_now
from app.schemas.ai import (
    AiChatMessageRequest,
    AiChatMessageResponse,
    AiChatResponse,
    AiChatRestartResponse,
    ConversationSummaryResponse,
)
from app.services.ai_summary import (
    AIChatNotConfiguredError,
    AIChatProvidersFailedError,
    SummaryNotConfiguredError,
    SummaryProvidersFailedError,
    generate_ai_reply,
    generate_conversation_summary,
)

router = APIRouter(prefix="/ai", tags=["AI"])


def _get_or_create_ai_chat(database: Database, user_id: ObjectId) -> dict:
    chat = database.ai_chats.find_one({"user_id": user_id})
    if chat is not None:
        return chat
    now = utc_now()
    try:
        result = database.ai_chats.insert_one({"user_id": user_id, "created_at": now, "updated_at": now})
        return database.ai_chats.find_one({"_id": result.inserted_id})
    except DuplicateKeyError:
        return database.ai_chats.find_one({"user_id": user_id})


def _chat_message_response(message: dict) -> AiChatMessageResponse:
    return AiChatMessageResponse(
        id=str(message["_id"]),
        role=message["role"],
        content=message["content"],
        created_at=message["created_at"],
        provider=message.get("provider"),
    )


@router.get("/chat", response_model=AiChatResponse)
def get_ai_chat(
    user: dict = Depends(get_current_user),
    database: Database = Depends(get_database),
) -> AiChatResponse:
    """Return the signed-in user's private AI chat and recent history."""
    chat = _get_or_create_ai_chat(database, user["_id"])
    rows = list(
        database.ai_chat_messages.find({"chat_id": chat["_id"]})
        .sort("created_at", -1)
        .limit(100)
    )
    rows.reverse()
    return AiChatResponse(id=str(chat["_id"]), messages=[_chat_message_response(row) for row in rows])


@router.post("/chat/messages", response_model=list[AiChatMessageResponse])
def send_ai_chat_message(
    payload: AiChatMessageRequest,
    user: dict = Depends(get_current_user),
    database: Database = Depends(get_database),
) -> list[AiChatMessageResponse]:
    """Generate and persist a user/assistant turn using recent private context."""
    content = payload.content.strip()
    if not content:
        raise HTTPException(status_code=422, detail="Message cannot be blank.")
    chat = _get_or_create_ai_chat(database, user["_id"])
    rows = list(
        database.ai_chat_messages.find({"chat_id": chat["_id"]})
        .sort("created_at", -1)
        .limit(30)
    )
    rows.reverse()
    history = [
        {"role": row["role"], "content": row["content"][:4000]}
        for row in rows
    ]
    history.append({"role": "user", "content": content})
    try:
        answer, provider = generate_ai_reply(history)
    except AIChatNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No AI chat provider is configured. Set a model and key for NVIDIA NIM, Gemini, or Ollama.",
        ) from exc
    except AIChatProvidersFailedError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="All configured AI chat providers are unavailable. Check backend logs and provider settings.",
        ) from exc

    now = utc_now()
    assistant_time = now + timedelta(microseconds=1)
    documents = [
        {"chat_id": chat["_id"], "role": "user", "content": content, "created_at": now},
        {"chat_id": chat["_id"], "role": "assistant", "content": answer, "created_at": assistant_time, "provider": provider},
    ]
    inserted = database.ai_chat_messages.insert_many(documents)
    database.ai_chats.update_one({"_id": chat["_id"]}, {"$set": {"updated_at": assistant_time}})
    for document, identifier in zip(documents, inserted.inserted_ids, strict=True):
        document["_id"] = identifier
    return [_chat_message_response(document) for document in documents]


@router.post("/chat/restart", response_model=AiChatRestartResponse)
def restart_ai_chat(
    user: dict = Depends(get_current_user),
    database: Database = Depends(get_database),
) -> AiChatRestartResponse:
    """Permanently erase this user's AI messages so subsequent replies have no prior context."""
    chat = _get_or_create_ai_chat(database, user["_id"])
    deleted = database.ai_chat_messages.delete_many({"chat_id": chat["_id"]})
    database.ai_chats.update_one({"_id": chat["_id"]}, {"$set": {"updated_at": utc_now()}})
    return AiChatRestartResponse(deleted_messages=deleted.deleted_count)


@router.post(
    "/conversations/{conversation_id}/summary",
    response_model=ConversationSummaryResponse,
)
def summarize_conversation(
    conversation_id: str,
    user: dict = Depends(get_current_user),
    database: Database = Depends(get_database),
) -> ConversationSummaryResponse:
    """Summarize recent persisted messages, only for a conversation participant."""
    try:
        conversation_object_id = ObjectId(conversation_id)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=404, detail="Conversation not found.") from exc
    conversation = database.conversations.find_one({
        "_id": conversation_object_id,
        "participant_ids": user["_id"],
    })
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found.")

    rows = list(
        database.messages.find({"conversation_id": conversation_object_id})
        .sort("created_at", -1)
        .limit(150)
    )
    rows.reverse()
    if not rows:
        raise HTTPException(status_code=400, detail="Send a few messages before generating a summary.")

    senders = {
        item["_id"]: item.get("name", "Teammate")
        for item in database.users.find({"_id": {"$in": list({row["sender_id"] for row in rows})}})
    }
    formatted = [
        f"{senders.get(row['sender_id'], 'Teammate')}: {row['body'][:700]}"
        for row in rows
    ]
    try:
        summary, provider = generate_conversation_summary(formatted)
    except SummaryNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No AI summary provider is configured. Set a model and key for NVIDIA NIM, Gemini, or Ollama.",
        ) from exc
    except SummaryProvidersFailedError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="All configured AI summary providers are unavailable. Check backend logs and provider settings.",
        ) from exc
    return ConversationSummaryResponse(
        summary=summary,
        provider=provider,
        generated_at=utc_now(),
        message_count=len(rows),
    )
