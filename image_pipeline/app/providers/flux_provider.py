import time

import httpx

from app.core.config import get_settings
from app.providers.base import GeneratedImage, ImageProvider
from app.schemas.prompt import StructuredPrompt

_FAL_RUN_URL = "https://fal.run/fal-ai/flux/dev"


class FluxProvider(ImageProvider):
    """Wraps FLUX.1 [dev] via fal.ai's synchronous REST endpoint (fal.run, not the queue
    endpoint - still fast enough for a direct blocking call within a background task).
    Settled here after trying Schnell (~$0.003/MP, garbled on-image text - since fixed by
    compositing text separately, see app.processing.text_overlay) and Pro 1.1 (~$0.04/MP,
    didn't read as meaningfully better for the cost). Dev (~$0.025/MP) is the middle tier -
    unlike Pro 1.1, guidance_scale/num_inference_steps are actually first-class documented
    params here (not just accepted-but-undocumented), so the same tuning applies cleanly."""

    name = "flux"

    def assemble_text(self, prompt: StructuredPrompt) -> str:
        negatives = ", ".join(prompt.negative_prompt)
        return (
            f"{prompt.subject}. {prompt.background}. {prompt.composition}. "
            f"{prompt.lighting}. {prompt.style}. "
            f"Avoid: {negatives}."
        )

    def generate(self, prompt: StructuredPrompt, *, width: int, height: int) -> GeneratedImage:
        settings = get_settings()
        if not settings.fal_key:
            raise RuntimeError("FAL_KEY is not configured - required when IMAGE_PROVIDER=flux and PROVIDER_MODE=live")

        text_prompt = self.assemble_text(prompt)
        start = time.monotonic()

        response = httpx.post(
            _FAL_RUN_URL,
            headers={"Authorization": f"Key {settings.fal_key}", "Content-Type": "application/json"},
            json={
                "prompt": text_prompt,
                "image_size": {"width": width, "height": height},
                "num_images": 1,
                "output_format": "png",
                # flux/dev uses enable_safety_checker (boolean), same as schnell - unlike
                # flux-pro/v1.1's safety_tolerance string enum.
                "enable_safety_checker": True,
                # Both are first-class documented params for this endpoint (default values are
                # actually the same 3.5/28 dev already defaults to - set explicitly so they don't
                # silently drift if fal.ai ever changes the endpoint's own defaults).
                "guidance_scale": 3.5,
                "num_inference_steps": 28,
            },
            timeout=90.0,
        )
        response.raise_for_status()
        body = response.json()

        images = body.get("images") or []
        if not images:
            raise RuntimeError(f"fal.ai FLUX.1 [dev] returned no images: {body}")
        image_meta = images[0]

        image_response = httpx.get(image_meta["url"], timeout=30.0)
        image_response.raise_for_status()

        elapsed_ms = int((time.monotonic() - start) * 1000)
        return GeneratedImage(
            image_bytes=image_response.content,
            format="png",
            width=image_meta.get("width", width),
            height=image_meta.get("height", height),
            provider_generation_id=str(body.get("seed")) if body.get("seed") is not None else None,
            generation_time_ms=elapsed_ms,
        )
