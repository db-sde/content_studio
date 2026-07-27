from fastapi import Header, HTTPException, status

from app.core.config import get_settings


# Single shared-secret header, checked on every route via this dependency — Node's
# imagePipelineClient.js attaches it server-side (see content_studio/server/integrations/
# imagePipelineClient.js), so the browser never holds this key, mirroring how WordPress
# credentials stay server-side only in wordpressClient.js.
async def require_pipeline_key(x_pipeline_key: str = Header(default="")) -> None:
    settings = get_settings()
    if not settings.pipeline_api_key:
        # Deliberately fails closed rather than silently allowing unauthenticated access if the
        # operator forgot to set a key.
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "PIPELINE_API_KEY is not configured")
    if x_pipeline_key != settings.pipeline_api_key:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or missing X-Pipeline-Key")
