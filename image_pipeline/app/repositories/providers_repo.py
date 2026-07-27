from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Provider


def get_by_name(session: Session, name: str) -> Provider | None:
    return session.scalar(select(Provider).where(Provider.name == name))


def get_by_id(session: Session, provider_id: int | None) -> Provider | None:
    if provider_id is None:
        return None
    return session.get(Provider, provider_id)
