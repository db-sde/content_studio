import { config, assertImagePipelineConfigured } from '../config.js';

// The only file that talks to the image_pipeline service directly. Attaches the shared-secret
// X-Pipeline-Key header server-side — same convention as wordpressClient.js keeping WordPress
// credentials off the browser — so the frontend never sees or needs this key.
// Every outbound call gets a deadline (config.limits.imagePipelineTimeoutMs): without one, a hung
// image service would hold each request - and its database connection slot - open indefinitely.
async function fetchWithTimeout(url, options) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(config.limits.imagePipelineTimeoutMs) });
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      const err = new Error(`The image service didn't respond within ${Math.max(1, Math.round(config.limits.imagePipelineTimeoutMs / 1000))}s - it may be starting up; try again in a minute.`);
      err.status = 504;
      throw err;
    }
    throw e;
  }
}

async function pipelineRequest(path, { method = 'GET', body } = {}) {
  assertImagePipelineConfigured();

  const res = await fetchWithTimeout(`${config.imagePipeline.baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Pipeline-Key': config.imagePipeline.apiKey
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const message = payload?.detail || `image_pipeline request to ${path} failed (${res.status})`;
    throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
  }
  return payload;
}

export function generateImages({ pageJson, pageType, externalRef }) {
  return pipelineRequest('/generate-images', {
    method: 'POST',
    body: { page_json: pageJson, page_type: pageType, external_ref: externalRef }
  });
}

// Multipart, not JSON — category/blog pages have no facts JSON at all, only a dropped .docx.
// Separate from pipelineRequest() since that helper always sends application/json; a FormData
// body needs its own Content-Type (with the multipart boundary) that fetch sets automatically
// when no Content-Type header is given.
export async function generateImagesFromDocx({ fileBuffer, fileName, pageType, externalRef }) {
  assertImagePipelineConfigured();

  const form = new FormData();
  form.append('file', new Blob([fileBuffer]), fileName || 'document.docx');
  form.append('page_type', pageType);
  form.append('external_ref', externalRef);

  const res = await fetchWithTimeout(`${config.imagePipeline.baseUrl}/generate-images-from-docx`, {
    method: 'POST',
    headers: { 'X-Pipeline-Key': config.imagePipeline.apiKey },
    body: form
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const message = payload?.detail || `image_pipeline request to /generate-images-from-docx failed (${res.status})`;
    throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
  }
  return payload;
}

export function getGenerationStatus(externalRef) {
  return pipelineRequest(`/generation-status?external_ref=${encodeURIComponent(externalRef)}`);
}

export function getImageHistory(externalRef) {
  return pipelineRequest(`/image-history?external_ref=${encodeURIComponent(externalRef)}`);
}

export function regenerateImage({ imageId, promptOverride, createdBy }) {
  return pipelineRequest('/regenerate-image', {
    method: 'POST',
    body: { image_id: imageId, prompt_override: promptOverride ?? null, created_by: createdBy ?? null }
  });
}

export function getCurrentPrompt(imageId) {
  return pipelineRequest(`/image-prompt/${imageId}`);
}

export function patchPrompt({ imageId, structuredPrompt }) {
  return pipelineRequest('/prompt', {
    method: 'PATCH',
    body: { image_id: imageId, structured_prompt: structuredPrompt }
  });
}

export function deleteImage(imageId) {
  return pipelineRequest(`/image/${imageId}`, { method: 'DELETE' });
}
