from datetime import datetime, timezone

from fastapi import HTTPException, Request
from pymongo import ASCENDING, MongoClient
from pymongo.database import Database

from app.settings import settings


def initialize_database() -> tuple[MongoClient | None, Database | None]:
    if not settings.mongodb_uri:
        return None, None

    client = MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=5000)
    try:
        client.admin.command("ping")
        database = client[settings.mongodb_database]

        database.users.create_index(
            [("email", ASCENDING)], unique=True, name="users_email_unique"
        )
        database.email_verifications.create_index(
            [("user_id", ASCENDING)], unique=True, name="email_verifications_user_unique"
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
