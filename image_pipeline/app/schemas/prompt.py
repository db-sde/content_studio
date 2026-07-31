from pydantic import BaseModel, Field


# Every remaining page type (course/specialization/category/blog - university generates no images
# at all) deliberately wants real on-image typography (a headline, chips, a subheading) baked into
# the hero, per the brand's master prompt brief - so unlike an earlier version of this list,
# "text"/"written words"/"letters" are NOT suppressed here. Everything else the brief explicitly
# restricts still is. Note: current FLUX Schnell generations render on-image text imperfectly
# (misspellings/garbled glyphs are a known limitation of fast diffusion models), not a prompt issue.
DEFAULT_NEGATIVE_PROMPT = [
    "invented university logo",
    "invented seal",
    "trademark violation",
    "watermark",
    "low quality",
    "blur",
    "misspelled text",
    "garbled typography",
    "fake statistics",
    "scholarship badge",
    "promotional sticker",
    "sale banner",
    "admission countdown",
    "apply now button",
    "exact fee amount",
    "ranking badge",
]


# Structured prompt object — never a raw string. Providers each turn this into their own final
# text (see app/providers/base.py's assemble_text), so the frontend/Node side never sees or
# stores a provider-specific prompt string, only this structured shape.
class StructuredPrompt(BaseModel):
    subject: str
    background: str
    composition: str
    lighting: str
    style: str
    negative_prompt: list[str] = Field(default_factory=lambda: list(DEFAULT_NEGATIVE_PROMPT))
