"""Image Planner — turns page_json into an ImageSpecSet.

Deliberately rule-based, not LLM-driven: the page_type + which sections a page has is already
known ahead of time from Content Studio's own schema (content_studio/src/config/schemas.js), so
purpose/placement/priority for hero + 3 supporting images is a fixed, deterministic mapping per
page type rather than something that needs creative judgment. That judgment is reserved for the
Prompt Generator (next stage), which does need an LLM to turn "this image is about the Placement
section" into an actual visual description grounded in this specific page's facts.
"""

from app.schemas.spec import ImageSpec, ImageSpecSet

# Each page type maps to a fixed hero + 3-body template. `name_field` is whichever page_json key
# holds the page's own title, used to make purpose/visual_objective read naturally per page
# without needing a template per institution. `source_fields` lists page_json keys the Prompt
# Generator should read facts from for that image — never full sections verbatim, just the keys
# relevant to what this specific image is meant to depict.
_TEMPLATES: dict[str, dict] = {
    "university": {
        "name_field": "university_name",
        "hero": dict(
            purpose="Establish premium, trustworthy first impression of {name} as a higher-education brand",
            placement="Full-width banner at the top of the page",
            visual_objective="Convey credibility and modern online/distance learning for a serious adult learner audience",
            source_fields=["university_name", "university_full_name", "established_year", "naac_grade", "ugc_approved", "mode_of_learning"],
        ),
        "body1": dict(
            purpose="Support the Why Choose section's persuasive case for {name}",
            placement="Inline within the Why Choose section",
            visual_objective="Depict a confident learner engaged in online study, evoking the university's key differentiators",
            source_fields=["why_choose_heading", "why_choose_content", "why_choose_additional_notes", "accreditations"],
        ),
        "body2": dict(
            purpose="Support the Programs section listing what {name} offers",
            placement="Inline within the Programs section",
            visual_objective="Depict academic variety and professional growth across multiple programs",
            source_fields=["programs_heading", "programs_intro", "programs_table"],
        ),
        "body3": dict(
            purpose="Support the Placement section's outcomes for {name} graduates",
            placement="Inline within the Placement section",
            visual_objective="Depict real-world career success and workplace confidence",
            source_fields=["placement_heading", "placement_stats", "placement_additional_notes", "placement_content"],
        ),
    },
    "course": {
        "name_field": "program_name",
        "hero": dict(
            purpose="Establish premium first impression of {name} as a specific degree program",
            placement="Full-width banner at the top of the page",
            visual_objective="Convey the program's professional/academic identity and credibility",
            source_fields=["program_name", "university_name", "duration", "mode", "naac_grade", "ugc_status"],
        ),
        "body1": dict(
            purpose="Support the Highlights section's case for {name}",
            placement="Inline within the Highlights section",
            visual_objective="Depict a learner engaged with this specific field of study",
            source_fields=["highlights_heading", "highlights"],
        ),
        "body2": dict(
            purpose="Support the Specializations section under {name}",
            placement="Inline within the Specializations section",
            visual_objective="Depict variety and choice of specialization tracks within the program",
            source_fields=["specializations_heading", "specializations_intro"],
        ),
        "body3": dict(
            purpose="Support the Placement section's outcomes for {name} graduates",
            placement="Inline within the Placement section",
            visual_objective="Depict real-world career success tied to this specific program",
            source_fields=["placement_heading", "placement_stats", "placement_content"],
        ),
    },
}
# Specialization pages follow the same shape as course pages in Content Studio's schema (about +
# placement, no why_choose/emi) — reuse the course template rather than duplicating it.
_TEMPLATES["specialization"] = _TEMPLATES["course"]


def _fill(template: str, name: str) -> str:
    return template.format(name=name or "this program")


def plan_images(page_json: dict, page_type: str) -> ImageSpecSet:
    if page_type not in _TEMPLATES:
        raise ValueError(f"No image plan template for page_type={page_type!r}")

    template = _TEMPLATES[page_type]
    name = page_json.get(template["name_field"], "")

    specs = {}
    for priority, role in enumerate(["hero", "body1", "body2", "body3"], start=1):
        role_template = template[role]
        specs[role] = ImageSpec(
            role=role,
            purpose=_fill(role_template["purpose"], name),
            placement=role_template["placement"],
            visual_objective=role_template["visual_objective"],
            priority=priority,
            source_fields=role_template["source_fields"],
        )

    return ImageSpecSet(**specs)
