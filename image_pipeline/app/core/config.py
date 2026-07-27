from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    redis_url: str = "redis://localhost:6379/0"
    pipeline_api_key: str = ""

    # 'mock' costs nothing and needs no provider credentials — the default so the service is
    # runnable immediately; flip to 'live' once a real provider key is configured.
    provider_mode: str = "mock"
    image_provider: str = "flux"

    fal_key: str = ""
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-opus-5"

    storage_backend: str = "local"
    storage_local_dir: str = "./media"
    storage_local_public_base_url: str = "http://localhost:8001/media"

    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = ""
    r2_public_base_url: str = ""

    port: int = 8001

    # Target ceiling for each processed image — see app/processing/image_processor.py.
    max_image_size_bytes: int = 200 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
