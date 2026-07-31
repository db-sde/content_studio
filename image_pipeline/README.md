# Image Pipeline

A standalone FastAPI service that generates AI hero/body images for Content Studio pages. It is
a separate Python deployment from the main Node app, integrated over HTTP (see
`server/integrations/imagePipelineClient.js` in the Node app).

## What it does

For a given page, the pipeline plans which images are needed, writes a creative brief grounded
in the page's real content, generates a clean photographic image from that brief, composites the
real headline/subheading/highlight chips on top with a real font, compresses it to a target size,
and uploads it to Cloudinary. Every generation is versioned so a page can be regenerated or have
its prompt edited without losing history.

### Page types and image counts

| page_type | images | grounded in |
|---|---|---|
| `university` | **none** — not generated at all | — |
| `course` | 1 (hero) | Content Studio's structured JSON facts |
| `specialization` | 1 (hero) | Content Studio's structured JSON facts |
| `category` | 1 (hero) | a dropped `.docx`'s raw text (no JSON form for this page type) |
| `blog` | 4 (hero + 3 supporting body images) | a dropped `.docx`'s raw text |

`course`/`specialization` are edited as normal Content Studio drafts. `category`/`blog` have no
Content Studio authoring form at all — a user drops a `.docx` and only images are generated from
it (see `POST /generate-images-from-docx`).

## Why the image model never renders text

