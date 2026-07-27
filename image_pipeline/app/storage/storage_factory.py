from app.core.config import get_settings
from app.storage.base import StorageBackend
from app.storage.local_disk import LocalDiskStorage
from app.storage.r2_storage import R2Storage


def get_storage_backend() -> StorageBackend:
    settings = get_settings()
    if settings.storage_backend == "r2":
        return R2Storage()
    return LocalDiskStorage()
