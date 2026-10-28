// How the app's requests behave while the backend wakes up. Render puts an idle service to sleep;
// the first request after that waits ~1.5 minutes, and Vercel answers 502 before our server does
// (seen live: sign-in and saving a draft both failed with "(502)"). Safe requests retry; requests
// that change something are never re-sent; our own server's errors (like its 502 for "WordPress
// refused") are reported, not retried.
import './helpers/env.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getJSON, postJSON, putJSON, patchJSON, ServerWakingError, onServerWaking, __setWakeRetryDelaysForTests } from '../src/services/httpClient.js';

const guardedFetch = globalThis.fetch;
let responses, calls, wakeNotices, unsubscribe;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const vercelGatewayError = () => new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } });

beforeEach(() => {
  __setWakeRetryDelaysForTests([1, 1, 1, 1]);
  calls = [];
  wakeNotices = 0;
  unsubscribe = onServerWaking(() => { wakeNotices++; });
  globalThis.fetch = async (path, init) => {
    calls.push(`${init?.method || 'GET'} ${path}`);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next();
  };
});
afterEach(() => {
  globalThis.fetch = guardedFetch;
  unsubscribe();
});

test('reads and draft saves wait for a waking server, and the app is told once', async () => {
  responses = [vercelGatewayError, vercelGatewayError, () => json(200, { drafts: [] })];
  assert.deepEqual(await getJSON('/api/drafts'), { drafts: [] });
  assert.equal(calls.length, 3);
  assert.equal(wakeNotices, 1);

  responses = [() => new Response('', { status: 504 }), () => json(200, { draft: { id: 'd1' } })];
  assert.deepEqual(await putJSON('/api/drafts/d1', { formData: {} }), { draft: { id: 'd1' } });
});

test('sign-in retries too: a request that never reached the server signed nobody in', async () => {
  responses = [vercelGatewayError, () => json(200, { user: { id: 1 } })];
  assert.deepEqual(await postJSON('/api/auth/login', { email: 'a@degreebaba.com', password: 'x' }, { retryWhileWaking: true }), { user: { id: 1 } });
  assert.equal(calls.length, 2);
});

test('changes, publishing and AI generation are never re-sent', async () => {
  for (const send of [() => patchJSON('/api/drafts/d1/status', { action: 'approve' }), () => postJSON('/api/drafts/d1/generate-all-fields', {})]) {
    responses = [vercelGatewayError, () => json(200, {})];
    calls = [];
    await assert.rejects(send, (e) => e instanceof ServerWakingError && /nothing was changed on your side/.test(e.message));
    assert.equal(calls.length, 1, 'sent exactly once');
  }
});

test("our own server's errors are reported as they are, not retried - including its 502 for WordPress", async () => {
  responses = [() => json(502, { error: 'WordPress rejected some field values - acf: ...' })];
  await assert.rejects(() => getJSON('/api/drafts/d1'), /WordPress rejected some field values/);
  assert.equal(calls.length, 1);
  responses = [() => json(404, { error: 'Draft not found' })];
  await assert.rejects(() => getJSON('/api/drafts/nope'), /Draft not found/);
  assert.equal(wakeNotices, 0);
});

test('a server that never wakes up ends with a clear message, after a bounded number of tries', async () => {
  responses = Array.from({ length: 10 }, () => vercelGatewayError);
  await assert.rejects(() => getJSON('/api/drafts'), /still starting up/);
  assert.equal(calls.length, 5, 'the first try plus one per retry delay');
});

test('a dropped connection is retried for reads', async () => {
  responses = [new TypeError('fetch failed'), () => json(200, { ok: true })];
  assert.deepEqual(await getJSON('/api/health'), { ok: true });
  responses = [new TypeError('fetch failed')];
  await assert.rejects(() => postJSON('/api/drafts', {}), /Couldn't reach the server/);
});
