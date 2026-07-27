import os

from app.core.config import get_settings
from app.storage.base import StorageBackend


class LocalDiskStorage(StorageBackend):
    """Phase 1 default - zero cloud setup needed to get the pipeline running. Files are
    written under STORAGE_LOCAL_DIR and served back out by this same FastAPI app's /media
    static mount (see app/main.py)."""

    def save(self, *, key: str, data: bytes, content_type: str) -> str:
        settings = get_settings()
        path = os.path.join(settings.storage_local_dir, key)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
        return f"{settings.storage_local_public_base_url.rstrip('/')}/{key}"
