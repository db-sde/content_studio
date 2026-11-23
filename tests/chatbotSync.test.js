// Published pages go to the DegreeBaba chatbot (db-sde/chat_bot): POST /api/catalog/sync with the
// shared secret in X-Webhook-Secret and its §3 payload, queued so publishing never waits, retried while
// the chatbot is down, and never letting an older send overwrite a newer one. The chatbot and WordPress
// are stand-ins on this machine; the chatbot stand-in checks what the real one checks.
import './helpers/env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { startTestApp } from './helpers/testApp.js';
import { config } from '../server/config.js';
import { __clearWordPressCachesForTests } from '../server/integrations/wordpressClient.js';
import { buildSyncPayload, queueChatbotSync, drainChatbotQueue } from '../server/integrations/chatbotSync.js';

const SECRET = 'tUw0Zs+Qm4Yb9vKx2Lr7Np3Hd8Jc5Fg1Ae6Ti0Ow=';
const UNI_ACF = { university_name: 'Test University Online', about_content: '<p>About.</p>', faqs: [{ question: 'Q?', answer: 'A.' }] };

// ---------------------------------------------------------------- the payload
test('the payload is the chatbot\'s §3 shape, with linked pages as post IDs', () => {
  const link = 'https://staging.degreebaba.com/course/test-online-mba/';
  const { payload } = buildSyncPayload({ pageType: 'course', postId: '6713', link, acf: { program_name: 'Online MBA' }, linkedIds: { linked_university: [6712] }, modified: '2026-11-23T10:00:00Z' });
  assert.deepEqual(payload, {
    post_id: 6713, post_type: 'course', status: 'publish', slug: 'test-online-mba', permalink: '/course/test-online-mba/',
    modified: '2026-11-23T10:00:00Z', acf: { program_name: 'Online MBA', linked_university: 6712 }
  });
  const spec = buildSyncPayload({ pageType: 'specialization', postId: 9, link, acf: {}, linkedIds: { linked_university: 1, linked_course: 2 } }).payload;
  assert.deepEqual([spec.acf.linked_university, spec.acf.linked_course], [1, 2]);
  assert.match(spec.modified, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  // A parent not on WordPress yet: sent anyway - the chatbot stores the page and links it later.
  assert.ok(buildSyncPayload({ pageType: 'course', postId: 9, link, acf: {} }).payload);
  for (const bad of ['https://staging.degreebaba.com/?p=12', '', null, 'not a url']) assert.ok(buildSyncPayload({ pageType: 'course', postId: 9, link: bad, acf: {} }).skip, String(bad));
});

// ---------------------------------------------------------------- queued and sent
let t, admin, chatbot, wpServer;
const received = [];
let answers = []; // statuses for the next requests, in order; then 200

before(async () => {
  // The chatbot's endpoint: 401 for a wrong secret, 422 without the required fields, else an upsert.
  const bot = express();
  bot.post('/api/catalog/sync', express.json(), (req, res) => {
    const secretOk = req.get('X-Webhook-Secret') === SECRET;
    received.push({ body: req.body, secretOk });
    if (!secretOk) return res.status(401).json({ detail: 'Invalid webhook secret' });
    const b = req.body;
    if (!b.post_id || !b.post_type || !b.status || !b.slug || !b.modified || typeof b.acf !== 'object') return res.status(422).json({ detail: 'missing fields' });
    const status = answers.shift() ?? 200;
    res.status(status).json(status === 200 ? { action: 'created', post_id: String(b.post_id) } : { detail: `refused (${status})` });
  });
  chatbot = await new Promise(resolve => { const s = bot.listen(0, '127.0.0.1', () => resolve(s)); });

  // WordPress, for publishes through the route.
  const schema = JSON.parse(fs.readFileSync(new URL('./fixtures/wp-university-acf-schema.json', import.meta.url)));
  const posts = new Map();
  const wp = express();
  wp.use(express.json());
  wp.use((req, res) => {
    const m = /^\/wp-json\/wp\/v2\/(university|posts)(?:\/(\d+))?$/.exec(req.path);
    if (!m) return res.status(404).json({ code: 'rest_no_route' });
    if (req.method === 'OPTIONS') return res.json({ schema: { properties: { acf: schema } } });
    if (req.method === 'GET' && m[2]) return res.json({ id: Number(m[2]), status: 'publish' });
    if (req.method === 'POST') { const id = 300 + posts.size; posts.set(id, { id }); return res.status(201).json({ id, status: 'draft' }); }
    if (req.method === 'PUT') return res.json({ id: Number(m[2]), status: 'publish', link: `https://staging.degreebaba.com/${m[1]}/page-${m[2]}/` });
    res.status(405).end();
  });
  wpServer = await new Promise(resolve => { const s = wp.listen(0, '127.0.0.1', () => resolve(s)); });
  Object.assign(config.wordpress, { siteUrl: `http://127.0.0.1:${wpServer.address().port}`, appUser: 'editor', appPassword: 'abcd efgh ijkl mnop qrst uvwx' });
  __clearWordPressCachesForTests();

  t = await startTestApp();
  admin = await t.createUser('Admin', 'admin');
});
beforeEach(async () => {
  Object.assign(config.chatbot, { baseUrl: `http://127.0.0.1:${chatbot.address().port}`, webhookSecret: SECRET });
  received.length = 0;
  answers = [];
  await t.query('DELETE FROM chatbot_sync_events');
});
after(async () => {
  for (const s of [chatbot, wpServer]) { s.closeAllConnections(); await new Promise(r => s.close(r)); }
  assert.deepEqual(globalThis.__blockedRequests, [], 'a test tried to reach an outside service');
  await t.close();
});

const published = (id, extra = {}) => ({ id, link: `https://staging.degreebaba.com/university/page-${id}/`, acf: UNI_ACF, linkedIds: {}, ...extra });
const events = async () => (await t.query('SELECT * FROM chatbot_sync_events ORDER BY id')).rows;

test('a published page is queued, then sent with the secret and the stored payload', async () => {
  assert.deepEqual(await queueChatbotSync({ draftId: 'draft_1', pageType: 'university', published: published(101) }), { status: 'queued' });
  await drainChatbotQueue();
  const [row] = await events();
  assert.equal(row.status, 'sent');
  assert.equal(received.length, 1);
  assert.equal(received[0].secretOk, true);
  assert.deepEqual(received[0].body, JSON.parse(row.body));
  assert.equal(received[0].body.post_id, 101);
  assert.deepEqual(received[0].body.acf, UNI_ACF);
});

test('while the chatbot is down or misconfigured the page waits and is retried; a refused payload is final', async () => {
  answers = [503, 401];
  await queueChatbotSync({ draftId: 'd', pageType: 'university', published: published(102) });
  await drainChatbotQueue();
  let [row] = await events();
  assert.equal(row.status, 'queued');
  assert.match(row.last_error, /^503/);
  assert.ok(row.next_attempt_at > new Date().toISOString(), 'tried again later, not straight away');
  await drainChatbotQueue();
  assert.equal(received.length, 1, 'not due yet');
  for (let i = 0; i < 2; i++) {
    await t.query("UPDATE chatbot_sync_events SET next_attempt_at = '2000-01-01T00:00:00Z'");
    await drainChatbotQueue();
  }
  [row] = await events();
  assert.equal(row.status, 'sent', 'a 401 is retried too - the secret gets fixed in the settings');
  assert.equal(row.attempts, 3);
  assert.equal(new Set(received.map(r => JSON.stringify(r.body))).size, 1, 'every try sent the same payload');

  answers = [422];
  await queueChatbotSync({ draftId: 'd', pageType: 'university', published: published(103) });
  await drainChatbotQueue();
  const refused = (await events()).find(e => e.wp_post_id === '103');
  assert.equal(refused.status, 'failed');
  assert.match(refused.last_error, /422: refused/);
});

test('a newer publish replaces an older send still waiting - a late retry never overwrites newer content', async () => {
  answers = [503];
  await queueChatbotSync({ draftId: 'd', pageType: 'university', published: published(104, { acf: { ...UNI_ACF, about_content: '<p>Old.</p>' } }) });
  await drainChatbotQueue();
  await queueChatbotSync({ draftId: 'd', pageType: 'university', published: published(104, { acf: { ...UNI_ACF, about_content: '<p>New.</p>' } }) });
  await drainChatbotQueue();
  await t.query("UPDATE chatbot_sync_events SET next_attempt_at = '2000-01-01T00:00:00Z'");
  await drainChatbotQueue();
  const rows = await events();
  assert.deepEqual(rows.map(r => r.status), ['superseded', 'sent']);
  assert.equal(received.at(-1).body.acf.about_content, '<p>New.</p>');
  assert.equal(received.filter(r => r.body.acf.about_content === '<p>Old.</p>').length, 1, 'the old one only ever had its first try');
});

test('nothing is queued when the sync is off, or for pages the chatbot doesn\'t take', async () => {
  Object.assign(config.chatbot, { baseUrl: '', webhookSecret: '' });
  assert.deepEqual(await queueChatbotSync({ draftId: 'd', pageType: 'university', published: published(105) }), { status: 'off' });
  Object.assign(config.chatbot, { baseUrl: `http://127.0.0.1:${chatbot.address().port}`, webhookSecret: SECRET });
  assert.equal((await queueChatbotSync({ draftId: 'd', pageType: 'blog', published: published(106) })).status, 'skipped');
  assert.equal((await events()).length, 0);
});

test('publishing through the app queues the page and reports it; the publish never waits on the chatbot', async () => {
  const { body } = await t.api(admin, 'POST', '/api/drafts', { pageType: 'university' });
  await t.query("UPDATE drafts SET status = 'approved', form_data_json = $1 WHERE id = $2", [JSON.stringify({ university_name: 'Test University Online', about_content: '<p>About.</p>' }), body.draft.id]);
  const r = await t.api(admin, 'POST', `/api/drafts/${body.draft.id}/publish-to-wordpress`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.chatbot, { status: 'queued' });
  await drainChatbotQueue();
  const [row] = await events();
  assert.equal(row.draft_id, body.draft.id);
  assert.equal(row.status, 'sent');
  const sent = received.at(-1).body;
  assert.equal(sent.post_id, r.body.draft.wordpress_post_id);
  assert.equal(sent.post_type, 'university');
  assert.equal(sent.slug, `page-${r.body.draft.wordpress_post_id}`);
  assert.equal(sent.acf.university_name, 'Test University Online');

  // The chatbot unreachable: the publish still succeeds, and the page waits in the queue.
  await t.query('DELETE FROM chatbot_sync_events');
  Object.assign(config.chatbot, { baseUrl: 'http://127.0.0.1:9' });
  const again = await t.api(admin, 'POST', `/api/drafts/${body.draft.id}/publish-to-wordpress`);
  assert.equal(again.status, 200);
  await drainChatbotQueue();
  const [waiting] = await events();
  assert.equal(waiting.status, 'queued');
  assert.equal(waiting.attempts, 1);
});
