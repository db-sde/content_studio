from datetime import datetime, timezone

from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def iso_now() -> str:
    """Matches the Postgres iso_now() SQL function's exact output format used everywhere else in
    this shared database, so pipeline_* rows look identical in shape to every other table's
    timestamps even though Python (not the DB) is supplying the value here."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class Base(DeclarativeBase):
    pass


class Provider(Base):
    __tablename__ = "pipeline_providers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, unique=True)
    is_active: Mapped[int] = mapped_column(Integer, default=1)
    config_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String, default=iso_now)


class GenerationJob(Base):
    __tablename__ = "pipeline_generation_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    external_ref: Mapped[str] = mapped_column(String, index=True)
    page_type: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="queued")
    source_json: Mapped[str] = mapped_column(Text)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[str | None] = mapped_column(String, nullable=True)
    completed_at: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[str] = mapped_column(String, default=iso_now)


class Image(Base):
    __tablename__ = "pipeline_images"
    __table_args__ = (UniqueConstraint("job_id", "image_role"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("pipeline_generation_jobs.id", ondelete="CASCADE"))
    image_role: Mapped[str] = mapped_column(String)  # hero | body1 | body2 | body3
    current_version_id: Mapped[int | None] = mapped_column(
        ForeignKey("pipeline_image_versions.id"), nullable=True
    )
    created_at: Mapped[str] = mapped_column(String, default=iso_now)


class Prompt(Base):
    __tablename__ = "pipeline_prompts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    structured_prompt_json: Mapped[str] = mapped_column(Text)
    assembled_text: Mapped[str] = mapped_column(Text)
    negative_prompt_json: Mapped[str] = mapped_column(Text)
    edited_by_user: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[str] = mapped_column(String, default=iso_now)


class ImageVersion(Base):
    __tablename__ = "pipeline_image_versions"
    __table_args__ = (UniqueConstraint("image_id", "version_number"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    image_id: Mapped[int] = mapped_column(ForeignKey("pipeline_images.id", ondelete="CASCADE"))
    version_number: Mapped[int] = mapped_column(Integer)
    spec_json: Mapped[str] = mapped_column(Text)
    prompt_id: Mapped[int | None] = mapped_column(ForeignKey("pipeline_prompts.id"), nullable=True)
    provider_id: Mapped[int | None] = mapped_column(ForeignKey("pipeline_providers.id"), nullable=True)
    provider_generation_id: Mapped[str | None] = mapped_column(String, nullable=True)
    storage_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    storage_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    format: Mapped[str | None] = mapped_column(String, nullable=True)
    generation_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String, default="pending")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_current: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[str] = mapped_column(String, default=iso_now)


class AuditLog(Base):
    __tablename__ = "pipeline_audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int | None] = mapped_column(
        ForeignKey("pipeline_generation_jobs.id", ondelete="CASCADE"), nullable=True
    )
    image_id: Mapped[int | None] = mapped_column(
        ForeignKey("pipeline_images.id", ondelete="CASCADE"), nullable=True
    )
    event_type: Mapped[str] = mapped_column(String)
    detail_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String, default=iso_now)
