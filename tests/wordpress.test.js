// Publishing to WordPress, against a stand-in WordPress on this machine. The first real publishes
// failed with WordPress's own "You are not currently logged in." and then a Cloudflare challenge,
// neither of which says the cause or where to fix it. Pins that each failure gets a message naming
// the fix, that the request is shaped the way WordPress expects (and carries no browser-style
// headers), and that the default post types are the DegreeBaba site's real ones.
import './helpers/env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import express from 'express';
import { config } from '../server/config.js';
import { publishDraftToWordPress } from '../server/integrations/wordpressClient.js';

let server, reply;
const requests = [];

before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res) => {
    requests.push({ method: req.method, path: req.path, auth: req.headers.authorization, userAgent: req.headers['user-agent'], headers: req.headers, body: req.body });
    const [status, body, headers = {}, delayMs = 0] = reply;
    setTimeout(() => {
      if (res.destroyed) return;
      res.status(status).set(headers);
      if (typeof body === 'string') res.type('html').send(body); else res.json(body);
    }, delayMs);
  });
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  Object.assign(config.wordpress, { siteUrl: `http://127.0.0.1:${server.address().port}`, appUser: 'editor', appPassword: 'abcd efgh ijkl mnop qrst uvwx' });
});

after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  assert.deepEqual(globalThis.__blockedRequests, [], 'a test tried to reach an outside service');
});

const publish = () => publishDraftToWordPress({ pageType: 'specialization', title: 'Online MBA', acfFields: { about_content: '<p>x</p>' } });

test("default post types are the site's own REST bases", () => {
  assert.deepEqual(config.wordpress.postTypeSlugs, { university: 'university', course: 'course', specialization: 'specialization' });
});

test('a successful publish sends the title, ACF fields and Basic auth to the post type route', async () => {
  requests.length = 0;
  reply = [201, { id: 42, link: 'https://example.test/specialization/online-mba', status: 'publish' }];
  assert.deepEqual(await publish(), { id: 42, link: 'https://example.test/specialization/online-mba', status: 'publish' });
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].path, '/wp-json/wp/v2/specialization');
  assert.equal(requests[0].auth, 'Basic ' + Buffer.from('editor:abcd efgh ijkl mnop qrst uvwx').toString('base64'));
  assert.deepEqual(requests[0].body, { title: 'Online MBA', status: 'publish', acf: { about_content: '<p>x</p>' } });
  assert.match(requests[0].userAgent, /DegreeBaba-Content-Studio/);
});

// Global fetch adds browser-style headers on its own (sec-fetch-mode: cors, accept-language: *)
// that, next to a non-browser User-Agent, can trip Cloudflare's bot scoring. Only these go out.
test('the request carries only the headers we set, none of the browser-style ones fetch adds', async () => {
  requests.length = 0;
  reply = [201, { id: 7, link: 'https://example.test/x', status: 'publish' }];
  await publish();
  const sent = requests[0].headers;
  assert.equal(sent['sec-fetch-mode'], undefined);
  assert.equal(sent['accept-language'], undefined);
  assert.deepEqual(Object.keys(sent).sort(), ['accept', 'authorization', 'connection', 'content-length', 'content-type', 'host', 'user-agent']);
  assert.equal(sent.accept, '*/*');
  assert.equal(sent['content-type'], 'application/json');
  assert.equal(Number(sent['content-length']), Buffer.byteLength(JSON.stringify(requests[0].body)));
});

test('re-publishing an existing post updates it in place (PUT to its ID)', async () => {
  requests.length = 0;
  reply = [200, { id: 42, link: 'https://example.test/specialization/online-mba', status: 'publish' }];
  await publishDraftToWordPress({ pageType: 'specialization', title: 'Online MBA', acfFields: {}, existingPostId: 42 });
  assert.equal(requests[0].method, 'PUT');
  assert.equal(requests[0].path, '/wp-json/wp/v2/specialization/42');
});

test('a WordPress that does not answer in time gives the 504 "nothing was published" error', async () => {
  const saved = config.limits.wordpressTimeoutMs;
  config.limits.wordpressTimeoutMs = 150;
  reply = [201, { id: 1 }, {}, 2000];
  try {
    await assert.rejects(publish, (e) => e.status === 504 && /didn't respond within 1s - nothing was published/.test(e.message));
  } finally {
    config.limits.wordpressTimeoutMs = saved;
  }
});

test('the test safety net also stops https.request to an outside host', () => {
  const before = globalThis.__blockedRequests.length;
  assert.throws(() => https.request('https://degreebaba.demo-nexevo.in/wp-json/'), /Blocked outbound request in tests/);
  assert.equal(globalThis.__blockedRequests.length, before + 1);
  globalThis.__blockedRequests.pop(); // expected; the after() hook checks nothing else was attempted
});

test('each WordPress failure names its real cause', async () => {
  const cases = [
    [[401, { code: 'rest_not_logged_in', message: 'You are not currently logged in.' }], /did not accept the login. Most often WORDPRESS_APP_USER \/ WORDPRESS_APP_PASSWORD/],
    [[401, { code: 'incorrect_password', message: 'The provided password is an invalid application password.' }], /WORDPRESS_APP_PASSWORD/],
    [[401, { code: 'rest_cannot_create', message: 'Sorry, you are not allowed to create posts as this user.' }], /did not accept the login. Most often WORDPRESS_APP_USER \/ WORDPRESS_APP_PASSWORD/],
    [[403, { code: 'rest_cannot_create', message: 'Sorry, you are not allowed to create posts as this user.' }], /won't let that user publish/],
    // What a Cloudflare/firewall block looks like: an HTML page, no WordPress code. Not a role problem.
    [[403, '<!DOCTYPE html><title>Attention Required! | Cloudflare</title>', { server: 'cloudflare', 'cf-ray': '8f1e2d3c4b5a6978-BOM', 'cf-mitigated': 'challenge' }],
      /blocked before it reached WordPress \(403, Cloudflare challenge\) - by Cloudflare.*role isn't the problem.*ray ID: 8f1e2d3c4b5a6978-BOM/],
    [[403, '<html>403 Forbidden</html>'], /blocked before it reached WordPress \(403\) - by a firewall/],
    [[404, { code: 'rest_no_route', message: 'No route was found matching the URL and request method.' }], /no "specialization" post type/]
  ];
  for (const [r, expected] of cases) {
    reply = r;
    await assert.rejects(publish, expected);
  }
});
