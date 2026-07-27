from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.security import require_pipeline_key
from app.db.session import get_db
from app.schemas.api import (
    DeleteImageResponse,
    GenerateImagesRequest,
    GenerateImagesResponse,
    GeneratePromptRequest,
    GeneratePromptResponse,
    PatchPromptRequest,
    PatchPromptResponse,
    RegenerateImageRequest,
    RegenerateImageResponse,
)
from app.services import generation_service

router = APIRouter(dependencies=[Depends(require_pipeline_key)])


@router.post("/generate-images", response_model=GenerateImagesResponse, status_code=202)
def generate_images(req: GenerateImagesRequest, session: Session = Depends(get_db)):
    result = generation_service.start_generation_job(
        session, page_json=req.page_json, page_type=req.page_type, external_ref=req.external_ref,
    )
    return GenerateImagesResponse(**result)


@router.post("/generate-prompt", response_model=GeneratePromptResponse)
def generate_prompt_preview(req: GeneratePromptRequest):
    spec, prompt = generation_service.preview_prompt(req.page_json, req.page_type, req.role)
    return GeneratePromptResponse(spec=spec, prompt=prompt)


@router.post("/regenerate-image", response_model=RegenerateImageResponse)
def regenerate_image(req: RegenerateImageRequest):
    result = generation_service.regenerate_image(
        req.image_id, prompt_override=req.prompt_override, created_by=req.created_by,
    )
    if result.get("status") == "failed" and result.get("error") in {"image not found", "image has no existing version to regenerate from"}:
        raise HTTPException(404, result["error"])
    return RegenerateImageResponse(
        image_id=req.image_id, version_id=result.get("version_id", 0), status=result.get("status", "failed"),
    )


@router.get("/generation-status")
def generation_status(external_ref: str, session: Session = Depends(get_db)):
    status = generation_service.get_generation_status(session, external_ref)
    if status is None:
        raise HTTPException(404, f"No generation job found for external_ref={external_ref!r}")
    return status


@router.get("/image-history")
def image_history(external_ref: str, session: Session = Depends(get_db)):
    history = generation_service.get_all_image_history(session, external_ref)
    if history is None:
        raise HTTPException(404, f"No generation job found for external_ref={external_ref!r}")
    return history


@router.patch("/prompt", response_model=PatchPromptResponse)
def patch_prompt(req: PatchPromptRequest, session: Session = Depends(get_db)):
    result = generation_service.patch_prompt(session, req.image_id, req.structured_prompt)
    return PatchPromptResponse(**result)


@router.delete("/image/{image_id}", response_model=DeleteImageResponse)
def delete_image(image_id: int, session: Session = Depends(get_db)):
    ok = generation_service.delete_image_version(session, image_id)
    if not ok:
        raise HTTPException(404, f"No image found with id={image_id}")
    return DeleteImageResponse(ok=True, image_id=image_id)
