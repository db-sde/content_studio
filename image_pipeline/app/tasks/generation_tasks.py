"""Celery tasks for the 4-images-in-parallel generation chord, plus single-image regeneration.

One job = one `chord`: a `group` of 4 `generate_single_image_task` calls (one per image role),
with `finalize_job_task` as the callback that rolls the 4 individual results up into the job's
overall status. Failure of one image is caught and recorded per-image (never re-raised), so it
never blocks or fails the other 3 - partial success is a first-class job status, not an error.
"""

import json

from app.db.session import session_scope
from app.planner.image_planner import plan_images
from app.processing.image_processor import TARGET_DIMENSIONS, process_image
from app.prompts.prompt_generator import generate_prompt
from app.providers.base import NotImplementedProviderError
from app.providers.provider_factory import get_provider
from app.repositories import audit_repo, images_repo, jobs_repo, prompts_repo, providers_repo, versions_repo
from app.schemas.prompt import StructuredPrompt
from app.storage.storage_factory import get_storage_backend
from app.tasks.celery_app import celery_app

# Providers to try in order when the configured one fails - Phase 2 will populate real
# OpenAIProvider/IdeogramProvider implementations; NotImplementedProviderError means "not
# built yet," so it's skipped here rather than counted as a retryable failure.
_FALLBACK_ORDER = ["flux", "openai", "ideogram"]

_MAX_ATTEMPTS_PER_PROVIDER = 2


@celery_app.task(name="generation.generate_single_image", bind=True)
def generate_single_image_task(self, job_id: int, role: str) -> dict:
    with session_scope() as session:
        job = jobs_repo.get_job(session, job_id)
        if job is None:
            return {"role": role, "status": "failed", "error": "job not found"}

        page_json = json.loads(job.source_json)
        spec = next(s for s in plan_images(page_json, job.page_type).all() if s.role == role)
        image = images_repo.get_or_create(session, job_id=job_id, image_role=role)

        try:
            structured_prompt = generate_prompt(page_json, spec, page_type=job.page_type)
        except Exception as exc:  # noqa: BLE001 - recorded, not re-raised; see module docstring
            _record_failure(session, image_id=image.id, spec=spec, error=str(exc))
            return {"role": role, "status": "failed", "error": str(exc)}

        return _generate_and_store_version(
            session, job_id=job_id, image=image, role=role, spec=spec, structured_prompt=structured_prompt,
        )


@celery_app.task(name="generation.regenerate_single_image", bind=True)
def regenerate_single_image_task(self, image_id: int, prompt_override: dict | None, created_by: str | None) -> dict:
    """Standalone regeneration outside the 4-way chord - used by POST /regenerate-image.
    Reuses the image's current spec (from its most recent version) rather than re-running the
    Image Planner, since the page's structure hasn't changed, only this one image is redone."""
    with session_scope() as session:
        image = images_repo.get(session, image_id)
        if image is None:
            return {"status": "failed", "error": "image not found"}

        current_version = versions_repo.get_current_for_image(session, image_id)
        if current_version is None:
            return {"status": "failed", "error": "image has no existing version to regenerate from"}
        spec = versions_repo.get_spec(current_version)

        if prompt_override is not None:
            structured_prompt = StructuredPrompt.model_validate(prompt_override)
        else:
            job = jobs_repo.get_job(session, image.job_id)
            page_json = json.loads(job.source_json) if job else {}
            try:
                structured_prompt = generate_prompt(page_json, spec, page_type=job.page_type if job else "")
            except Exception as exc:  # noqa: BLE001
                return {"status": "failed", "error": str(exc)}

        result = _generate_and_store_version(
            session, job_id=image.job_id, image=image, role=image.image_role, spec=spec,
            structured_prompt=structured_prompt, created_by=created_by,
        )
        return result


