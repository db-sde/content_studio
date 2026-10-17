"""Guards on everything in image_pipeline that turns into a bill: how many images each page type
generates, what exactly is sent to the paid image model, how often a failure is retried, and how
large the stored files are. A change that loosens any of these fails here first."""

import io

import pytest
from PIL import Image

from app.core.config import get_settings
from app.planner.image_planner import ROLES_BY_PAGE_TYPE, plan_images
from app.processing.image_processor import process_image
from app.processing.text_overlay import compose_overlay
from app.prompts import prompt_generator as pg
from app.providers import flux_provider
from app.providers.base import NotImplementedProviderError
from app.providers.ideogram_provider import IdeogramProvider
from app.providers.openai_provider import OpenAIProvider
from app.providers.provider_factory import get_provider
from app.schemas.prompt import DEFAULT_NEGATIVE_PROMPT, OverlayText, StructuredPrompt
from app.tasks import generation_tasks


def _prompt(**kw):
    return StructuredPrompt(subject="s", background="b", composition="c", lighting="l", style="st", **kw)


# ------------------------------------------------------------------ images per page

def test_images_per_page_type_are_exactly_as_agreed():
    counts = {page_type: len(roles) for page_type, roles in ROLES_BY_PAGE_TYPE.items()}
    assert counts == {"course": 1, "specialization": 1, "category": 1, "blog": 4}


def test_university_pages_generate_no_images():
    assert "university" not in ROLES_BY_PAGE_TYPE
    with pytest.raises(ValueError):
        plan_images({}, "university")


# ------------------------------------------------------------------ what goes to the paid model

class _FakeResponse:
    def __init__(self, json_body=None, content=b""):
        self._json = json_body or {}
        self.content = content

    def raise_for_status(self):
        pass

    def json(self):
        return self._json


def test_flux_request_is_one_image_on_the_dev_model_with_a_timeout(monkeypatch):
    sent = {}
    png = io.BytesIO()
    Image.new("RGB", (16, 16)).save(png, format="PNG")

    def fake_post(url, **kwargs):
        sent["url"] = url
        sent.update(kwargs)
        return _FakeResponse({"images": [{"url": "http://img.test/x.png", "width": 1600, "height": 896}], "seed": 7})

    monkeypatch.setattr(flux_provider.httpx, "post", fake_post)
    monkeypatch.setattr(flux_provider.httpx, "get", lambda url, **kw: _FakeResponse(content=png.getvalue()))

    flux_provider.FluxProvider().generate(_prompt(), width=1600, height=900)

    assert sent["url"].endswith("/fal-ai/flux/dev")
    body = sent["json"]
    assert body["num_images"] == 1, "every call must produce exactly one billed image"
    assert body["num_inference_steps"] <= 28 and body["guidance_scale"] == 3.5
    assert body["enable_safety_checker"] is True
    assert 0 < sent["timeout"] <= 120, "the paid call must not hang forever"


def test_flux_without_a_key_fails_before_any_network_call(monkeypatch):
    class _NoKey:
        fal_key = ""
    monkeypatch.setattr(flux_provider, "get_settings", lambda: _NoKey())
    with pytest.raises(RuntimeError, match="FAL_KEY is not configured"):
        flux_provider.FluxProvider().generate(_prompt(), width=1600, height=900)


def test_mock_mode_never_reaches_a_paid_provider():
    assert get_settings().provider_mode == "mock"
    assert generation_tasks._candidate_providers() == ["mock"]
    assert get_provider("flux").name == "mock"


def test_retry_budget_is_bounded():
    # Worst case per image: _MAX_ATTEMPTS_PER_PROVIDER tries on each provider in the fallback order.
    # Only FLUX is a real (paid) provider today - the others raise immediately, at no cost.
    assert generation_tasks._MAX_ATTEMPTS_PER_PROVIDER <= 2
    assert len(generation_tasks._FALLBACK_ORDER) <= 3
    for provider in (OpenAIProvider(), IdeogramProvider()):
        with pytest.raises(NotImplementedProviderError):
            provider.generate(_prompt(), width=100, height=100)


def test_prompt_generation_has_a_token_ceiling():
    import inspect
    source = inspect.getsource(pg._call_model)
    assert "max_tokens=4096" in source


# ------------------------------------------------------------------ stored file size

def test_processed_images_stay_within_the_size_budget():
    # Random noise is the worst case for compression - a real photo is much smaller.
    import os as _os
    noisy = Image.frombytes("RGB", (1600, 900), _os.urandom(1600 * 900 * 3))
    buf = io.BytesIO()
    noisy.save(buf, format="PNG")
    out = process_image(buf.getvalue(), role="hero", page_type="course")
    assert out.format == "webp"
    assert out.size_bytes <= get_settings().max_image_size_bytes, f"{out.size_bytes} bytes"


def test_text_overlay_survives_long_text_and_many_chips():
    base = Image.new("RGB", (1200, 900), "white")
    overlay = OverlayText(headline="Very " * 40 + "Long Headline", subheading="Sub " * 30, chips=["Online", "2 Years", "NAAC A++", "Extra", "More"])
    for page_type in ("course", "specialization", "category", "blog"):
        out = compose_overlay(base, overlay, role="hero", page_type=page_type)
        assert out.size == base.size


# ------------------------------------------------------------------ correctness of on-image text

def test_image_model_is_told_not_to_render_text():
    for word in ("text", "letters", "typography"):
        assert word in DEFAULT_NEGATIVE_PROMPT


def test_accreditation_chips_are_labelled():
    assert pg._deterministic_chips({"mode": "Online", "duration": "2 Years", "naac_grade": "A++"}) == ["Online", "2 Years", "NAAC A++"]
    assert pg._deterministic_chips({"naac_grade": "NAAC A"}) == ["NAAC A"]
    assert pg._deterministic_chips({"ugc_status": "DEB Approved"}) == ["UGC DEB Approved"]


def test_headline_never_duplicates_the_university_name():
    assert pg._fallback_headline("Sharda University Online", "Sharda Online MBA") == "Sharda Online MBA"
    assert pg._fallback_headline("SASTRA University", "Online BBA") == "SASTRA University Online BBA"
    assert pg._is_grounded_headline("Vivekananda Global University Online MBA", "VGU Online MBA")
    assert not pg._is_grounded_headline("Some Invented Programme", "MBA in Finance")
