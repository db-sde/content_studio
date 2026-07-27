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
    hero: ImageSpec
    body1: ImageSpec
    body2: ImageSpec
    body3: ImageSpec

    def all(self) -> list[ImageSpec]:
        return [self.hero, self.body1, self.body2, self.body3]
