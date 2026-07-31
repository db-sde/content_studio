import io

import cloudinary
import cloudinary.uploader

from app.core.config import get_settings
from app.storage.base import StorageBackend


class CloudinaryStorage(StorageBackend):
    """Cloudinary - the production choice: publicly reachable out of the box (no Render
    persistent disk, no bucket-policy setup), and this is what a generated image's URL becomes
    when a draft is published to WordPress - a separate, publicly-hosted site that needs a
    stable URL for each image, independent of this pipeline's own Render deployment."""

    def __init__(self) -> None:
        settings = get_settings()
        cloudinary.config(
            cloud_name=settings.cloudinary_cloud_name,
            api_key=settings.cloudinary_api_key,
            api_secret=settings.cloudinary_api_secret,
            secure=True,
        )

    def save(self, *, key: str, data: bytes, content_type: str) -> str:
        # public_id keeps the same job_X/role_vN organization the other backends' keys use -
        # Cloudinary treats "/" as folder structure.
        public_id = key.rsplit(".", 1)[0]
        result = cloudinary.uploader.upload(
            io.BytesIO(data), public_id=public_id, resource_type="image", overwrite=True,
        )
        return result["secure_url"]
