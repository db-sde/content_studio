// Blog & Category Summary: a Word file in, a draft with the summary and SEO fields out, reviewed like
// any page, published to WordPress as the micro app did. The AI and WordPress are stand-ins on this
// machine (nothing leaves it - tests/helpers/env.js blocks outside requests).
import './helpers/env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { startTestApp } from './helpers/testApp.js';
import { config } from '../server/config.js';
import { __setClientForTests as setAnthropicClient } from '../server/ai/providers/anthropicProvider.js';
import { __clearWordPressCachesForTests } from '../server/integrations/wordpressClient.js';
import { readingTimeOf, wordCount, cleanSummaryHtml, summaryEditorHtml, lengthTone, countBullets } from '../src/config/summaryPages.js';
import { summaryHtmlFrom, SUMMARY_SYSTEM_PROMPT, SEO_SYSTEM_PROMPT } from '../server/ai/blogSummary.js';
import { complete } from '../server/ai/providers/anthropicProvider.js';
import { buildDraftColumns } from '../src/utils/draftColumnFilters.js';

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const BLOG_DOC = fixture('summary-blog.docx');
const SUMMARY = '<ul><li><strong>Flexible:</strong> study while you work.</li><li>Fees from INR 1 lakh.</li><li>No-cost EMI.</li><li>Five popular specializations.</li></ul>';
const SEO = { seo_title: '10 Best Online MBA Programs in India for 2027 | DegreeBaba', meta_description: 'Compare the best online MBA programs in India for 2027: fees, EMI, specializations and UGC-entitled degrees you can earn while you keep working.' };

// ---------------------------------------------------------------- rules
test('reading time: words split on whitespace, 200 a minute, at least 1, rounded like Python', () => {
  const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
  assert.equal(readingTimeOf(words(349)), '2 min read');
  assert.equal(readingTimeOf(''), '1 min read', 'never 0');
  assert.equal(readingTimeOf(words(100)), '1 min read');
  assert.equal(readingTimeOf(words(500)), '2 min read', '2.5 rounds to the even 2, as Python round() does');
  assert.equal(readingTimeOf(words(700)), '4 min read', '3.5 rounds to the even 4');
  assert.equal(readingTimeOf(words(1310)), '7 min read');
  assert.equal(wordCount('  one\ttwo\n\nthree  '), 3);
});

test('the summary goes to WordPress as one clean list', () => {
  // What the editor stores: each item's text wrapped in <p>.
  assert.equal(cleanSummaryHtml('<ul><li><p>One.</p></li><li><p><strong>Two</strong> more.</p></li></ul>'), '<ul><li>One.</li><li><strong>Two</strong> more.</li></ul>');
  assert.equal(cleanSummaryHtml('```html\n<ul><li>A</li><li></li><li>B</li></ul>\n```'), '<ul><li>A</li><li>B</li></ul>', 'fence and empty items gone');
  assert.equal(cleanSummaryHtml('- First point\n- Second point'), '<ul><li>First point</li><li>Second point</li></ul>');
  assert.equal(summaryHtmlFrom('<ul><li>Safe<script>alert(1)</script></li><li><b>Bold</b> <img src=x onerror=1></li></ul>'), '<ul><li>Safe</li><li><strong>Bold</strong></li></ul>');
  assert.equal(countBullets(SUMMARY), 4);
  assert.equal(summaryEditorHtml('<ul><li><strong>A</strong> b</li></ul>'), '<ul><li><p><strong>A</strong> b</p></li></ul>');
  assert.equal(cleanSummaryHtml(summaryEditorHtml(SUMMARY)), SUMMARY, 'round trip');
});

test('SEO length targets: 50-60 and 140-160 characters', () => {
  assert.equal(lengthTone('seo_title', 'x'.repeat(49)), 'short');
  assert.equal(lengthTone('seo_title', 'x'.repeat(55)), 'ok');
  assert.equal(lengthTone('seo_title', 'x'.repeat(61)), 'over');
  assert.equal(lengthTone('meta_description', 'x'.repeat(150)), 'ok');
  assert.equal(lengthTone('meta_description', 'x'.repeat(161)), 'over');
  assert.equal(lengthTone('meta_description', ''), 'empty');
});

