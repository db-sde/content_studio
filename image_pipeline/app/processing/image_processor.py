"""Resize/compress/WebP-convert a generated image to the <200KB target.

Uses Pillow rather than pyvips/libvips: Pillow's PyPI wheels bundle libwebp already, so this
needs no system-level image library installed on the host, which matters for a service that
should be `pip install -r requirements.txt` away from running. libvips would be faster at the
thousands-of-images-per-backfill scale this pipeline eventually runs at - swap in a pyvips-backed
implementation of this same function later if that becomes the bottleneck; nothing else in the
pipeline depends on which library does the encoding.
"""

import io
from dataclasses import dataclass

from PIL import Image

from app.core.config import get_settings

# Per-role target dimensions - hero is a wide banner; body images are more square for inline use.
# Purely an output-format concern, so it lives here rather than in the Image Planner.
TARGET_DIMENSIONS: dict[str, tuple[int, int]] = {
    "hero": (1600, 900),
    "body1": (1200, 800),
    "body2": (1200, 800),
    "body3": (1200, 800),
}

_QUALITY_START = 82
_QUALITY_FLOOR = 40
_QUALITY_STEP = 8
_MIN_DIMENSION_PX = 200


@dataclass
class ProcessedImage:
    image_bytes: bytes
    format: str
    width: int
    height: int
    size_bytes: int


def process_image(image_bytes: bytes, *, role: str | None = None, max_size_bytes: int | None = None) -> ProcessedImage:
    settings = get_settings()
    target_size = max_size_bytes or settings.max_image_size_bytes

    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    target_dims = TARGET_DIMENSIONS.get(role or "")
    if target_dims:
        image = image.resize(target_dims, Image.LANCZOS)

    quality = _QUALITY_START
    data = b""
    while True:
        buf = io.BytesIO()
        image.save(buf, format="WEBP", quality=quality, method=6)
        data = buf.getvalue()
        if len(data) <= target_size or quality <= _QUALITY_FLOOR:
            break
        quality -= _QUALITY_STEP

    # Quality floor reached and still oversized - shrink dimensions instead of degrading
    # quality further, since visible artifacting is worse than a slightly smaller image.
    while len(data) > target_size and min(image.size) > _MIN_DIMENSION_PX:
        image = image.resize((int(image.width * 0.85), int(image.height * 0.85)), Image.LANCZOS)
        buf = io.BytesIO()
        image.save(buf, format="WEBP", quality=70, method=6)
        data = buf.getvalue()

    return ProcessedImage(image_bytes=data, format="webp", width=image.width, height=image.height, size_bytes=len(data))
