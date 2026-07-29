from typing import Literal

from pydantic import BaseModel, Field

ImageRole = Literal["hero", "body1", "body2", "body3"]


# Produced by the Image Planner. Deliberately NOT a prompt yet — this is "what is this image for
# and why," independent of any provider or wording, so it can be inspected/edited/audited on its
# own before any creative language gets attached to it.
class ImageSpec(BaseModel):
    role: ImageRole
    purpose: str = Field(..., description="What this image communicates on the page")
    placement: str = Field(..., description="Where on the page this image is used")
    visual_objective: str = Field(..., description="What the image should visually achieve")
    priority: int = Field(..., ge=1, le=4)
    source_fields: list[str] = Field(
        default_factory=list, description="page_json keys this image should be grounded in"
    )


class ImageSpecSet(BaseModel):
    """Holds however many roles a given page type actually needs - 1 for a single-image page
    (university/course/specialization/category), 4 for a multi-image one (blog)."""
    specs: dict[ImageRole, ImageSpec]

    def all(self) -> list[ImageSpec]:
        return list(self.specs.values())
