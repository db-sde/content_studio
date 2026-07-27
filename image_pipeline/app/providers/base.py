from abc import ABC, abstractmethod
from dataclasses import dataclass

from app.schemas.prompt import StructuredPrompt


@dataclass
class GeneratedImage:
    image_bytes: bytes
    format: str  # provider's native output format, before our own WebP conversion
    width: int
    height: int
    provider_generation_id: str | None
    generation_time_ms: int


class NotImplementedProviderError(NotImplementedError):
    pass


class ImageProvider(ABC):
    """Common interface every provider implements. The frontend/Node side never sees which
    concrete provider ran - only this service picks one, via ProviderFactory reading config."""

    name: str

    @abstractmethod
    def assemble_text(self, prompt: StructuredPrompt) -> str:
        """Turn the structured prompt into this provider's final text string - assembled here,
        at the point of the actual API call, never exposed outside this service."""

    @abstractmethod
    def generate(self, prompt: StructuredPrompt, *, width: int, height: int) -> GeneratedImage:
        ...
