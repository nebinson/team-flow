"""Authenticated AI endpoints for direct conversation summaries."""

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status
from pymongo.database import Database

from app.api.auth import get_current_user
from app.db import get_database, utc_now
from app.schemas.ai import ConversationSummaryResponse
from app.services.ai_summary import (
    SummaryNotConfiguredError,
    SummaryProvidersFailedError,
    generate_conversation_summary,
)

router = APIRouter(prefix="/ai", tags=["AI"])


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