Earlier versions asked the image model (FLUX) to bake the headline/chips directly into the image
as real typography. In production this reliably produced garbled or misspelled text (a fast
diffusion model paints text-*shaped* textures, it doesn't understand characters) —
`$harda University`, `MEBA` instead of MBA, duplicated words, etc. That's a fundamental model
limitation, not something prompt wording fixes.

So now:
1. The image model (`app/prompts/templates.py`) is instructed to produce **clean photography
   only** — no on-image text of any kind (`app/schemas/prompt.py`'s `DEFAULT_NEGATIVE_PROMPT`
   suppresses it).
2. The actual headline/subheading/chips are generated as plain text fields alongside the visual
   prompt (`StructuredPrompt.overlay`), then drawn onto the finished image afterward with a real
   bundled font (`app/processing/text_overlay.py`, Poppins/OFL-licensed) — spelling is then just
   a string being rendered, not a pixel guess.
3. For `course`/`specialization`, the headline is grounded in the LLM's own natural merge of the
   exact `university_name` + course/specialization name (handles messy real-world data like a
   university name that already ends in "Online"), validated against the real name and falling
   back to a safe concatenation if it ever looks ungrounded. Chips are always computed directly
   from exact facts (mode/duration/accreditation) — no LLM judgement involved there.

## Pipeline stages

```
page_json / docx text
        │
        ▼
Image Planner (app/planner/image_planner.py)
  → decides which roles (hero/body1-3) this page_type needs, and what
    each one's purpose/placement/source_fields are
        │
        ▼
Prompt Generator (app/prompts/prompt_generator.py + app/prompts/templates.py)
  → an LLM call (Claude) turns the spec + real facts/docx text into a
    StructuredPrompt: subject/background/composition/lighting/style
    (clean photography only) + overlay text (headline/subheading/chips)
        │
        ▼
Image Provider (app/providers/) → generates the raw image
  → FLUX 1.1 [pro] via fal.ai (live), or a deterministic placeholder (mock)
        │
        ▼
Image Processor (app/processing/image_processor.py)
  → resize to the role's target dimensions, composite the overlay text
    (app/processing/text_overlay.py), compress to the size budget, encode WebP
        │
        ▼
Storage Backend (app/storage/) → Cloudinary (default), local disk, or R2
        │
        ▼
Postgres (app/db/) — job/image/version/prompt rows, so every version is
  auditable and a single image can be regenerated independently
```

Generation runs in the background (`app/tasks/generation_tasks.py`) using FastAPI's own
`BackgroundTasks` + a small `ThreadPoolExecutor` — no Celery/Redis. At this project's usage level
(an occasional admin action, not a high-throughput pipeline), a broker-backed task queue was more
infrastructure than the job warranted.

## Providers

Configured via `IMAGE_PROVIDER` (`app/providers/provider_factory.py`), with automatic fallback to
the next configured provider if one fails or isn't implemented yet:

- **`flux`** (default) — FLUX 1.1 [pro] via [fal.ai](https://fal.ai), ~$0.08 per hero image.
  Upgraded from FLUX Schnell (~$0.006/image) once on-image text stopped being the model's job —
  Schnell's speed advantage no longer needed to be traded against text-rendering quality, so the
  slower/pricier tier's better photorealism/composition/anatomy correctness was worth it.
- **`openai`**, **`ideogram`** — stubbed for a future phase, not implemented yet.
- **`mock`** (`PROVIDER_MODE=mock`) — a deterministic placeholder image, zero external API calls
  or cost. Used for local dev/CI without needing real provider keys.

## Storage

Configured via `STORAGE_BACKEND` (`app/storage/storage_factory.py`):

- **`cloudinary`** (default, both dev and prod) — publicly reachable out of the box, which matters
  since a generated image's URL gets embedded in a draft's JSON and that JSON is later published
  to a separately-hosted WordPress site.
- **`local`** — writes to a local `media/` dir, served via this service's own `/media` route.
  Only correct for single-machine local dev/testing — a real WordPress site can't reach
  `localhost`.
- **`r2`** — Cloudflare R2 (S3-compatible), kept for parity with the same `StorageBackend`
  interface.

## API

All endpoints (except `/health`) require an `X-Pipeline-Key` header matching `IMAGE_PIPELINE_API_KEY`.

| Endpoint | Purpose |
|---|---|
| `POST /generate-images` | Start a generation job from `page_json` + `page_type` (course/specialization). Returns immediately with `job_id`/`status`; images generate in the background. |
| `POST /generate-images-from-docx` | Same, but for `category`/`blog` — takes a multipart `.docx` upload instead of JSON. |
| `GET /generation-status?external_ref=` | Poll a job's status and per-role image results. |
| `GET /image-history?external_ref=` | Every version ever generated for a page's images. |
| `POST /regenerate-image` | Regenerate a single image (optionally with an edited prompt), without re-running the whole job. |
| `GET /image-prompt/{image_id}` | The structured prompt behind an image's current version — prefills the "Edit Prompt" UI. |
| `PATCH /prompt` | Save an edited structured prompt (used by the "Edit Prompt" flow). |
| `DELETE /image/{image_id}` | Delete an image and its versions. |
| `POST /generate-prompt` | Preview the prompt that would be generated for a spec, without generating an image. |
| `GET /health` | No auth required. Liveness check. |

## Running locally

```bash
cd image_pipeline
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

This service shares **one `.env` file with the whole repo** (`content_studio/.env`, at the repo
root) rather than keeping a second copy in this folder — `app/core/config.py` resolves it by
absolute path, so it works the same regardless of which directory you launch from. See
`.env.example` at the repo root for every variable this service reads (`IMAGE_PIPELINE_*`,
`PROVIDER_MODE`, `FAL_KEY`, `STORAGE_BACKEND`, `CLOUDINARY_*`, etc.) — `DATABASE_URL` and
`ANTHROPIC_API_KEY` are reused as-is from the Node app's own config.

Set `PROVIDER_MODE=mock` to run without any real provider keys or cost.

## Deployment

Deployed as its own Render web service, separate from the Node app — a different language
runtime can't share one Render service. See `render.yaml` at the repo root (a Blueprint for this
service only; the existing Node app was set up manually and is untouched by it). Notably:

- `PYTHON_VERSION` is pinned to `3.13.6` — Render's newer default at time of writing has no
  prebuilt wheel for the pinned `pydantic-core`, which fails the build compiling from source.
- No Redis/worker resources — just the one web service, per the no-Celery design above.
- Once deployed, the Node app needs `IMAGE_PIPELINE_URL` (this service's URL) and
  `IMAGE_PIPELINE_API_KEY` (must match this service's own value) added to its own environment.
