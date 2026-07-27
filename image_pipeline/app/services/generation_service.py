"""Orchestration layer the routers call into - the only place that wires together the planner,
prompt generator, Celery chord, and repositories for each of the 7 REST endpoints."""

import json

from celery import chord, group
from sqlalchemy.orm import Session

from app.planner.image_planner import plan_images
from app.prompts.prompt_generator import generate_prompt
from app.repositories import images_repo, jobs_repo, prompts_repo, providers_repo, versions_repo
from app.schemas.api import (
    GenerationStatusResponse,
    ImageHistoryResponse,
    ImageResult,
    ImageVersionSummary,
)
from app.schemas.prompt import StructuredPrompt
from app.schemas.spec import ImageRole, ImageSpec
from app.tasks.generation_tasks import generate_single_image_task, finalize_job_task, regenerate_single_image_task

_ROLES: list[ImageRole] = ["hero", "body1", "body2", "body3"]


def start_generation_job(session: Session, *, page_json: dict, page_type: str, external_ref: str) -> dict:
    job = jobs_repo.create_job(session, external_ref=external_ref, page_type=page_type, page_json=page_json)
    for role in _ROLES:
        images_repo.get_or_create(session, job_id=job.id, image_role=role)
    jobs_repo.set_status(session, job, "processing")

    # A chord: 4 generation tasks run in parallel, finalize_job_task fires once all 4 finish
    # (regardless of individual success/failure - see generation_tasks.py's per-image try/except).
    chord(group(generate_single_image_task.s(job.id, role) for role in _ROLES))(finalize_job_task.s(job.id))

    return {"job_id": job.id, "status": job.status}


def preview_prompt(page_json: dict, page_type: str, role: ImageRole) -> tuple[ImageSpec, StructuredPrompt]:
    """No DB writes - just runs the planner + prompt generator for /generate-prompt, so a
    caller can inspect what would be sent before actually generating an image."""
    spec = next(s for s in plan_images(page_json, page_type).all() if s.role == role)
    structured_prompt = generate_prompt(page_json, spec)
    return spec, structured_prompt


def get_generation_status(session: Session, external_ref: str) -> GenerationStatusResponse | None:
    job = jobs_repo.get_latest_job_by_external_ref(session, external_ref)
    if job is None:
        return None

    images_by_role = {img.image_role: img for img in images_repo.get_for_job(session, job.id)}
    results: dict[str, ImageResult | None] = {}
    for role in _ROLES:
        image = images_by_role.get(role)
        if image is None or image.current_version_id is None:
            results[role] = None
            continue
        version = versions_repo.get(session, image.current_version_id)
        provider = providers_repo.get_by_id(session, version.provider_id)
        results[role] = ImageResult(
            role=role,
            image_id=image.id,
            version_id=version.id,
            status=version.status,
            url=version.storage_url,
            width=version.width,
            height=version.height,
            size_bytes=version.size_bytes,
            format=version.format,
            provider=provider.name if provider else None,
            error_message=version.error_message,
        )

    return GenerationStatusResponse(
        job_id=job.id, external_ref=job.external_ref, status=job.status, error_message=job.error_message, images=results,
    )


def get_all_image_history(session: Session, external_ref: str) -> dict[str, ImageHistoryResponse] | None:
    """Full version history for all 4 roles of the most recent job matching external_ref -
    what Content Studio's version-history panel renders (edit prompt / regenerate / compare)."""
    job = jobs_repo.get_latest_job_by_external_ref(session, external_ref)
    if job is None:
        return None
    images_by_role = {img.image_role: img for img in images_repo.get_for_job(session, job.id)}
    result: dict[str, ImageHistoryResponse] = {}
    for role in _ROLES:
        image = images_by_role.get(role)
        result[role] = get_image_history(session, image.id) if image else ImageHistoryResponse(job_id=job.id, role=role, versions=[])
    return result


def get_image_history(session: Session, image_id: int) -> ImageHistoryResponse | None:
    image = images_repo.get(session, image_id)
    if image is None:
        return None
    versions = versions_repo.get_all_for_image(session, image_id)
    summaries = []
    for v in versions:
        provider = providers_repo.get_by_id(session, v.provider_id)
        summaries.append(
            ImageVersionSummary(
                version_id=v.id, version_number=v.version_number, status=v.status, is_current=bool(v.is_current),
                url=v.storage_url, provider=provider.name if provider else None, created_at=v.created_at, created_by=v.created_by,
            )
        )
    return ImageHistoryResponse(job_id=image.job_id, role=image.image_role, versions=summaries)


def regenerate_image(image_id: int, *, prompt_override: StructuredPrompt | None, created_by: str | None) -> dict:
    """Runs synchronously (calling the Celery task function directly rather than via the
    broker) - a single-image regeneration is fast enough to complete within one HTTP request,
    and the caller needs the resulting version_id back immediately."""
    override_dict = prompt_override.model_dump() if prompt_override is not None else None
    return regenerate_single_image_task(image_id, override_dict, created_by)


def patch_prompt(session: Session, image_id: int, structured_prompt: StructuredPrompt) -> dict:
    """Stores an edited prompt for later use by POST /regenerate-image's prompt_override -
    editing a prompt never triggers generation by itself."""
    assembled_text = json.dumps(structured_prompt.model_dump())  # provider-specific assembly happens at generation time
    prompt = prompts_repo.create(session, structured_prompt=structured_prompt, assembled_text=assembled_text, edited_by_user=True)
    return {"prompt_id": prompt.id, "structured_prompt": structured_prompt}


def delete_image_version(session: Session, image_id: int) -> bool:
    """Soft delete only: clears which version is 'current' for this image slot. No version row
    that ever succeeded is ever hard-deleted - full history stays queryable via image-history."""
    image = images_repo.get(session, image_id)
    if image is None:
        return False
    image.current_version_id = None
    session.flush()
    return True
