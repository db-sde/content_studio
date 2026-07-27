import boto3

from app.core.config import get_settings
from app.storage.base import StorageBackend


class R2Storage(StorageBackend):
    """Cloudflare R2 - S3-compatible API, so boto3's S3 client works against it unmodified
    once pointed at R2's account-scoped endpoint. Recommended for production at this pipeline's
    image volume (~20,000 images / ~4GB): comfortably inside R2's free tier, and R2 never
    charges egress, which matters since these are public-facing marketing images."""

    def __init__(self) -> None:
        settings = get_settings()
        self._bucket = settings.r2_bucket
        self._public_base_url = settings.r2_public_base_url.rstrip("/")
        self._client = boto3.client(
            "s3",
            endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            region_name="auto",
        )

    def save(self, *, key: str, data: bytes, content_type: str) -> str:
        self._client.put_object(Bucket=self._bucket, Key=key, Body=data, ContentType=content_type)
        return f"{self._public_base_url}/{key}"
