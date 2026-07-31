"""Image Planner — turns page_json into an ImageSpecSet.

University pages generate no images at all - not in ROLES_BY_PAGE_TYPE below, so plan_images()
raises a clear error if ever called with page_type="university" (the API layer rejects this
before it gets here - see app.schemas.api.PageType).

Deliberately rule-based, not LLM-driven, for the JSON-driven page types (course/specialization):
the page_type + which sections a page has is already known ahead of time from Content Studio's
own schema (content_studio/src/config/schemas.js), so purpose/placement/priority is a fixed,
deterministic mapping per page type rather than something needing creative judgment. That
judgment is reserved for the Prompt Generator (next stage), which turns "this image is the hero
banner" into an actual visual brief grounded in this specific page - see app.prompts.templates
for the brand's exact per-page-type creative requirements (headline format, chip counts, etc).

Category and blog pages have no such JSON behind them - they're authored as a dropped .docx
instead - so their specs are fixed, hardcoded briefs per role rather than derived from page_json
fields; the whole document's text is what the Prompt Generator grounds itself in for these two.
"""

from app.schemas.spec import ImageRole, ImageSpec, ImageSpecSet

# Page types whose images are planned from a dropped .docx's raw text rather than Content
# Studio's structured JSON facts - there is no JSON to read fields from for these.
DOCX_DRIVEN_PAGE_TYPES = {"category", "blog"}

# How many images (and which roles) each page type gets. Only blog is a multi-image (hero + 3
# supporting) page - every other page type is single-image. University is deliberately absent -
# it generates no images.
ROLES_BY_PAGE_TYPE: dict[str, list[ImageRole]] = {
    "course": ["hero"],
    "specialization": ["hero"],
    "category": ["hero"],
    "blog": ["hero", "body1", "body2", "body3"],
}

# JSON-driven templates - course/specialization each get one hero image. source_fields lists
# every fact the brand's brief for that page type actually wants to ground the highlight
# points/subject-specific visual cues in (see app.prompts.templates.COURSE_SYSTEM_PROMPT /
# SPECIALIZATION_SYSTEM_PROMPT) - deliberately more than a bare name field, since the brief picks
# 3-5 highlights (course) or subject-specific cues (specialization) from whatever's actually given.
_JSON_TEMPLATES: dict[str, dict] = {
    "course": {
        "name_field": "program_name",
        "hero": dict(
            purpose="Establish premium first impression of {name} as a specific degree program",
            placement="Full-width banner at the top of the page",
            visual_objective="Convey the program's professional/academic identity and credibility",
            source_fields=[
                # No fee field here on purpose - the brand brief for this page type explicitly
                # restricts exact fees from ever appearing in the image.
                "program_name", "university_name", "duration", "mode", "naac_grade", "ugc_status",
                "eligibility_summary",
            ],
        ),
    },
}
# Specialization pages follow the same shape as course pages in Content Studio's schema - reuse
# the course template rather than duplicating it.
_JSON_TEMPLATES["specialization"] = _JSON_TEMPLATES["course"]

# Docx-driven templates - fixed briefs per role, no page_json fields involved (there are none).
_DOCX_TEMPLATES: dict[str, dict] = {
    "category": {
        "hero": dict(
            purpose="Establish a premium, trustworthy first impression of this category page",
            placement="Full-width banner at the top of the page",
            visual_objective="Convey credibility and relevance for a prospective student browsing this category",
        ),
    },
    "blog": {
        "hero": dict(
            purpose="Establish an engaging lead image capturing the article's core topic",
            placement="Full-width banner at the top of the article",
            visual_objective="Draw the reader in and visually summarize what the article is about",
        ),
        "body1": dict(
            purpose="Support the article's opening/introductory point",
            placement="Inline within the first third of the article body",
            visual_objective="Illustrate the article's opening idea or context",
        ),
        "body2": dict(
            purpose="Support the article's middle/main point",
            placement="Inline within the middle of the article body",
            visual_objective="Illustrate the article's central argument or key detail",
        ),
        "body3": dict(
            purpose="Support the article's conclusion or takeaway",
            placement="Inline within the final third of the article body",
            visual_objective="Illustrate the article's conclusion, outcome, or call to action",
        ),
    },
}


def _fill(template: str, name: str) -> str:
    return template.format(name=name or "this page")


def plan_images(page_json: dict, page_type: str) -> ImageSpecSet:
    if page_type not in ROLES_BY_PAGE_TYPE:
        raise ValueError(f"No image plan for page_type={page_type!r}")

    roles = ROLES_BY_PAGE_TYPE[page_type]
    specs: dict[str, ImageSpec] = {}

    if page_type in DOCX_DRIVEN_PAGE_TYPES:
        template = _DOCX_TEMPLATES[page_type]
        for priority, role in enumerate(roles, start=1):
            role_template = template[role]
            specs[role] = ImageSpec(
                role=role,
                purpose=role_template["purpose"],
                placement=role_template["placement"],
                visual_objective=role_template["visual_objective"],
                priority=priority,
                source_fields=["docx_text"],
            )
    else:
        template = _JSON_TEMPLATES[page_type]
        name = page_json.get(template["name_field"], "")
        for priority, role in enumerate(roles, start=1):
            role_template = template[role]
            specs[role] = ImageSpec(
                role=role,
                purpose=_fill(role_template["purpose"], name),
                placement=role_template["placement"],
                visual_objective=role_template["visual_objective"],
                priority=priority,
                source_fields=role_template["source_fields"],
            )

    return ImageSpecSet(specs=specs)
