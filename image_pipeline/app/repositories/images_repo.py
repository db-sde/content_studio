from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Image


def get_or_create(session: Session, *, job_id: int, image_role: str) -> Image:
    existing = session.scalar(
        select(Image).where(Image.job_id == job_id, Image.image_role == image_role)
    )
    if existing:
        return existing
    image = Image(job_id=job_id, image_role=image_role)
    session.add(image)
    session.flush()
    return image


def get(session: Session, image_id: int) -> Image | None:
    return session.get(Image, image_id)


def get_for_job(session: Session, job_id: int) -> list[Image]:
    return list(session.scalars(select(Image).where(Image.job_id == job_id)))


def set_current_version(session: Session, image: Image, version_id: int) -> None:
    image.current_version_id = version_id
    session.flush()
