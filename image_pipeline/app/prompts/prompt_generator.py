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

The model also returns headline/subheading/chips text (see StructuredPrompt.overlay) - this is
composited onto the image afterward with a real font (app.processing.text_overlay), never baked
in by the image model itself, since diffusion models reliably garble rendered text. For
course/specialization the LLM's headline/chips are discarded and replaced with values computed
directly from the exact JSON facts (_deterministic_overlay) - those are real names/numbers already
known exactly, so there's no reason to let the LLM re-guess them. Category/blog have no such
structured source of truth, so the LLM's own grounded text is used as-is there.
"""

import json

from anthropic import Anthropic
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.planner.image_planner import DOCX_DRIVEN_PAGE_TYPES
from app.prompts.templates import (
    BLOG_ROLE_ADDENDA,
    BLOG_SYSTEM_PROMPT,
    CATEGORY_SYSTEM_PROMPT,
    COURSE_SYSTEM_PROMPT,
    SPECIALIZATION_SYSTEM_PROMPT,
)
from app.schemas.prompt import DEFAULT_NEGATIVE_PROMPT, OverlayText, StructuredPrompt
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

# The exact field name each JSON-driven page type's name comes from in Content Studio's own
# schema (content_studio/src/config/schemas.js) - course uses program_name, specialization uses
# spec_name. These are NOT the same field, so this must be looked up per page_type rather than
# assumed to be one shared key.
_NAME_FIELD_BY_JSON_PAGE_TYPE: dict[str, str] = {
    "course": "program_name",
    "specialization": "spec_name",
}


class _LLMPromptFields(BaseModel):
    subject: str
    background: str
    composition: str
    lighting: str
    style: str
    headline: str
    subheading: str | None = None
    chips: list[str] = Field(default_factory=list)


class PromptGenerationError(RuntimeError):
    pass


def _facts_for_spec(page_json: dict, spec: ImageSpec) -> dict:
    return {key: page_json.get(key) for key in spec.source_fields if page_json.get(key)}


def _build_headline(university: str, name: str) -> str:
    """"[University Name] [Program/Specialization Name]" - except real-world data entry isn't
    always clean (e.g. a university_name field of "Sharda University Online" plus a program_name
    of "Sharda Online MBA" naively concatenates into "Sharda University Online Sharda Online
    MBA"). If most of university's words already appear somewhere in name, trust that name is
    already self-contained and skip prepending it again, rather than duplicate words."""
    if not university:
        return name or "Online Program"
    if not name:
        return university

    uni_words = [w.lower() for w in university.split()]
    name_lower = name.lower()
    overlap = sum(1 for w in uni_words if w in name_lower) / len(uni_words)
    if overlap >= 0.5:
        return name
    return f"{university} {name}"


def _deterministic_overlay(page_json: dict, *, page_type: str) -> OverlayText:
    """Course/specialization headlines are just "[University Name] [Program/Specialization
    Name]" and chips are just whichever short facts (mode/duration/accreditation) are present -
    all values already known exactly from page_json, so compute them directly rather than trust
    an LLM to copy them correctly."""
    university = (page_json.get("university_name") or "").strip()
    name = (page_json.get(_NAME_FIELD_BY_JSON_PAGE_TYPE[page_type]) or "").strip()
    headline = _build_headline(university, name)

    chip_candidates = [page_json.get("mode"), page_json.get("duration"), page_json.get("naac_grade") or page_json.get("ugc_status")]
    chips = [c.strip() for c in chip_candidates if c and c.strip()][:3]

    return OverlayText(headline=headline or "Online Program", chips=chips)


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
        overlay=OverlayText(headline=fields.headline, subheading=fields.subheading, chips=fields.chips[:3]),
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
    structured_prompt = _call_model(system_prompt, user_content)
    # Replace whatever the LLM guessed for headline/chips with the exact real values - see
    # _deterministic_overlay's docstring for why.
    structured_prompt.overlay = _deterministic_overlay(page_json, page_type=page_type)
    return structured_prompt


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
    structured_prompt = _call_model(system_prompt, user_content)
    if page_type == "blog" and spec.role != "hero":
        # Only the blog hero gets a composited headline - supporting images 1-3 are clean visuals.
        structured_prompt.overlay = None
    return structured_prompt


def generate_prompt(page_json: dict, spec: ImageSpec, *, page_type: str) -> StructuredPrompt:
    if page_type in DOCX_DRIVEN_PAGE_TYPES:
        return _generate_from_docx_text(page_json.get("docx_text", ""), spec, page_type=page_type)
    return _generate_from_facts(page_json, spec, page_type=page_type)
