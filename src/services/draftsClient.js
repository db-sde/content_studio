import { getJSON, postJSON } from './httpClient.js';

// PUT/DELETE aren't in httpClient's helper set (only GET/POST) — kept local since drafts is the
// only client that currently needs them.
async function putJSON(path, body) {
  const res = await fetch(path, {
    method: 'PUT',
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

export function listDrafts() {
  return getJSON('/api/drafts');
}

export function getDraft(id) {
  return getJSON(`/api/drafts/${id}`);
}

export function createDraft(pageType) {
  return postJSON('/api/drafts', { pageType });
}

export function saveDraft(id, formData) {
  return putJSON(`/api/drafts/${id}`, { formData });
}

export function deleteDraft(id) {
  return deleteJSON(`/api/drafts/${id}`);
}

export function generateAllFields(id, { fields, facts, onlyEmpty }) {
  return postJSON(`/api/drafts/${id}/generate-all-fields`, { fields, facts, onlyEmpty: !!onlyEmpty });
}

// Generic entry point for any status-transition action — App.jsx's note modal is shared across
// send-to-senior/send-to-admin/revert-to-intern/revert-to-senior, so it needs one call it can fire
// regardless of which action the user picked, rather than four near-identical wrapper calls.
export function setDraftStatus(id, action, message) {
  return patchJSON(`/api/drafts/${id}/status`, { action, message });
}

export function sendToSenior(id, message) {
  return setDraftStatus(id, 'send-to-senior', message);
}

export function sendToAdmin(id, message) {
  return setDraftStatus(id, 'send-to-admin', message);
}

export function revertToIntern(id, message) {
  return setDraftStatus(id, 'revert-to-intern', message);
}

export function revertToSenior(id, message) {
  return setDraftStatus(id, 'revert-to-senior', message);
}

export function approveDraft(id) {
  return setDraftStatus(id, 'approve');
}

export function reopenDraft(id) {
  return setDraftStatus(id, 'reopen');
}

export function setAllowInternAiEdit(id, allow) {
  return patchJSON(`/api/drafts/${id}/allow-intern-ai-edit`, { allow: !!allow });
}

export function getFullExport(id) {
  return getJSON(`/api/drafts/${id}/full-export`);
}

export function getCostSummary(id) {
  return getJSON(`/api/drafts/${id}/cost-summary`);
}

export function publishToWordPress(id) {
  return postJSON(`/api/drafts/${id}/publish-to-wordpress`, {});
}
