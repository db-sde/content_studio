from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# One shared .env for the whole repo (content_studio/.env) rather than a second copy living in
# this subfolder - both services already read the same DATABASE_URL and ANTHROPIC_API_KEY, so a
# second file just meant keeping two copies of those in sync by hand. Resolved from this file's
# own location (not the process cwd) so it works the same whether this is launched from
# image_pipeline/ or from the repo root. In production (Render) this path simply won't exist -
# each service gets real env vars injected directly, which pydantic-settings prefers anyway.
_REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(_REPO_ROOT / ".env"), extra="ignore")

    database_url: str
    redis_url: str = "redis://localhost:6379/0"
    # Same shared secret Node's imagePipelineClient.js sends as X-Pipeline-Key - one env var name
    # (IMAGE_PIPELINE_API_KEY) used by both sides now, instead of two different names for the
    # same value.
    pipeline_api_key: str = Field(default="", validation_alias="IMAGE_PIPELINE_API_KEY")

    # 'mock' costs nothing and needs no provider credentials — the default so the service is
    # runnable immediately; flip to 'live' once a real provider key is configured.
    provider_mode: str = "mock"
    image_provider: str = "flux"

    fal_key: str = ""
    anthropic_api_key: str = ""
    # Namespaced (not plain ANTHROPIC_MODEL) because content_studio's own Node app already defines
    # ANTHROPIC_MODEL for its own writer/editor - the two services intentionally use different
    # Claude models for different jobs, so they can't share one env var name.
    anthropic_model: str = Field(default="claude-opus-5", validation_alias=AliasChoices("IMAGE_PIPELINE_ANTHROPIC_MODEL", "ANTHROPIC_MODEL"))

    storage_backend: str = "local"
    # Anchored to this file's location, not the process cwd - local_disk.py joins keys onto this
    # with plain os.path.join, so a relative default here would land in a different real directory
    # depending on whether the process happens to be launched from image_pipeline/ or the repo
    # root. Leave STORAGE_LOCAL_DIR unset in .env to use this; only override with an absolute path.
    storage_local_dir: str = str(_REPO_ROOT / "image_pipeline" / "media")
    storage_local_public_base_url: str = "http://localhost:8001/media"

    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = ""
    r2_public_base_url: str = ""

    # Target ceiling for each processed image — see app/processing/image_processor.py.
    max_image_size_bytes: int = 200 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