@celery_app.task(name="generation.finalize_job")
def finalize_job_task(results: list[dict], job_id: int) -> dict:
    with session_scope() as session:
        job = jobs_repo.get_job(session, job_id)
        if job is None:
            return {"job_id": job_id, "status": "failed"}

        statuses = [r.get("status") for r in results]
        if all(s == "succeeded" for s in statuses):
            final_status = "completed"
        elif any(s == "succeeded" for s in statuses):
            final_status = "partial"
        else:
            final_status = "failed"

        jobs_repo.set_status(session, job, final_status)
        audit_repo.log_event(session, event_type="job_finalized", job_id=job_id, detail={"results": results})
        return {"job_id": job_id, "status": final_status}


def _generate_and_store_version(session, *, job_id: int, image, role: str, spec, structured_prompt, created_by: str | None = None) -> dict:
    """Shared by the main per-job task and standalone regeneration: try each candidate provider
    (with a couple of retries each) until one succeeds, process + store the result, and record
    a new version. Never raises - always returns a {role, status, ...} result dict."""
    error_message = None
    for provider_name in _candidate_providers():
        provider = get_provider(provider_name)
        # A prompt row is stored per provider attempt (not once up front) - assembled_text is
        # provider-specific, so this captures the exact text actually sent for whichever attempt
        # succeeds (or the last one tried, if all fail).
        assembled_text = provider.assemble_text(structured_prompt)
        prompt_row = prompts_repo.create(session, structured_prompt=structured_prompt, assembled_text=assembled_text)
        target_w, target_h = TARGET_DIMENSIONS.get(role, (1600, 900))
        for _ in range(_MAX_ATTEMPTS_PER_PROVIDER):
            try:
                generated = provider.generate(structured_prompt, width=target_w, height=target_h)
                provider_row = providers_repo.get_by_name(session, provider.name)
                processed = process_image(generated.image_bytes, role=role)
                storage = get_storage_backend()
                key = f"job_{job_id}/{role}_v{_next_version_number(session, image.id)}.webp"
                url = storage.save(key=key, data=processed.image_bytes, content_type="image/webp")

                version = versions_repo.create_version(
                    session,
                    image_id=image.id,
                    spec=spec,
                    prompt_id=prompt_row.id,
                    provider_id=provider_row.id if provider_row else None,
                    created_by=created_by,
                )
                versions_repo.mark_result(
                    session,
                    version,
                    status="succeeded",
                    storage_url=url,
                    storage_key=key,
                    width=processed.width,
                    height=processed.height,
                    size_bytes=processed.size_bytes,
                    format=processed.format,
                    generation_time_ms=generated.generation_time_ms,
                    provider_generation_id=generated.provider_generation_id,
                )
                images_repo.set_current_version(session, image, version.id)
                audit_repo.log_event(
                    session, event_type="image_generated", job_id=job_id, image_id=image.id,
                    detail={"role": role, "provider": provider.name},
                )
                return {"role": role, "status": "succeeded", "version_id": version.id}
            except NotImplementedProviderError:
                break  # this provider isn't built yet - try the next one, don't retry it
            except Exception as exc:  # noqa: BLE001
                error_message = str(exc)
                continue

    _record_failure(session, image_id=image.id, spec=spec, error=error_message or "all providers failed")
    return {"role": role, "status": "failed", "error": error_message}


def _candidate_providers() -> list[str]:
    from app.core.config import get_settings

    settings = get_settings()
    if settings.provider_mode == "mock":
        return ["mock"]
    ordered = [settings.image_provider] + [p for p in _FALLBACK_ORDER if p != settings.image_provider]
    return ordered


def _next_version_number(session, image_id: int) -> int:
    existing = versions_repo.get_all_for_image(session, image_id)
    return len(existing) + 1


def _record_failure(session, *, image_id: int, spec, error: str) -> None:
    version = versions_repo.create_version(session, image_id=image_id, spec=spec, prompt_id=None, provider_id=None)
    versions_repo.mark_result(session, version, status="failed", error_message=error)
