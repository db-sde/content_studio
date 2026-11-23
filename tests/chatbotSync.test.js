// Published pages go to the DegreeBaba chatbot's catalog: signed exactly as its receiver checks
// (db-sde/chatbot backend/catalog/routes.py), queued so publishing never waits, retried with the same
// bytes while the chatbot is down. The chatbot and WordPress are stand-ins on this machine.
import './helpers/env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import express from 'express';
import { startTestApp } from './helpers/testApp.js';
import { config } from '../server/config.js';
import { __clearWordPressCachesForTests } from '../server/integrations/wordpressClient.js';
import { buildCatalogEvent, signCatalogRequest, queueChatbotSync, drainChatbotQueue, CHATBOT_SOURCE } from '../server/integrations/chatbotSync.js';

const SECRET = 'test-catalog-secret-0123456789-abcdefghij';
const UNI_ACF = { university_name: 'Test University Online', about_content: '<p>About.</p>', faqs: [{ question: 'Q?', answer: 'A.' }] };

// ---------------------------------------------------------------- the event
test('the signature is the receiver\'s: HMAC-SHA256 over "<timestamp>.<METHOD>.<path>." + body', () => {
  const body = '{"a":1}';
  const headers = signCatalogRequest(SECRET, 'POST', '/webhook/catalog', body, 1795000000);
  const expected = crypto.createHmac('sha256', SECRET).update(Buffer.concat([Buffer.from('1795000000.POST./webhook/catalog.'), Buffer.from(body)])).digest('hex');
  assert.deepEqual(headers, { 'X-Catalog-Timestamp': '1795000000', 'X-Catalog-Signature': `sha256=${expected}` });
});

