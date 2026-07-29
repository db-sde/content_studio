"""Image Planner — turns page_json into an ImageSpecSet.

Deliberately rule-based, not LLM-driven, for the JSON-driven page types (university/course/
specialization): the page_type + which sections a page has is already known ahead of time from
Content Studio's own schema (content_studio/src/config/schemas.js), so purpose/placement/priority
is a fixed, deterministic mapping per page type rather than something needing creative judgment.
That judgment is reserved for the Prompt Generator (next stage), which does need an LLM to turn
"this image is the hero banner" into an actual visual description grounded in this specific page.

Category and blog pages have no such JSON behind them - they're authored as a dropped .docx
instead - so their specs are fixed, hardcoded briefs per role rather than derived from page_json
fields; the whole document's text is what the Prompt Generator grounds itself in for these two.
"""

from app.schemas.spec import ImageRole, ImageSpec, ImageSpecSet

# Page types whose images are planned from a dropped .docx's raw text rather than Content
# Studio's structured JSON facts - there is no JSON to read fields from for these.
DOCX_DRIVEN_PAGE_TYPES = {"category", "blog"}

# How many images (and which roles) each page type gets. Only blog is a multi-image (hero + 3
# supporting) page - every other page type, including the JSON-driven ones, is single-image.
ROLES_BY_PAGE_TYPE: dict[str, list[ImageRole]] = {
    "university": ["hero"],
    "course": ["hero"],
    "specialization": ["hero"],
    "category": ["hero"],
    "blog": ["hero", "body1", "body2", "body3"],
}

# JSON-driven templates - university/course/specialization each get one hero image.
_JSON_TEMPLATES: dict[str, dict] = {
    "university": {
        "name_field": "university_name",
        "hero": dict(
            purpose="Establish premium, trustworthy first impression of {name} as a higher-education brand",
            placement="Full-width banner at the top of the page",
            visual_objective="Convey credibility and modern online/distance learning for a serious adult learner audience",
            source_fields=["university_name", "university_full_name", "established_year", "naac_grade", "ugc_approved", "mode_of_learning"],
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
