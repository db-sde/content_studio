from typing import Any, Literal

from pydantic import BaseModel

from app.schemas.prompt import StructuredPrompt
from app.schemas.spec import ImageRole, ImageSpec

JobStatus = Literal["queued", "processing", "partial", "completed", "failed"]
VersionStatus = Literal["pending", "succeeded", "failed"]


class GenerateImagesRequest(BaseModel):
    page_json: dict[str, Any]
    page_type: Literal["university", "course", "specialization"]
    external_ref: str  # Content Studio's draft.id, e.g. "draft_1784708859674"


class GenerateImagesResponse(BaseModel):
    job_id: int
    status: JobStatus


class GeneratePromptRequest(BaseModel):
    page_json: dict[str, Any]
    page_type: Literal["university", "course", "specialization"]
    role: ImageRole


class GeneratePromptResponse(BaseModel):
    spec: ImageSpec
    prompt: StructuredPrompt


class ImageResult(BaseModel):
    role: ImageRole
    image_id: int | None = None
    version_id: int | None = None
    status: VersionStatus | None = None
    url: str | None = None
    width: int | None = None
    height: int | None = None
    size_bytes: int | None = None
    format: str | None = None
    provider: str | None = None
    error_message: str | None = None


class GenerationStatusResponse(BaseModel):
    job_id: int
    external_ref: str
    status: JobStatus
    error_message: str | None = None
    images: dict[ImageRole, ImageResult | None]


class ImageVersionSummary(BaseModel):
    version_id: int
    version_number: int
    status: VersionStatus
    is_current: bool
    url: str | None
    provider: str | None
    created_at: str
    created_by: str | None


class ImageHistoryResponse(BaseModel):
    job_id: int
    role: ImageRole
    versions: list[ImageVersionSummary]


class RegenerateImageRequest(BaseModel):
    image_id: int
    prompt_override: StructuredPrompt | None = None
    created_by: str | None = None


class RegenerateImageResponse(BaseModel):
    image_id: int
    version_id: int
    status: VersionStatus


class PatchPromptRequest(BaseModel):
    image_id: int
    structured_prompt: StructuredPrompt


class PatchPromptResponse(BaseModel):
    prompt_id: int
    structured_prompt: StructuredPrompt


class DeleteImageResponse(BaseModel):
    ok: bool
    image_id: int
