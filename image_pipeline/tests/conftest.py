"""Test setup for image_pipeline. Runs before any app module is imported.

Makes the suite safe by construction: environment variables override the repo's real .env (which
holds live fal.ai / Anthropic / Cloudinary keys and the production database URL), the provider is
forced to the free mock, and every outbound HTTP call via httpx is blocked unless a test explicitly
replaces it - so no test can ever spend money or touch real data.
"""

import os
import sys

os.environ.update({
    "DATABASE_URL": "postgresql://test:test@127.0.0.1:1/never-connected",
    "IMAGE_PIPELINE_API_KEY": "test-key",
    "PROVIDER_MODE": "mock",
    "IMAGE_PROVIDER": "flux",
    "FAL_KEY": "test-fal-key",
    "ANTHROPIC_API_KEY": "",
    "STORAGE_BACKEND": "local",
    "CLOUDINARY_CLOUD_NAME": "",
    "CLOUDINARY_API_KEY": "",
    "CLOUDINARY_API_SECRET": "",
})
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402
import pytest  # noqa: E402


def _blocked(*args, **kwargs):
    raise RuntimeError(f"Blocked outbound HTTP call in tests: {args[0] if args else kwargs}")


@pytest.fixture(autouse=True)
def block_network(monkeypatch):
    monkeypatch.setattr(httpx, "post", _blocked)
    monkeypatch.setattr(httpx, "get", _blocked)
