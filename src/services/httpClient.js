// Shared fetch helpers for every service client — centralizes the one place that needs to know
// about `credentials: 'include'` (required once session cookies exist) and the error-shape
// convention (throw with the server's {error} message, or a generic fallback).

async function handle(res, path) {
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || `Request to ${path} failed (${res.status})`);
  }
  return res.json();
}

export async function getJSON(path) {
  const res = await fetch(path, { credentials: 'include' });
  return handle(res, path);
}

export async function postJSON(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return handle(res, path);
}
