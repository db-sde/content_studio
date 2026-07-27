import io
import time

from PIL import Image

from app.providers.base import GeneratedImage, ImageProvider
from app.schemas.prompt import StructuredPrompt


class MockProvider(ImageProvider):
    """Deterministic placeholder image, zero cost and zero external calls - lets the whole
    pipeline (planner -> prompt -> provider -> processing -> storage -> status) run and be
    tested without any real provider credentials configured."""

    name = "mock"

    def assemble_text(self, prompt: StructuredPrompt) -> str:
        parts = [prompt.subject, prompt.background, prompt.composition, prompt.lighting, prompt.style]
        return ", ".join(parts)

    def generate(self, prompt: StructuredPrompt, *, width: int, height: int) -> GeneratedImage:
        start = time.monotonic()
        # Color derived from the prompt text so the same spec produces a visibly-consistent
        # placeholder across runs - just a convenience for eyeballing test output.
        seed = sum(ord(c) for c in prompt.subject) % 256
        image = Image.new("RGB", (width, height), color=(seed, 120, 200))
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        elapsed_ms = int((time.monotonic() - start) * 1000)
        return GeneratedImage(
            image_bytes=buf.getvalue(),
            format="png",
            width=width,
            height=height,
            provider_generation_id=None,
            generation_time_ms=elapsed_ms,
        )
