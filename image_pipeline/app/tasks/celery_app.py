from celery import Celery

from app.core.config import get_settings

settings = get_settings()

celery_app = Celery("image_pipeline", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    # 4 images per job is the whole point of parallelizing - no need for more than a handful
    # of concurrent workers per process at this stage; tune via `celery -A ... worker -c N`
    # rather than in code as real traffic volume becomes clearer.
)

# autodiscover_tasks() looks for a `tasks` submodule inside each listed package (e.g.
# `some_app.tasks`) - since these task functions live directly in generation_tasks.py, not a
# file literally named tasks.py, they need a direct import here so their @celery_app.task
# decorators actually run and register with this app when the worker starts.
from app.tasks import generation_tasks  # noqa: E402,F401
