from pydantic import BaseModel, Field

# Diffusion models (FLUX Schnell in particular) reliably garble or misspell any rendered text -
# proven in production with real generations ("$harda University", "MEBA", "NAAAC Accrediited").
# So "text"/"written words"/"letters"/typography are suppressed again here; every page type that
# needs a headline/subheading/chips gets them from app.processing.text_overlay instead, which
# draws real characters from a real font onto the image after generation - the image model itself
# should only ever produce clean photography/background.
DEFAULT_NEGATIVE_PROMPT = [
    "text",
    "words",
    "letters",
    "typography",
    "written language",
    "captions",
    "labels",
    "invented university logo",
    "invented seal",
    "trademark violation",
    "watermark",
    "low quality",
    "blur",
    "fake statistics",
    "scholarship badge",
    "promotional sticker",
    "sale banner",
    "admission countdown",
    "apply now button",
    "exact fee amount",
    "ranking badge",
    # Diffusion models also frequently mangle human anatomy in busy/occluded poses (a third
    # hand, fused/extra fingers) - reduces but does not eliminate this, since it's a probabilistic
    # generation artifact rather than something a prompt can fully rule out.
    "extra limbs",
    "extra hands",
    "extra fingers",
    "malformed hands",
    "fused fingers",
    "deformed anatomy",
    "distorted body",
    "mutated hands",
]


# The exact words that will be composited onto the image after generation (see
# app.processing.text_overlay) - never sent to the image model itself, so there is zero risk of
# diffusion-garbled spelling. chips is capped at a handful of short highlight labels; subheading
# is optional (some roles - e.g. blog supporting images - never get one).
class OverlayText(BaseModel):
    headline: str
    subheading: str | None = None
    chips: list[str] = Field(default_factory=list)


# Structured prompt object — never a raw string. Providers each turn this into their own final
# text (see app/providers/base.py's assemble_text), so the frontend/Node side never sees or
# stores a provider-specific prompt string, only this structured shape. `overlay` is optional and
# deliberately excluded from assemble_text - see OverlayText above.
class StructuredPrompt(BaseModel):
    subject: str
    background: str
    composition: str
    lighting: str
    style: str
    negative_prompt: list[str] = Field(default_factory=lambda: list(DEFAULT_NEGATIVE_PROMPT))
    overlay: OverlayText | None = None
