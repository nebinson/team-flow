"""Schemas for generative AI features."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ConversationSummaryResponse(BaseModel):
    summary: str = Field(min_length=1)
    provider: Literal["NVIDIA NIM", "Gemini", "Ollama"]
    generated_at: datetime
    message_count: int
