from app.core.config import get_settings
from app.providers.base import ImageProvider
from app.providers.flux_provider import FluxProvider
from app.providers.ideogram_provider import IdeogramProvider
from app.providers.mock_provider import MockProvider
from app.providers.openai_provider import OpenAIProvider

_PROVIDERS: dict[str, type[ImageProvider]] = {
    "mock": MockProvider,
    "flux": FluxProvider,
    "openai": OpenAIProvider,
    "ideogram": IdeogramProvider,
}


def get_provider(name: str | None = None) -> ImageProvider:
    """Selected purely from config - callers (routers/tasks) never choose a provider class
    directly, so swapping the default is a config change, not a code change."""
    settings = get_settings()
    effective_name = "mock" if settings.provider_mode == "mock" else (name or settings.image_provider)
    provider_cls = _PROVIDERS.get(effective_name)
    if provider_cls is None:
        raise ValueError(f"Unknown image provider: {effective_name!r}")
    return provider_cls()
