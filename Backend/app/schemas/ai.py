"""Schemas for generative AI features."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ConversationSummaryResponse(BaseModel):
    summary: str = Field(min_length=1)
    provider: Literal["NVIDIA NIM", "Gemini", "Ollama"]
    generated_at: datetime
    message_count: int


class AiChatMessageRequest(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


class AiChatMessageResponse(BaseModel):
    id: str
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime
    provider: Literal["NVIDIA NIM", "Gemini", "Ollama"] | None = None


class AiChatResponse(BaseModel):
    id: str
    messages: list[AiChatMessageResponse]


class AiChatRestartResponse(BaseModel):
    deleted_messages: int
