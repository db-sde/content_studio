import time

import httpx

from app.core.config import get_settings
from app.providers.base import GeneratedImage, ImageProvider
from app.schemas.prompt import StructuredPrompt

_FAL_RUN_URL = "https://fal.run/fal-ai/flux-pro/v1.1"


class FluxProvider(ImageProvider):
    """Wraps FLUX 1.1 [pro] via fal.ai's synchronous REST endpoint (fal.run, not the queue
    endpoint - still fast enough for a direct blocking call within a background task).
    Upgraded from FLUX Schnell: same input/output shape (fal.run's flux family shares a
    consistent schema), but noticeably better composition/detail/anatomy correctness for
    ~13x the cost (~$0.08 vs ~$0.006 per hero image) - worth it now that on-image text is
    composited separately (see app.processing.text_overlay), so Schnell's speed advantage
    (its main selling point) no longer needs to be traded against text-rendering quality.
    Tuned further with guidance_scale/num_inference_steps below - confirmed live to sharpen
    detail and lighting noticeably over the endpoint's own defaults."""

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
                # flux-pro/v1.1 uses safety_tolerance (1 strictest - 6 most permissive), not
                # schnell's enable_safety_checker boolean - default "2" is a reasonable default.
                "safety_tolerance": "2",
                # Not part of flux-pro/v1.1's documented input schema, but confirmed live to be
                # accepted (HTTP 200, visibly sharper detail/lighting) - guidance_scale 3.5 is the
                # commonly-cited sweet spot for prompt adherence without over-saturating; 28
                # inference steps is a denoising depth that noticeably improves fine detail
                # (skin/fabric/hand texture) over the endpoint's own default.
                "guidance_scale": 3.5,
                "num_inference_steps": 28,
            },
            timeout=90.0,
        )
        response.raise_for_status()
        body = response.json()

        images = body.get("images") or []
        if not images:
            raise RuntimeError(f"fal.ai FLUX 1.1 [pro] returned no images: {body}")
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
