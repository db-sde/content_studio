import json

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.db.models import ImageVersion
from app.schemas.spec import ImageSpec


# Every call inserts a brand-new row and demotes whatever was previously current — versions are
# never updated in place and never deleted once they exist, so "keep previous version" falls out
# of this for free rather than needing separate history-tracking logic.
def create_version(
    session: Session,
    *,
    image_id: int,
    spec: ImageSpec,
    prompt_id: int | None,
    provider_id: int | None,
    created_by: str | None = None,
) -> ImageVersion:
    session.execute(
        update(ImageVersion).where(ImageVersion.image_id == image_id).values(is_current=0)
    )
    next_number = (
        session.scalar(
            select(ImageVersion.version_number)
            .where(ImageVersion.image_id == image_id)
            .order_by(ImageVersion.version_number.desc())
        )
        or 0
    ) + 1

    version = ImageVersion(
        image_id=image_id,
        version_number=next_number,
        spec_json=spec.model_dump_json(),
        prompt_id=prompt_id,
        provider_id=provider_id,
        status="pending",
        is_current=1,
        created_by=created_by,
    )
    session.add(version)
    session.flush()
    return version


def mark_result(
    session: Session,
    version: ImageVersion,
    *,
    status: str,
    storage_url: str | None = None,
    storage_key: str | None = None,
    width: int | None = None,
    height: int | None = None,
    size_bytes: int | None = None,
    format: str | None = None,
    generation_time_ms: int | None = None,
    provider_generation_id: str | None = None,
    error_message: str | None = None,
) -> None:
    version.status = status
    version.storage_url = storage_url
    version.storage_key = storage_key
    version.width = width
    version.height = height
    version.size_bytes = size_bytes
    version.format = format
    version.generation_time_ms = generation_time_ms
    version.provider_generation_id = provider_generation_id
    version.error_message = error_message
    session.flush()


def get(session: Session, version_id: int) -> ImageVersion | None:
    return session.get(ImageVersion, version_id)


def get_current_for_image(session: Session, image_id: int) -> ImageVersion | None:
    return session.scalar(
        select(ImageVersion).where(ImageVersion.image_id == image_id, ImageVersion.is_current == 1)
    )


def get_all_for_image(session: Session, image_id: int) -> list[ImageVersion]:
    return list(
        session.scalars(
            select(ImageVersion)
            .where(ImageVersion.image_id == image_id)
            .order_by(ImageVersion.version_number.desc())
        )
    )


def get_spec(version: ImageVersion) -> ImageSpec:
    return ImageSpec.model_validate(json.loads(version.spec_json))
