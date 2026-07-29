import { getJSON, postJSON } from './httpClient.js';

// PATCH/DELETE aren't in httpClient's helper set (only GET/POST) — same reason draftsClient.js
// keeps its own local copies rather than sharing one central version.
async function patchJSON(path, body) {
  const res = await fetch(path, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || `Request to ${path} failed (${res.status})`);
  }
  return res.json();
}

async function deleteJSON(path) {
  const res = await fetch(path, { method: 'DELETE', credentials: 'include' });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || `Request to ${path} failed (${res.status})`);
  }
  return res.json();
}

// --- Draft-linked (the normal path: Senior/Admin generating images for a real, reviewed page) --

export function generateImagesForDraft(draftId) {
  return postJSON(`/api/drafts/${draftId}/generate-images`, {});
}

export function getGenerationStatusForDraft(draftId) {
  return getJSON(`/api/drafts/${draftId}/generation-status`);
}

export function getImageHistoryForDraft(draftId) {
  return getJSON(`/api/drafts/${draftId}/image-history`);
}

export function regenerateImageForDraft(draftId, { imageId, promptOverride }) {
  return postJSON(`/api/drafts/${draftId}/regenerate-image`, { imageId, promptOverride: promptOverride ?? null });
}

export function getCurrentPromptForDraft(draftId, imageId) {
  return getJSON(`/api/drafts/${draftId}/image-prompt/${imageId}`);
}

export function patchPromptForDraft(draftId, { imageId, structuredPrompt }) {
  return patchJSON(`/api/drafts/${draftId}/prompt`, { imageId, structuredPrompt });
}

export function deleteImageForDraft(draftId, imageId) {
  return deleteJSON(`/api/drafts/${draftId}/image/${imageId}`);
}

// --- Standalone (pasted JSON, no linked draft) --------------------------------------------

export function generateImagesFromJson({ pageJson, pageType, label }) {
  return postJSON('/api/image-pipeline/generate-images', { pageJson, pageType, label: label ?? null });
}

export function getGenerationStatusByRef(ref) {
  return getJSON(`/api/image-pipeline/generation-status/${encodeURIComponent(ref)}`);
}

export function getImageHistoryByRef(ref) {
  return getJSON(`/api/image-pipeline/image-history/${encodeURIComponent(ref)}`);
}

export function regenerateImageStandalone({ imageId, promptOverride }) {
  return postJSON('/api/image-pipeline/regenerate-image', { imageId, promptOverride: promptOverride ?? null });
}

export function getCurrentPromptStandalone(imageId) {
  return getJSON(`/api/image-pipeline/image-prompt/${imageId}`);
}

export function patchPromptStandalone({ imageId, structuredPrompt }) {
  return patchJSON('/api/image-pipeline/prompt', { imageId, structuredPrompt });
}

export function deleteImageStandalone(imageId) {
  return deleteJSON(`/api/image-pipeline/image/${imageId}`);
}
