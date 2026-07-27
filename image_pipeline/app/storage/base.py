from abc import ABC, abstractmethod


class StorageBackend(ABC):
    """Strategy interface so switching storage (local disk -> Cloudflare R2) is a config
    change (STORAGE_BACKEND env var), not a code change anywhere else in the pipeline."""

    @abstractmethod
    def save(self, *, key: str, data: bytes, content_type: str) -> str:
        """Persist data under key, return the publicly-reachable URL."""
