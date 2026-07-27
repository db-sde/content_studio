from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

# Synchronous SQLAlchemy on purpose: Celery workers are fundamentally sync (thread/process-per-
# task), so the generation pipeline's DB access is sync throughout. FastAPI's request handlers
# use the same sync sessions via a dependency below — at this service's scale (a handful of
# concurrent draft authors, not a public-facing high-QPS API) that's a simpler, equally-correct
# choice over threading asyncio through both Celery and SQLAlchemy for no real benefit here.
_engine = None
_SessionLocal = None


def get_engine():
    global _engine
    if _engine is None:
        _engine = create_engine(get_settings().database_url, pool_pre_ping=True)
    return _engine


def get_session_factory() -> sessionmaker:
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(bind=get_engine(), autoflush=False, autocommit=False)
    return _SessionLocal


@contextmanager
def session_scope():
    """Used directly by Celery tasks/services (not a FastAPI dependency)."""
    session: Session = get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_db():
    """FastAPI dependency — one session per request, committed/rolled back around the request."""
    with session_scope() as session:
        yield session