test('blog and category drafts group as their own kind in the Drafts table filters', () => {
  const columns = buildDraftColumns({ title: (d) => d.seo_title || 'Untitled', isUntitled: () => false, isDuplicate: () => false, isRepeated: () => false,
    ownerId: () => 1, ownerName: () => 'A', statusLabels: {}, pageTypeLabel: (x) => x, now: new Date() });
  const valuesOf = (id, d) => columns.find(c => c.id === id).values(d).map(v => v.label);
  assert.deepEqual(valuesOf('university', { page_type: 'blog' }), ['Blog & category pages']);
  assert.deepEqual(valuesOf('program', { page_type: 'blog', seo_title: 'Best MBA' }), ['Blog posts']);
  assert.deepEqual(valuesOf('program', { page_type: 'category', seo_title: 'MBA' }), ['Category pages']);
});

test('a model that refuses a temperature setting gets the call again without it', async () => {
  const sent = [];
  setAnthropicClient({ messages: { create: async (body) => {
    sent.push(body);
    if ('temperature' in body) throw Object.assign(new Error('temperature is not supported for this model'), { status: 400 });
    return { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
  } } });
  try {
    const r = await complete({ system: 's', prompt: 'p', temperature: 0.4, model: 'model-without-temperature' });
    assert.equal(r.text, 'ok');
    assert.deepEqual(sent.map(b => 'temperature' in b), [true, false]);
    await complete({ system: 's', prompt: 'p', temperature: 0.4, model: 'model-without-temperature' });
    assert.equal(sent.length, 3, 'later calls leave it out straight away');
  } finally {
    setAnthropicClient(fakeClaude);
  }
});

// ---------------------------------------------------------------- through the routes
let t, intern, intern2, senior, admin, server;
const claudeCalls = [];
let claudeMode = 'ok';
const wp = { requests: [], posts: new Map(), nextId: 700, failAcf: false };

let fakeClaude;
before(async () => {
  setAnthropicClient(fakeClaude = {
    messages: {
      create: async (body) => {
        claudeCalls.push(body);
        if (claudeMode === 'down') throw Object.assign(new Error('overloaded'), { status: 529 });
        const usage = { input_tokens: 1200, output_tokens: 150 };
        if (body.system === SUMMARY_SYSTEM_PROMPT) return { content: [{ type: 'text', text: `\`\`\`html\n${SUMMARY}\n\`\`\`` }], stop_reason: 'end_turn', usage };
        if (claudeMode === 'bad-seo') return { content: [{ type: 'text', text: 'Sorry, here you go: not json' }], stop_reason: 'end_turn', usage };
        return { content: [{ type: 'text', text: JSON.stringify(SEO) }], stop_reason: 'end_turn', usage };
      }
    }
  });

  const app = express();
  app.use(express.json());
  app.use((req, res) => {
    wp.requests.push({ method: req.method, path: req.path, query: req.query, body: req.body });
    const m = /^\/wp-json\/wp\/v2\/(posts|category-page)(?:\/(\d+))?$/.exec(req.path);
    if (!m) return res.status(404).json({ code: 'rest_no_route', message: 'No route' });
    const [, , id] = m;
    if (req.method === 'GET' && id) return wp.posts.has(Number(id)) ? res.json({ id: Number(id), status: wp.posts.get(Number(id)).status }) : res.status(404).json({ code: 'rest_post_invalid_id', message: 'Invalid post ID.' });
    if (req.method === 'POST' && !id) {
      const post = { id: wp.nextId++, ...req.body, acf: {} }; // the site drops "acf" sent with a create
      wp.posts.set(post.id, post);
      return res.status(201).json({ id: post.id, status: post.status, link: `https://site.test/?p=${post.id}` });
    }
    if (req.method === 'PUT' && id) {
      if (wp.failAcf && req.body.acf) return res.status(400).json({ code: 'rest_invalid_param', message: 'Invalid parameter(s): acf' });
      Object.assign(wp.posts.get(Number(id)), req.body);
      return res.json({ id: Number(id), status: req.body.status, link: `https://site.test/${m[1]}/${id}` });
    }
    if (req.method === 'DELETE' && id) {
      wp.posts.delete(Number(id));
      return res.json({ deleted: true });
    }
    res.status(405).end();
  });
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  Object.assign(config.wordpress, { siteUrl: `http://127.0.0.1:${server.address().port}`, appUser: 'editor', appPassword: 'abcd efgh ijkl mnop qrst uvwx' });
  __clearWordPressCachesForTests();

  t = await startTestApp();
  senior = await t.createUser('Senior', 'senior');
  admin = await t.createUser('Admin', 'admin');
});
// Fresh interns for every test: uploads are rate-limited per user (10 per 5 minutes).
let userCount = 0;
beforeEach(async () => {
  intern = await t.createUser(`Intern ${++userCount}`, 'intern');
  intern2 = await t.createUser(`Other Intern ${userCount}`, 'intern');
  claudeCalls.length = 0;
  claudeMode = 'ok';
  wp.requests.length = 0;
  wp.failAcf = false;
});
after(async () => {
  setAnthropicClient(null);
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  assert.deepEqual(globalThis.__blockedRequests, [], 'a test tried to reach an outside service');
  await t.close();
});

let keyCounter = 0;
async function upload(user, { pageType = 'blog', bytes = BLOG_DOC, name = 'Best Online MBA.docx', uploadKey = `key-${++keyCounter}` } = {}) {
  const form = new FormData();
  if (pageType) form.append('pageType', pageType);
  form.append('uploadKey', uploadKey);
  form.append('document', new Blob([bytes]), name);
  const res = await fetch(`${t.baseUrl}/api/drafts/summary-upload`, { method: 'POST', headers: { cookie: user.cookie }, body: form });
  return { status: res.status, body: await res.json() };
}

test('a blog upload makes a draft with the 4 fields, keeps the document, and logs the cost', async () => {
  const r = await upload(intern);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const { draft } = r.body;
  assert.equal(draft.page_type, 'blog');
  assert.equal(draft.status, 'intern_editing');
  assert.equal(draft.created_by_user_id, intern.id);
  assert.equal(draft.source, 'upload');
  assert.equal(draft.source_filename, 'Best Online MBA.docx');
  // Stored as the editor keeps it (each item in a <p>), so opening the draft changes nothing.
  assert.equal(draft.form_data.complete_page_summary, summaryEditorHtml(SUMMARY), 'fence stripped, list kept');
  assert.equal(cleanSummaryHtml(draft.form_data.complete_page_summary), SUMMARY);
  assert.equal(draft.form_data.seo_title, SEO.seo_title);
  assert.equal(draft.form_data.meta_description, SEO.meta_description);
  assert.equal(draft.form_data.reading_time, '2 min read', '349 words');
  assert.equal(r.body.seoError, null);

  // The micro app's prompts and settings, on Content Studio's own model.
  const [summaryCall, seoCall] = claudeCalls;
  assert.equal(summaryCall.model, config.anthropicModel);
  assert.equal(summaryCall.temperature, 0.4);
  assert.match(summaryCall.messages[0].content, /^Please read the following blog content and generate the 4-5 point HTML bulleted summary:\n\n<content>\n10 Best Online MBA/);
  assert.equal(seoCall.system, SEO_SYSTEM_PROMPT);
  assert.equal(seoCall.temperature, 0.3);
  assert.match(seoCall.messages[0].content, /^Generate SEO fields for the following Blog page content\./);
  const seoContent = /Content \(truncated\):\n([\s\S]*)\n\nReturn ONLY/.exec(seoCall.messages[0].content)[1];
  assert.equal(seoContent.length, 1500, 'the first 1500 characters');

  const doc = await t.query('SELECT filename, content FROM draft_source_documents WHERE draft_id = $1', [draft.id]);
  assert.equal(doc.rows[0].filename, 'Best Online MBA.docx');
  assert.ok(Buffer.from(doc.rows[0].content).equals(BLOG_DOC), 'the Word file is stored as uploaded');
  const logs = await t.query('SELECT field_key, model FROM generation_logs WHERE draft_id = $1 ORDER BY id', [draft.id]);
  assert.deepEqual(logs.rows.map(l => l.field_key), ['complete_page_summary', 'seo_fields']);
  const cost = await t.api(intern, 'GET', `/api/drafts/${draft.id}/cost-summary`);
  assert.ok(cost.body.totalUsd > 0, 'shows in the cost summary');
  assert.equal(cost.body.generateCalls, 2);

  // In the Drafts list, with its title and the document flag that shows the download bar.
  const listed = (await t.api(intern, 'GET', '/api/drafts')).body.drafts.find(d => d.id === draft.id);
  assert.equal(listed.seo_title, SEO.seo_title);
  assert.equal(listed.has_source_document, true);
  assert.equal((await fetch(`${t.baseUrl}/api/drafts/${draft.id}/source-document`, { headers: { cookie: intern.cookie } })).status, 200);
});

test('a category upload makes a draft with 3 fields - no reading time', async () => {
  const r = await upload(intern, { pageType: 'category', name: 'MBA category.docx' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.draft.page_type, 'category');
  assert.ok(!('reading_time' in r.body.draft.form_data));
  assert.match(claudeCalls[0].messages[0].content, /following category content/);
  assert.match(claudeCalls[1].messages[0].content, /following Category page content/);
});

test('sending the same file twice returns the same draft, without paying for the AI again', async () => {
  const first = await upload(intern, { uploadKey: 'same-file' });
  const again = await upload(intern, { uploadKey: 'same-file' });
  assert.equal(again.status, 200);
  assert.equal(again.body.existed, true);
  assert.equal(again.body.draft.id, first.body.draft.id);
  assert.equal(claudeCalls.length, 2, 'one summary + one SEO call in all');
  // Two at once (a double click, or leaving and coming back) still make one draft.
  claudeCalls.length = 0;
  const [a, b] = await Promise.all([upload(intern, { uploadKey: 'twin' }), upload(intern, { uploadKey: 'twin' })]);
  assert.equal(a.body.draft.id, b.body.draft.id);
  assert.equal(claudeCalls.length, 2);
  // Another user's upload of the same file is theirs.
  const other = await upload(intern2, { uploadKey: 'same-file' });
  assert.notEqual(other.body.draft.id, first.body.draft.id);
});

test('wrong, empty, unreadable or oversized files are refused before any AI call', async () => {
  const cases = [
    [{ name: 'notes.pdf' }, 415, /Only Word documents \(\.docx\)/],
    [{ bytes: fixture('summary-not-a-word-file.docx') }, 422, /couldn't be read as a Word document/],
    [{ bytes: fixture('summary-empty.docx') }, 422, /No text was found in this document/],
    [{ bytes: Buffer.alloc(8 * 1024 * 1024 + 1) }, 413, /larger than 8 MB/],
    [{ pageType: null }, 400, /blog post or a category page/],
    [{ pageType: 'course' }, 400, /blog post or a category page/]
  ];
  for (const [opts, status, message] of cases) {
    const r = await upload(intern, opts);
    assert.equal(r.status, status, `${JSON.stringify(Object.keys(opts))}: ${JSON.stringify(r.body)}`);
    assert.match(r.body.error, message);
  }
  assert.equal(claudeCalls.length, 0);
});

test('the daily AI budget applies: no call once it is used up', async () => {
  const saved = config.limits.aiDailyBudgetUsd;
  config.limits.aiDailyBudgetUsd = 0.000001;
  try {
    await t.query("INSERT INTO generation_logs (draft_id,page_type,field_key,attempt_number,model,prompt,facts_json,style_version,output,input_tokens,output_tokens) VALUES ('x','blog','f',1,$1,'p','{}','v','o',1000,1000)", [config.anthropicModel]);
    const r = await upload(intern);
    assert.equal(r.status, 429);
    assert.match(r.body.error, /AI spending limit/);
    assert.equal(claudeCalls.length, 0);
  } finally {
    config.limits.aiDailyBudgetUsd = saved;
    await t.query("DELETE FROM generation_logs WHERE draft_id = 'x'");
  }
});

test('the AI failing says so and saves nothing; a failed SEO call still keeps the summary', async () => {
  claudeMode = 'down';
  const before = (await t.query('SELECT count(*)::int n FROM drafts')).rows[0].n;
  const down = await upload(intern);
  assert.equal(down.status, 502);
  assert.match(down.body.error, /The AI service couldn't write this .* try again/);
  assert.equal((await t.query('SELECT count(*)::int n FROM drafts')).rows[0].n, before);

  claudeMode = 'bad-seo';
  const partial = await upload(intern);
  assert.equal(partial.status, 201);
  assert.equal(cleanSummaryHtml(partial.body.draft.form_data.complete_page_summary), SUMMARY);
  assert.equal(partial.body.draft.form_data.seo_title, '');
  assert.match(partial.body.seoError, /unreadable/);
});

test('Regenerate: one field at a time, for whoever holds the draft and may edit the field', async () => {
  const { draft } = (await upload(intern)).body;
  const regen = (user, fieldKey, id = draft.id) => t.api(user, 'POST', `/api/drafts/${id}/summary-regenerate`, { fieldKey });

  claudeCalls.length = 0;
  let r = await regen(intern, 'meta_description');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.value, SEO.meta_description);
  assert.equal(claudeCalls.length, 1);
  r = await regen(intern, 'complete_page_summary');
  assert.equal(r.body.value, summaryEditorHtml(SUMMARY));
  assert.equal((await regen(intern, 'reading_time')).status, 400, 'counted, not written');
  assert.equal((await regen(intern2, 'seo_title')).status, 403, 'another intern\'s draft');
  assert.equal((await regen(senior, 'seo_title')).status, 403, 'still with the intern');

  await t.query("UPDATE drafts SET status = 'senior_review' WHERE id = $1", [draft.id]);
  assert.equal((await regen(senior, 'seo_title')).status, 200);
  assert.equal((await regen(intern, 'seo_title')).status, 403, 'with the senior now');

  // The other AI routes don't write these pages - they have no facts, only a document.
  await t.query("UPDATE drafts SET status = 'intern_editing' WHERE id = $1", [draft.id]);
  const all = await t.api(intern, 'POST', `/api/drafts/${draft.id}/generate-all-fields`, { fields: [{ fieldKey: 'seo_title' }], facts: {} });
  assert.equal(all.status, 400);
  assert.match(all.body.error, /use Regenerate/);
});

test('an intern edits the generated fields and sends the draft on like any page', async () => {
  const { draft } = (await upload(intern)).body;
  const save = await t.api(intern, 'PUT', `/api/drafts/${draft.id}`, { formData: { ...draft.form_data, seo_title: 'Edited title for the best online MBA programs in 2027' } });
  assert.equal(save.body.skippedKeys, undefined);
  assert.equal(save.body.draft.form_data.seo_title, 'Edited title for the best online MBA programs in 2027');
  const sent = await t.api(intern, 'PATCH', `/api/drafts/${draft.id}/status`, { action: 'send-to-senior' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.draft.status, 'senior_review');
});

async function approvedDraft(pageType) {
  const { draft } = (await upload(intern, { pageType })).body;
  await t.query("UPDATE drafts SET status = 'approved' WHERE id = $1", [draft.id]);
  return draft;
}

test('publishing a blog: posts, title = SEO title, body = summary, created as a draft then given acf + status', async () => {
  const draft = await approvedDraft('blog');
  const r = await t.api(admin, 'POST', `/api/drafts/${draft.id}/publish-to-wordpress`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const writes = wp.requests.filter(q => q.method !== 'GET');
  assert.deepEqual(writes.map(q => `${q.method} ${q.path}`), ['POST /wp-json/wp/v2/posts', `PUT /wp-json/wp/v2/posts/${r.body.draft.wordpress_post_id}`]);
  assert.deepEqual(writes[0].body, { title: SEO.seo_title, status: 'draft', content: SUMMARY });
  assert.deepEqual(writes[1].body, {
    acf: { complete_page_summary: SUMMARY, seo_title: SEO.seo_title, meta_description: SEO.meta_description, reading_time: '2 min read' },
    status: 'publish'
  });
  assert.equal(wp.requests.filter(q => q.method === 'OPTIONS').length, 0, 'no field-list check, as the micro app');

  // Re-publishing updates it in one request: title, status, acf and content together.
  wp.requests.length = 0;
  const again = await t.api(admin, 'POST', `/api/drafts/${draft.id}/publish-to-wordpress`);
  assert.equal(again.status, 200);
  const update = wp.requests.find(q => q.method === 'PUT');
  assert.deepEqual(Object.keys(update.body).sort(), ['acf', 'content', 'status', 'title']);
});

test('publishing a category page uses category-page, with no reading time', async () => {
  const draft = await approvedDraft('category');
  const r = await t.api(admin, 'POST', `/api/drafts/${draft.id}/publish-to-wordpress`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const writes = wp.requests.filter(q => q.method !== 'GET');
  assert.equal(writes[0].path, '/wp-json/wp/v2/category-page');
  assert.deepEqual(Object.keys(writes[1].body.acf).sort(), ['complete_page_summary', 'meta_description', 'seo_title']);
});

test('if WordPress refuses the fields, the empty new post is deleted and WordPress\'s message is shown', async () => {
  const draft = await approvedDraft('blog');
  wp.failAcf = true;
  const r = await t.api(admin, 'POST', `/api/drafts/${draft.id}/publish-to-wordpress`);
  assert.equal(r.status, 502);
  assert.match(r.body.error, /Invalid parameter\(s\): acf|rejected/);
  const created = wp.requests.find(q => q.method === 'POST');
  assert.ok(created);
  const del = wp.requests.find(q => q.method === 'DELETE');
  assert.ok(del, 'the empty post is removed');
  assert.equal(del.query.force, 'true');
  assert.equal(wp.posts.size, [...wp.posts.values()].filter(p => p.status !== 'draft').length, 'no empty draft left behind');
  const { rows } = await t.query('SELECT wordpress_post_id FROM drafts WHERE id = $1', [draft.id]);
  assert.equal(rows[0].wordpress_post_id, null, 'nothing to retry against - the next publish starts fresh');
});
