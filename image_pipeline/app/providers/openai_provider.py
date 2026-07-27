from app.providers.base import GeneratedImage, ImageProvider, NotImplementedProviderError
from app.schemas.prompt import StructuredPrompt


class OpenAIProvider(ImageProvider):
    """Phase 2 - real implementation not built yet. Present now so the ProviderFactory's
    provider set and fallback-chain shape are already correct."""

    name = "openai"

    def assemble_text(self, prompt: StructuredPrompt) -> str:
        return f"{prompt.subject}, {prompt.background}, {prompt.composition}, {prompt.lighting}, {prompt.style}"

    def generate(self, prompt: StructuredPrompt, *, width: int, height: int) -> GeneratedImage:
        raise NotImplementedProviderError("OpenAIProvider is not implemented yet (Phase 2)")
