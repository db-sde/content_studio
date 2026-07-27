import json

from sqlalchemy.orm import Session

from app.db.models import AuditLog


def log_event(
    session: Session,
    *,
    event_type: str,
    job_id: int | None = None,
    image_id: int | None = None,
    detail: dict | None = None,
) -> None:
    session.add(
        AuditLog(
            job_id=job_id,
            image_id=image_id,
            event_type=event_type,
            detail_json=json.dumps(detail) if detail is not None else None,
        )
    )
    session.flush()
