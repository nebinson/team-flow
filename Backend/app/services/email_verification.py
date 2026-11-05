"""Generate and deliver short-lived email codes with atomic resend throttling."""

from datetime import timedelta
from html import escape
import logging

import resend
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from pymongo.database import Database

from app.db import utc_now
from app.models.documents import EmailVerificationDocument, UserDocument
from app.security import create_email_verification_code, hash_email_verification_code
from app.settings import settings

logger = logging.getLogger(__name__)


class EmailDeliveryError(Exception):
    pass


def email_verification_is_configured() -> bool:
    return bool(settings.resend_api_key and settings.email_from)


def send_verification_email(database: Database, user: UserDocument) -> bool:
    """Issue an HMAC-backed code and email it; return False during the atomic cooldown."""
    now = utc_now()
    code = create_email_verification_code()
    code_hash = hash_email_verification_code(code)
    expires_at = now + timedelta(minutes=settings.email_verification_code_minutes)
    verification: EmailVerificationDocument = {
        "user_id": user["_id"],
        "code_hash": code_hash,
        "expires_at": expires_at,
        "created_at": now,
        "last_sent_at": now,
        "attempt_count": 0,
    }
    cooldown_cutoff = now - timedelta(seconds=settings.verification_resend_cooldown_seconds)
    try:
        stored_verification = database.email_verifications.find_one_and_update(
            {
                "user_id": user["_id"],
                "$or": [
                    {"last_sent_at": {"$lte": cooldown_cutoff}},
                    {"last_sent_at": {"$exists": False}},
                ],
            },
            {"$set": verification},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        return False
    if stored_verification is None:
        return False

    name = escape(user["name"])
    resend.api_key = settings.resend_api_key
    try:
        resend.Emails.send(
            {
                "from": settings.email_from,
                "to": [user["email"]],
                "subject": "Your TeamFlow verification code",
                "html": (
                    f"<p>Hi {name},</p>"
                    "<p>Enter this code to verify your email and activate your TeamFlow account:</p>"
                    f'<p style="font-size:30px;font-weight:700;letter-spacing:8px">{code}</p>'
                    f"<p>This code expires in {settings.email_verification_code_minutes} minutes.</p>"
                    "<p>If you did not create a TeamFlow account, you can ignore this email.</p>"
                ),
            }
        )
    except Exception as exc:
        logger.exception("Resend failed to deliver an email verification message.")
        database.email_verifications.delete_one(
            {"user_id": user["_id"], "code_hash": code_hash}
        )
        raise EmailDeliveryError from exc

    return True
