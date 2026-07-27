import os

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.core.config import get_settings
from app.routers.images import router as images_router

settings = get_settings()

app = FastAPI(title="AI Image Generation Pipeline")

app.include_router(images_router)

if settings.storage_backend == "local":
    os.makedirs(settings.storage_local_dir, exist_ok=True)
    app.mount("/media", StaticFiles(directory=settings.storage_local_dir), name="media")


@app.get("/health")
def health():
    return {"ok": True}
