import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import GenerationJob, iso_now


def create_job(session: Session, *, external_ref: str, page_type: str, page_json: dict) -> GenerationJob:
    job = GenerationJob(
        external_ref=external_ref,
        page_type=page_type,
        status="queued",
        source_json=json.dumps(page_json),
    )
    session.add(job)
    session.flush()
    return job


def get_job(session: Session, job_id: int) -> GenerationJob | None:
    return session.get(GenerationJob, job_id)


# Most-recent job for a page — a page can be regenerated as a whole (re-running /generate-images)
# any number of times; the latest job is what generation-status/image-history operate on.
def get_latest_job_by_external_ref(session: Session, external_ref: str) -> GenerationJob | None:
    return session.scalar(
        select(GenerationJob)
        .where(GenerationJob.external_ref == external_ref)
        .order_by(GenerationJob.id.desc())
    )


def set_status(session: Session, job: GenerationJob, status: str, *, error_message: str | None = None) -> None:
    job.status = status
    if error_message is not None:
        job.error_message = error_message
    if status == "processing" and not job.started_at:
        job.started_at = iso_now()
    if status in ("completed", "failed", "partial"):
        job.completed_at = iso_now()
    session.flush()
