"""Prompt Generator — turns an ImageSpec + grounding content into a StructuredPrompt.

LLM-assisted, not template-only: the *shape* of a structured prompt is fixed and
validated by Pydantic, but the creative language (subject/background/composition/
lighting/style) has to vary per page in a way a static template can't across thousands
of different pages. `negative_prompt` is deliberately NOT part of what the model
generates - it's a fixed constraint the backend owns, so it can never be softened or
dropped by the model's own judgement.

Two grounding sources, same output shape: course/specialization pages are grounded in a
subset of Content Studio's structured JSON facts; category/blog pages have no JSON at all
(they're authored as a dropped .docx) and are grounded in that document's raw extracted
text instead. Which one applies is decided once, by page_type, via DOCX_DRIVEN_PAGE_TYPES -
callers never need to branch on this themselves.

The actual creative brief per page type - course/specialization/category get very specific,
brand-defined instructions (exact headline format, chip counts, word limits, discipline-specific
visual cues); blog gets a broader editorial brief plus a per-role addendum (hero vs. supporting
1/2/3). See app.prompts.templates for all of these.
"""

import json

from anthropic import Anthropic
from pydantic import BaseModel

from app.core.config import get_settings
from app.planner.image_planner import DOCX_DRIVEN_PAGE_TYPES
from app.prompts.templates import (
    BLOG_ROLE_ADDENDA,
    BLOG_SYSTEM_PROMPT,
    CATEGORY_SYSTEM_PROMPT,
    COURSE_SYSTEM_PROMPT,
    SPECIALIZATION_SYSTEM_PROMPT,
)
from app.schemas.prompt import DEFAULT_NEGATIVE_PROMPT, StructuredPrompt
from app.schemas.spec import ImageSpec

# Docx text is capped before being sent to the model - a sane guard against a pathologically
# huge upload inflating latency/cost, well beyond what any real article/category doc needs.
_MAX_DOCX_CHARS = 20000

# Course/specialization are the only JSON-driven page types left (university generates no images).
_JSON_SYSTEM_PROMPTS: dict[str, str] = {
    "course": COURSE_SYSTEM_PROMPT,
    "specialization": SPECIALIZATION_SYSTEM_PROMPT,
}

# Category is docx-driven with a single fixed brief; blog is docx-driven with a shared brief plus
# a per-role addendum layered on (hero vs. supporting 1/2/3 each have a distinct job).
_DOCX_SYSTEM_PROMPTS: dict[str, str] = {
    "category": CATEGORY_SYSTEM_PROMPT,
}


class _LLMPromptFields(BaseModel):
    subject: str
    background: str
    composition: str
    lighting: str
    style: str


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


def _generate_from_facts(page_json: dict, spec: ImageSpec, *, page_type: str) -> StructuredPrompt:
    facts = _facts_for_spec(page_json, spec)
    system_prompt = _JSON_SYSTEM_PROMPTS[page_type]
    user_content = (
        f"Image role: {spec.role}\n"
        f"Placement: {spec.placement}\n"
        f"Grounding facts (JSON) - use these exact real names/values, never invent ones not "
        f"present here: {json.dumps(facts, ensure_ascii=False)}"
    )
    return _call_model(system_prompt, user_content)


def _generate_from_docx_text(docx_text: str, spec: ImageSpec, *, page_type: str) -> StructuredPrompt:
    trimmed = (docx_text or "")[:_MAX_DOCX_CHARS]
    system_prompt = _DOCX_SYSTEM_PROMPTS.get(page_type)
    if system_prompt is None:
        # blog: shared brief + a role-specific addendum (hero vs. supporting 1/2/3)
        system_prompt = BLOG_SYSTEM_PROMPT + "\n\n" + BLOG_ROLE_ADDENDA.get(spec.role, "")
    user_content = (
        f"Image role: {spec.role}\n"
        f"Placement: {spec.placement}\n"
        f"Source document text:\n{trimmed}"
    )
    return _call_model(system_prompt, user_content)


def generate_prompt(page_json: dict, spec: ImageSpec, *, page_type: str) -> StructuredPrompt:
    if page_type in DOCX_DRIVEN_PAGE_TYPES:
        return _generate_from_docx_text(page_json.get("docx_text", ""), spec, page_type=page_type)
    return _generate_from_facts(page_json, spec, page_type=page_type)
