// Shared fetch helpers for every service client — the one place that knows about
// `credentials: 'include'` (session cookies), the error-shape convention (throw with the server's
// {error} message, or a generic fallback), and what to do while the server is waking up.
//
// The backend runs on Render, which puts an idle service to sleep; the first request after that
// waits about a minute while it starts, and Vercel (which forwards /api to Render) gives up first
// with a 502/503/504 that isn't from our server at all - no JSON {error} body. Requests that are
// safe to send twice (reads, saving a draft, signing in) retry until the server answers; anything
// else (status changes, publishing, AI generation - which costs money) is never re-sent and fails
// with a message saying to try again shortly.

const WAKING_STATUSES = new Set([502, 503, 504]);
// About 1.5 minutes in all - a Render cold start measured 88s.
let WAKE_RETRY_DELAYS_MS = [3000, 5000, 8000, 10000, 12000, 15000, 15000, 15000, 15000];
export function __setWakeRetryDelaysForTests(delays) {
  WAKE_RETRY_DELAYS_MS = delays;
}

export class ServerWakingError extends Error {}

const wakingListeners = new Set();
// Lets the app show a "server is starting up" notice while a request waits.
export function onServerWaking(listener) {
  wakingListeners.add(listener);
  return () => wakingListeners.delete(listener);
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function errorPayloadOf(res) {
  if (!(res.headers.get('content-type') || '').includes('application/json')) return null;
  return res.json().catch(() => null);
}

// `retryWhileWaking`: only for requests that are harmless to send again.
export async function request(path, { method = 'GET', body, retryWhileWaking = method === 'GET' } = {}) {
  const init = { method, credentials: 'include' };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }

  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(path, init);
    } catch (e) {
      // Network-level failure (offline, connection dropped): same handling as a waking server.
      res = null;
      if (!retryWhileWaking || attempt >= WAKE_RETRY_DELAYS_MS.length) {
        throw new Error(`Couldn't reach the server (${e.message}). Check the connection and try again.`, { cause: e });
      }
    }

    if (res && res.ok) return res.json();

    const payload = res ? await errorPayloadOf(res) : null;
    // Our own server answered with an error (including its 502 for "WordPress refused"): report it.
    if (res && (payload?.error || !WAKING_STATUSES.has(res.status))) {
      throw new Error(payload?.error || `Request to ${path} failed (${res.status})`);
    }

    // No answer from our server: it is (most likely) still starting up.
    if (!retryWhileWaking || attempt >= WAKE_RETRY_DELAYS_MS.length) {
      throw new ServerWakingError(retryWhileWaking
        ? 'The server is still starting up and did not answer. Please try again in a minute.'
        : 'The server was starting up and did not answer in time - nothing was changed on your side. Please try again in a minute.');
    }
    if (attempt === 0) wakingListeners.forEach(listener => listener());
    await sleep(WAKE_RETRY_DELAYS_MS[attempt]);
  }
}

export const getJSON = (path) => request(path);
export const postJSON = (path, body, options = {}) => request(path, { method: 'POST', body, ...options });
export const putJSON = (path, body) => request(path, { method: 'PUT', body, retryWhileWaking: true });
export const patchJSON = (path, body) => request(path, { method: 'PATCH', body });
export const deleteJSON = (path) => request(path, { method: 'DELETE' });
