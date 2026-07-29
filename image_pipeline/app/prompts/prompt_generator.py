"""Prompt Generator — turns an ImageSpec + grounding content into a StructuredPrompt.

LLM-assisted, not template-only: the *shape* of a structured prompt is fixed and
validated by Pydantic, but the creative language (subject/background/composition/
lighting/style) has to vary per page in a way a static template can't across thousands
of different pages. `negative_prompt` is deliberately NOT part of what the model
generates - it's a fixed constraint the backend owns (no on-image text, logos, or
pricing), so it can never be softened or dropped by the model's own judgement.

Two grounding sources, same output shape: university/course/specialization pages are
grounded in a subset of Content Studio's structured JSON facts; category/blog pages have
no JSON at all (they're authored as a dropped .docx) and are grounded in that document's
raw extracted text instead. Which one applies is decided once, by page_type, via
DOCX_DRIVEN_PAGE_TYPES - callers never need to branch on this themselves.
"""

import json

from anthropic import Anthropic
from pydantic import BaseModel

from app.core.config import get_settings
from app.planner.image_planner import DOCX_DRIVEN_PAGE_TYPES
from app.schemas.prompt import DEFAULT_NEGATIVE_PROMPT, StructuredPrompt
from app.schemas.spec import ImageSpec

# Docx text is capped before being sent to the model - a sane guard against a pathologically
# huge upload inflating latency/cost, well beyond what any real article/category doc needs.
_MAX_DOCX_CHARS = 20000


class _LLMPromptFields(BaseModel):
    subject: str
    background: str
    composition: str
    lighting: str
    style: str


_SYSTEM_PROMPT = """You are a creative director for a premium educational marketing website. \
Given an image's purpose and the real facts behind it, write a structured visual brief for a \
professional photorealistic marketing photograph - the kind an agency would commission for a \
university or degree program, not generic AI-art.

Rules:
- Ground every detail in the facts provided. Never invent institution names, statistics, or claims.
- The subject and background must read as premium, modern, and realistic - editorial photography, \
  not stock-photo cliche or sci-fi/fantasy imagery.
- Never describe any text, logo, signage, price, or number appearing IN the image itself - all \
  on-image text/branding is composited separately afterward. Describe only the visual scene.
- Composition should account for where this image is placed on the page (e.g. leave clear space \
  for a heading if it's a hero banner)."""

_DOCX_SYSTEM_PROMPT = """You are a creative director for a premium educational marketing website. \
Given an image's purpose/placement and the full text of the source article/category document it \
illustrates, write a structured visual brief for a professional photorealistic marketing \
photograph - the kind an agency would commission, not generic AI-art.

Rules:
- Ground every detail in the document text provided. Never invent facts, names, or statistics \
  not present in it.
- The subject and background must read as premium, modern, and realistic - editorial photography, \
  not stock-photo cliche or sci-fi/fantasy imagery.
- Never describe any text, logo, signage, price, or number appearing IN the image itself - all \
  on-image text/branding is composited separately afterward. Describe only the visual scene.
- Composition should account for where this image is placed on the page (e.g. leave clear space \
  for a heading if it's a hero banner).
- This image is one of several illustrating the same document - make it visually distinct from \
  an image covering a different part of the same piece."""


class PromptGenerationError(RuntimeError):
    pass


def _facts_for_spec(page_json: dict, spec: ImageSpec) -> dict:
    return {key: page_json.get(key) for key in spec.source_fields if page_json.get(key)}


def _call_model(system_prompt: str, user_content: str) -> StructuredPrompt:
    settings = get_settings()
    client = Anthropic(api_key=settings.anthropic_api_key)

    response = client.messages.parse(
        model=settings.anthropic_model,
        max_tokens=4096,
        system=system_prompt,
        messages=[{"role": "user", "content": user_content}],
        output_format=_LLMPromptFields,
    )

    if response.stop_reason == "refusal" or response.parsed_output is None:
        raise PromptGenerationError(
            f"Prompt generation did not return parsed output (stop_reason={response.stop_reason!r})"
        )

    fields = response.parsed_output
    return StructuredPrompt(
        subject=fields.subject,
        background=fields.background,
        composition=fields.composition,
        lighting=fields.lighting,
        style=fields.style,
        negative_prompt=list(DEFAULT_NEGATIVE_PROMPT),
    )


def _generate_from_facts(page_json: dict, spec: ImageSpec) -> StructuredPrompt:
    facts = _facts_for_spec(page_json, spec)
    user_content = (
        f"Image role: {spec.role}\n"
        f"Purpose: {spec.purpose}\n"
        f"Placement: {spec.placement}\n"
        f"Visual objective: {spec.visual_objective}\n"
        f"Grounding facts (JSON): {json.dumps(facts, ensure_ascii=False)}"
    )
    return _call_model(_SYSTEM_PROMPT, user_content)


def _generate_from_docx_text(docx_text: str, spec: ImageSpec) -> StructuredPrompt:
    trimmed = (docx_text or "")[:_MAX_DOCX_CHARS]
    user_content = (
        f"Image role: {spec.role}\n"
        f"Purpose: {spec.purpose}\n"
        f"Placement: {spec.placement}\n"
        f"Visual objective: {spec.visual_objective}\n"
        f"Source document text:\n{trimmed}"
    )
    return _call_model(_DOCX_SYSTEM_PROMPT, user_content)


def generate_prompt(page_json: dict, spec: ImageSpec, *, page_type: str) -> StructuredPrompt:
    if page_type in DOCX_DRIVEN_PAGE_TYPES:
        return _generate_from_docx_text(page_json.get("docx_text", ""), spec)
    return _generate_from_facts(page_json, spec)
