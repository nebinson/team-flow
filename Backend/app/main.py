"""FastAPI application assembly and startup/shutdown lifecycle."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.ai import router as ai_router
from app.api.messaging import router as messaging_router
from app.db import initialize_database
from app.settings import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    client = None
    database = None
    try:
        client, database = initialize_database()
        app.state.mongo_client = client
        app.state.database = database
        yield
    finally:
        if client is not None:
            client.close()


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api/v1")
app.include_router(messaging_router, prefix="/api/v1")


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "teamflow-api"}
