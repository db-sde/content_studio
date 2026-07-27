from pydantic import BaseModel, Field

DEFAULT_NEGATIVE_PROMPT = [
    "text",
    "logo",
    "watermark",
    "low quality",
    "blur",
    "pricing table",
    "university name",
    "written words",
    "letters",
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
