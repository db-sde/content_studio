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
in by the image model itself, since diffusion models reliably garble rendered text. Chips are
always computed directly from the exact JSON facts for course/specialization (_deterministic_chips)
since they're just exact values with no wording judgement involved. The headline is different: raw
university_name/course-name fields often overlap (e.g. one already ends in "Online"), and merging
that into one clean, non-duplicated phrase is a language task Claude is reliable at - unlike a
diffusion model rendering pixels, this carries no spelling-garbling risk, so the LLM's own merged
headline is trusted as long as it's still verifiably grounded in the real name
(_is_grounded_headline); otherwise a safe fallback concatenation is used instead
(_fallback_headline). Category/blog have no structured facts to fall back to at all, so the LLM's
own grounded text is used as-is there.
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


def _fallback_headline(university: str, name: str) -> str:
    """Dumb-but-safe concatenation, used only when the LLM's own headline doesn't look grounded
    in the real facts (see _is_grounded_headline) - naive word-overlap collapsing can still
    produce an awkward phrase in edge cases, but it's a last resort, not the primary path."""
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


def _is_grounded_headline(headline: str, name: str) -> bool:
    """Real-world university_name/program_name text isn't always clean (e.g. a university_name
    field of "Sharda University Online" plus a program_name of "Sharda Online MBA" naively
    concatenates into a duplicated "Sharda University Online Sharda Online MBA"). Merging that
    kind of overlap into one natural phrase is a language task Claude is reliable at (unlike a
    diffusion model rendering pixels) - so the LLM's own merged headline (see
    _OVERLAY_OUTPUT_RULE) is trusted as long as it's still clearly grounded in the real course/
    specialization name, rather than re-derived with a brittle Python heuristic every time."""
    if not headline:
        return False
    headline_lower = headline.lower()
    significant = [w for w in name.split() if len(w) > 2]
    if not significant:
        return True
    matched = sum(1 for w in significant if w.lower() in headline_lower)
    return matched / len(significant) >= 0.6


def _deterministic_chips(page_json: dict) -> list[str]:
    """Chips are just whichever short facts (mode/duration/accreditation) are present - always
    computed directly from page_json since these are exact values with no merging/wording
    judgement involved."""
    chip_candidates = [page_json.get("mode"), page_json.get("duration"), page_json.get("naac_grade") or page_json.get("ugc_status")]
    return [c.strip() for c in chip_candidates if c and c.strip()][:3]


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

    # Chips are always computed directly (exact facts, no wording judgement needed). The
    # headline is trusted from the LLM (it naturally merges overlapping university/course-name
    # text - see _OVERLAY_OUTPUT_RULE) as long as it's still clearly grounded in the real name;
    # otherwise fall back to a safe concatenation rather than risk an invented headline.
    university = (page_json.get("university_name") or "").strip()
    name = (page_json.get(_NAME_FIELD_BY_JSON_PAGE_TYPE[page_type]) or "").strip()
    llm_headline = (structured_prompt.overlay.headline if structured_prompt.overlay else "").strip()
    headline = llm_headline if _is_grounded_headline(llm_headline, name) else _fallback_headline(university, name)

    structured_prompt.overlay = OverlayText(headline=headline or "Online Program", chips=_deterministic_chips(page_json))
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
