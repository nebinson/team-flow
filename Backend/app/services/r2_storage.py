"""Private chat media storage backed by the Cloudflare R2 S3 API."""

from functools import lru_cache

import boto3
from botocore.config import Config

from app.settings import settings


def is_configured() -> bool:
    return bool(
        settings.r2_endpoint_url
        and settings.r2_access_key_id
        and settings.r2_secret_access_key
        and settings.r2_bucket_name
    )


@lru_cache(maxsize=1)
def _client():
    if not is_configured():
        raise RuntimeError("Cloudflare R2 is not configured.")
    return boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint_url,
        region_name=settings.r2_region,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        config=Config(signature_version="s3v4", retries={"max_attempts": 2, "mode": "standard"}),
    )


def put_object(key: str, body: bytes, content_type: str) -> None:
    _client().put_object(
        Bucket=settings.r2_bucket_name,
        Key=key,
        Body=body,
        ContentType=content_type,
    )


def get_object(key: str):
    return _client().get_object(Bucket=settings.r2_bucket_name, Key=key)


def delete_object(key: str) -> None:
    _client().delete_object(Bucket=settings.r2_bucket_name, Key=key)