test('events carry the parents the chatbot needs, or are skipped with the reason', () => {
  const base = { postId: 101, link: 'https://staging.degreebaba.com/university/test-university-online/', acf: UNI_ACF, version: 5 };
  const uni = buildCatalogEvent({ ...base, pageType: 'university' }).event;
  assert.deepEqual(Object.keys(uni).sort(), ['data', 'entity_type', 'event_id', 'publication_status', 'schema_version', 'source', 'source_id', 'source_url', 'version']);
  assert.equal(uni.source, CHATBOT_SOURCE);
  assert.equal(uni.source_id, '101');
  assert.match(uni.event_id, /^[0-9a-f-]{36}$/);

  assert.match(buildCatalogEvent({ ...base, pageType: 'course' }).skip, /university page isn't linked/);
  const course = buildCatalogEvent({ ...base, pageType: 'course', linkedIds: { linked_university: 101 } }).event;
  assert.equal(course.university_source_id, '101');
  assert.ok(!('course_source_id' in course));
  assert.match(buildCatalogEvent({ ...base, pageType: 'specialization', linkedIds: { linked_university: 101 } }).skip, /course page isn't linked/);
  const spec = buildCatalogEvent({ ...base, pageType: 'specialization', linkedIds: { linked_university: [101], linked_course: [202] } }).event;
  assert.deepEqual([spec.university_source_id, spec.course_source_id], ['101', '202']);

  for (const link of ['http://staging.degreebaba.com/x/', 'https://staging.degreebaba.com/?p=12', '', null]) {
    assert.ok(buildCatalogEvent({ ...base, pageType: 'university', link }).skip, String(link));
  }
});

// ---------------------------------------------------------------- queued and sent
let t, admin, chatbot, wpServer;
const received = [];
let chatbotAnswers = []; // statuses to answer with, in order; then 202

before(async () => {
  const bot = express();
  bot.post('/webhook/catalog', express.raw({ type: '*/*' }), (req, res) => {
    const body = req.body.toString('utf8');
    const ts = req.get('X-Catalog-Timestamp');
    const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(`${ts}.POST./webhook/catalog.`).update(body).digest('hex');
    const ok = req.get('X-Catalog-Signature') === expected && Math.abs(Date.now() / 1000 - Number(ts)) <= 300;
    received.push({ body, ok });
    if (!ok) return res.status(401).json({ detail: 'Invalid catalog signature' });
    const status = chatbotAnswers.shift() ?? 202;
    res.status(status).json(status < 300 ? { ok: true, status: 'queued' } : { detail: `refused (${status})` });
  });
  chatbot = await new Promise(resolve => { const s = bot.listen(0, '127.0.0.1', () => resolve(s)); });

  // WordPress, for one publish through the route.
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
  chatbotAnswers = [];
  await t.query('DELETE FROM chatbot_sync_events');
});
after(async () => {
  for (const s of [chatbot, wpServer]) { s.closeAllConnections(); await new Promise(r => s.close(r)); }
  assert.deepEqual(globalThis.__blockedRequests, [], 'a test tried to reach an outside service');
  await t.close();
});

const published = (id, extra = {}) => ({ id, link: `https://staging.degreebaba.com/university/page-${id}/`, acf: UNI_ACF, linkedIds: {}, ...extra });
const events = async () => (await t.query('SELECT * FROM chatbot_sync_events ORDER BY id')).rows;

test('a published page is queued, then sent signed - the exact stored bytes', async () => {
  const r = await queueChatbotSync({ draftId: 'draft_1', pageType: 'university', published: published(101) });
  assert.deepEqual(r, { status: 'queued' });
  await drainChatbotQueue();
  const [row] = await events();
  assert.equal(row.status, 'sent');
  assert.equal(received.length, 1);
  assert.equal(received[0].ok, true, 'signature accepted');
  assert.equal(received[0].body, row.body);
  const event = JSON.parse(row.body);
  assert.deepEqual(event.data, UNI_ACF);
  assert.ok(Number(row.version) >= Date.now() - 60000);

  // Published again: a new event with a higher version for the same page.
  await queueChatbotSync({ draftId: 'draft_1', pageType: 'university', published: published(101) });
  await drainChatbotQueue();
  const rows = await events();
  assert.equal(rows.length, 2);
  assert.ok(Number(rows[1].version) > Number(rows[0].version));
  assert.notEqual(rows[1].event_id, rows[0].event_id);
});

test('while the chatbot is down the event waits and is retried with the same bytes; a refusal is final', async () => {
  chatbotAnswers = [503, 503];
  await queueChatbotSync({ draftId: 'd', pageType: 'university', published: published(102) });
  await drainChatbotQueue();
  let [row] = await events();
  assert.equal(row.status, 'queued');
  assert.equal(row.attempts, 1);
  assert.match(row.last_error, /503/);
  assert.ok(row.next_attempt_at > new Date().toISOString(), 'tried again later, not straight away');
  await drainChatbotQueue();
  assert.equal(received.length, 1, 'not due yet');

  for (let i = 0; i < 2; i++) {
    await t.query("UPDATE chatbot_sync_events SET next_attempt_at = '2000-01-01T00:00:00Z'");
    await drainChatbotQueue();
  }
  [row] = await events();
  assert.equal(row.status, 'sent');
  assert.equal(row.attempts, 3);
  assert.deepEqual(new Set(received.map(r => r.body)).size, 1, 'every try sent the same event');

  chatbotAnswers = [422];
  await queueChatbotSync({ draftId: 'd', pageType: 'university', published: published(103) });
  await drainChatbotQueue();
  const failed = (await events()).find(e => e.wp_post_id === '103');
  assert.equal(failed.status, 'failed');
  assert.match(failed.last_error, /422: refused/);
});

test('nothing is queued when the sync is off, or for pages the chatbot doesn\'t take', async () => {
  Object.assign(config.chatbot, { baseUrl: '', webhookSecret: '' });
  assert.deepEqual(await queueChatbotSync({ draftId: 'd', pageType: 'university', published: published(104) }), { status: 'off' });
  Object.assign(config.chatbot, { baseUrl: `http://127.0.0.1:${chatbot.address().port}`, webhookSecret: 'too-short' });
  assert.equal((await queueChatbotSync({ draftId: 'd', pageType: 'university', published: published(104) })).status, 'off', 'a secret under 32 characters counts as off');
  Object.assign(config.chatbot, { webhookSecret: SECRET });
  assert.equal((await queueChatbotSync({ draftId: 'd', pageType: 'blog', published: published(105) })).status, 'skipped');
  const course = await queueChatbotSync({ draftId: 'd', pageType: 'course', published: published(106) });
  assert.deepEqual(course, { status: 'skipped', reason: 'its university page isn\'t linked on WordPress' });
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
  const event = JSON.parse(row.body);
  assert.equal(event.source_id, String(r.body.draft.wordpress_post_id));
  assert.equal(event.source_url, r.body.draft.wordpress_url);
  assert.equal(event.data.university_name, 'Test University Online');

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
