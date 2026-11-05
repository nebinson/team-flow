from datetime import timedelta
from html import escape
import logging

import resend
from pymongo.database import Database

from app.db import utc_now
from app.models.documents import EmailVerificationDocument, UserDocument
from app.security import create_email_verification_token, hash_email_verification_token
from app.settings import settings

logger = logging.getLogger(__name__)


class EmailDeliveryError(Exception):
    pass


def email_verification_is_configured() -> bool:
    return bool(settings.resend_api_key and settings.email_from)


def send_verification_email(database: Database, user: UserDocument) -> bool:
    """Issue and send a one-time verification link; return False during cooldown."""
    now = utc_now()
    previous = database.email_verifications.find_one({"user_id": user["_id"]})
    cooldown = timedelta(seconds=settings.verification_resend_cooldown_seconds)
    if previous and previous.get("last_sent_at") and now - previous["last_sent_at"] < cooldown:
        return False

    token = create_email_verification_token()
    token_hash = hash_email_verification_token(token)
    expires_at = now + timedelta(minutes=settings.email_verification_token_minutes)
    verification: EmailVerificationDocument = {
        "user_id": user["_id"],
        "token_hash": token_hash,
        "expires_at": expires_at,
        "created_at": now,
        "last_sent_at": now,
    }
    database.email_verifications.update_one(
        {"user_id": user["_id"]},
        {"$set": verification},
        upsert=True,
    )

    link = f"{settings.frontend_origin.rstrip('/')}/verify-email?token={token}"
    name = escape(user["name"])
    resend.api_key = settings.resend_api_key
    try:
        resend.Emails.send(
            {
                "from": settings.email_from,
                "to": [user["email"]],
                "subject": "Verify your TeamFlow email",
                "html": (
                    f"<p>Hi {name},</p>"
                    "<p>Confirm your email address to activate your TeamFlow account.</p>"
                    f'<p><a href="{escape(link, quote=True)}">Verify email address</a></p>'
                    f"<p>This link expires in {settings.email_verification_token_minutes} minutes.</p>"
                ),
            }
        )
    except Exception as exc:
        logger.exception("Resend failed to deliver an email verification message.")
        database.email_verifications.delete_one(
            {"user_id": user["_id"], "token_hash": token_hash}
        )
        raise EmailDeliveryError from exc

    return True
