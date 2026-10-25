// The whole life of a page, for each page type, through the real routes: an intern creates it and
// fills the facts, "Generate All" writes the AI fields, the senior sends it on, the admin approves
// and publishes it to WordPress. Then a course is linked to that university, and a specialization
// to both - the links WordPress needs are found by itself. Claude, GPT and WordPress are stand-ins
// (nothing leaves the machine); this WordPress enforces the live site's own field definitions
// (tests/fixtures) and its quirk of dropping custom fields sent with a create.
import './helpers/env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { startTestApp } from './helpers/testApp.js';
import { config } from '../server/config.js';
import { schemas } from '../src/config/schemas.js';
import { __setClientForTests as setAnthropicClient } from '../server/ai/providers/anthropicProvider.js';
import { __setClientForTests as setOpenAiClient } from '../server/ai/providers/openaiProvider.js';
import { __clearWordPressCachesForTests } from '../server/integrations/wordpressClient.js';

const SCHEMAS = Object.fromEntries(['specialization', 'course', 'university'].map(t => [t, JSON.parse(fs.readFileSync(new URL(`./fixtures/wp-${t}-acf-schema.json`, import.meta.url)))]));
const UNIVERSITY = 'Test University Online';
const COURSE = 'Online MBA';
const SPEC = 'Online MBA in Finance';

// WordPress's own type rules for "acf" values (see tests/wordpress.test.js).
function wpInvalid(value, schema, path) {
  const types = [].concat(schema.type || []);
  if (value === null) return types.includes('null') ? null : `${path} is not of type ${types}.`;
  if (Array.isArray(value)) {
    if (!types.includes('array')) return `${path} is not of type ${types}.`;
    for (const [i, item] of value.entries()) { const e = wpInvalid(item, schema.items || {}, `${path}[${i}]`); if (e) return e; }
    return null;
  }
  if (typeof value === 'object') {
    if (!schema.properties) return `${path} is not of type ${types}.`;
    for (const [k, v] of Object.entries(value)) {
      if (!schema.properties[k]) return `${path}[${k}] is not a valid property of Object.`;
      const e = wpInvalid(v, schema.properties[k], `${path}[${k}]`); if (e) return e;
    }
    return null;
  }
  if (types.includes('integer') && Number.isInteger(value)) return null;
  if (types.includes('number') && typeof value === 'number') return null;
  if (types.includes('string') && typeof value === 'string') return null;
  return `${path} is not of type ${types}.`;
}

let t, intern, senior, admin, server;
const posts = new Map();
let nextId = 500;

before(async () => {
  // Claude: SEO fields get valid titles/descriptions built from the page's own facts; every other
  // field gets a paragraph naming itself, so the test can find it on the WordPress side.
  setAnthropicClient({
    messages: {
      create: async (body) => {
        if (body.max_tokens === 0) return { content: [], stop_reason: 'max_tokens', usage: { input_tokens: 1, cache_creation_input_tokens: 1000 } };
        const [factsBlock, fieldBlock] = body.messages[0].content;
        const facts = JSON.parse(factsBlock.text.replace(/^<structured_facts>\n/, '').replace(/\n<\/structured_facts>$/, ''));
        const label = /write the "([^"]+)" field/.exec(fieldBlock.text)[1];
        const subject = facts.spec_name || facts.program_name || facts.university_name;
        const text = label === 'SEO Title' ? `${subject} | ${facts.university_name === subject ? 'Admissions 2026' : facts.university_name}`
          : label === 'Meta Description' ? `Study ${subject} at ${facts.university_name}: flexible online classes, live sessions, a UGC-entitled degree and easy EMI options.`
          : `Generated ${label} for ${subject}.`;
        return { content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000 } };
      }
    }
  });
  setOpenAiClient({
    chat: {
      completions: {
        create: async () => {
          const scores = Object.fromEntries(['tone', 'vocabulary', 'sentence_flow', 'readability', 'specificity', 'factual_grounding', 'seo_readability', 'brand_voice', 'generic_language'].map(k => [k, 8.5]));
          return { choices: [{ message: { content: JSON.stringify({ scores, overall: 8.5, feedback: 'Good.' }) } }], usage: { prompt_tokens: 2000, completion_tokens: 150 } };
        }
      }
    }
  });

  // WordPress, with the live site's field definitions and behaviour.
  const app = express();
  app.use(express.json());
  app.use((req, res) => {
    const m = /^\/wp-json\/wp\/v2\/([a-z-]+)(?:\/(\d+))?$/.exec(req.path);
    const schema = m && SCHEMAS[m[1]];
    if (!schema) return res.status(404).json({ code: 'rest_no_route', message: 'No route' });
    const [, type, id] = m;
    if (req.method === 'OPTIONS') return res.json({ schema: { properties: { acf: schema } } });
    if (req.method === 'GET' && id) {
      const post = posts.get(Number(id));
      return post ? res.json({ id: post.id, status: post.status }) : res.status(404).json({ code: 'rest_post_invalid_id', message: 'Invalid post ID.' });
    }
    if (req.method === 'GET') {
      const q = String(req.query.search || '').toLowerCase();
      return res.json([...posts.values()].filter(p => p.type === type && p.status === 'publish' && p.title.toLowerCase().includes(q))
        .map(p => ({ id: p.id, title: { rendered: p.title }, acf: { linked_university: p.acf.linked_university ?? null } })));
    }
    if (req.method === 'POST' && !id) {
      const post = { id: nextId++, type, status: req.body.status, title: req.body.title, acf: {} }; // acf on create: dropped
      posts.set(post.id, post);
      return res.status(201).json({ id: post.id, status: post.status, link: `https://site.test/?p=${post.id}` });
    }
    if (req.method === 'PUT' && id) {
      const post = posts.get(Number(id));
      for (const [k, v] of Object.entries(req.body.acf || {})) {
        const problem = schema.properties[k] ? wpInvalid(v, schema.properties[k], `acf[${k}]`) : `acf[${k}] is not a valid property of Object.`;
        if (problem) return res.status(400).json({ code: 'rest_invalid_param', message: 'Invalid parameter(s): acf', data: { params: { acf: problem } } });
      }
      Object.assign(post, { status: req.body.status, title: req.body.title, acf: req.body.acf });
      return res.json({ id: post.id, status: post.status, link: `https://site.test/${type}/${post.id}` });
    }
    res.status(405).json({ code: 'rest_no_route', message: 'Method not allowed' });
  });
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  Object.assign(config.wordpress, { siteUrl: `http://127.0.0.1:${server.address().port}`, appUser: 'editor', appPassword: 'abcd efgh ijkl mnop qrst uvwx' });
  __clearWordPressCachesForTests();

  t = await startTestApp();
  intern = await t.createUser('Intern Cycle', 'intern');
  senior = await t.createUser('Senior Cycle', 'senior');
  admin = await t.createUser('Admin Cycle', 'admin');
});

after(async () => {
  setAnthropicClient(null);
  setOpenAiClient(null);
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  assert.deepEqual(globalThis.__blockedRequests, [], 'a test tried to reach an outside service');
  await t.close();
});

// The facts an intern types: every non-AI field filled, every list with a row; AI fields left blank.
function factsFor(pageType, overrides) {
  const data = { page_type: pageType };
  for (const sec of schemas[pageType].sections) for (const f of sec.fields) {
    if (f.aiAssist) data[f.key] = '';
    else if (f.type === 'REPEATER') data[f.key] = [Object.fromEntries(f.subfields.map(s => [s.key, `Sample ${s.key}`]))];
    else data[f.key] = `Sample ${f.key}`;
  }
  return { ...data, ...overrides };
}

// Intern -> Generate All -> Senior -> Admin approves -> Admin publishes. Returns the publish response.
async function fullCycle(pageType, overrides) {
  const facts = factsFor(pageType, overrides);
  const { body } = await t.api(intern, 'POST', '/api/drafts', { pageType });
  const id = body.draft.id;
  assert.equal((await t.api(intern, 'PUT', `/api/drafts/${id}`, { formData: facts })).status, 200);

  const aiFields = [];
  const aiFacts = {};
  for (const sec of schemas[pageType].sections) for (const f of sec.fields) {
    if (f.aiAssist) aiFields.push({ fieldKey: f.key, fieldLabel: f.label, fieldInstructions: f.aiAssist.instructions, outputFormat: f.type === 'RICH_TEXT' ? 'markdown' : f.type === 'TEXT_INPUT' ? 'plain-short' : 'plain' });
    else if (!['faqs', 'reviews'].includes(f.key)) aiFacts[f.key] = facts[f.key];
  }
  const generated = await t.api(intern, 'POST', `/api/drafts/${id}/generate-all-fields`, { fields: aiFields, facts: aiFacts, onlyEmpty: false });
  assert.equal(generated.status, 200, JSON.stringify(generated.body));
  assert.deepEqual(generated.body.failures, [], `${pageType}: every AI field generated`);
  assert.equal(generated.body.draft.status, 'senior_review', `${pageType}: goes to the senior once generated`);
  for (const f of aiFields) assert.ok(String(generated.body.draft.form_data[f.fieldKey] || '').trim(), `${pageType}: ${f.fieldKey} filled by AI`);

  assert.equal((await t.api(senior, 'PATCH', `/api/drafts/${id}/status`, { action: 'send-to-admin' })).status, 200, `${pageType}: senior can send on`);
  const approved = await t.api(admin, 'PATCH', `/api/drafts/${id}/status`, { action: 'approve' });
  assert.equal(approved.body.draft.status, 'approved', `${pageType}: admin approves`);

  const published = await t.api(admin, 'POST', `/api/drafts/${id}/publish-to-wordpress`);
  assert.equal(published.status, 200, `${pageType}: ${JSON.stringify(published.body)}`);
  return { id, aiFields, published: published.body, post: posts.get(published.body.draft.wordpress_post_id) };
}

test('a University page goes all the way: AI fields, review, approval, live on WordPress with its content', async () => {
  const { aiFields, published, post } = await fullCycle('university', { university_name: UNIVERSITY, university_full_name: `${UNIVERSITY} (Deemed)` });
  assert.equal(post.type, 'university');
  assert.equal(post.status, 'publish');
  assert.equal(post.title, UNIVERSITY);
  assert.ok(published.draft.wordpress_url, 'the draft knows its live link');
  for (const f of aiFields) {
    if (f.fieldKey === 'seo_title' || f.fieldKey === 'meta_description') assert.match(post.acf[f.fieldKey], new RegExp(UNIVERSITY), f.fieldKey);
    else assert.match(post.acf[f.fieldKey], /Generated/, `AI-written ${f.fieldKey} is on the WordPress page`);
  }
  assert.match(post.acf.facts_content, /<li><strong>Sample fact_title<\/strong>: Sample fact_description<\/li>/);
  assert.deepEqual(post.acf.programs_table, [{ program_name: 'Sample program_name', program_fee: 'Sample program_fee', program_eligibility: 'Sample program_eligibility' }]);
  assert.deepEqual(post.acf.faculty_members, [{ member_name: 'Sample member_name', member_designation: 'Sample member_designation, Sample member_program, Sample member_qualification' }]);
  assert.equal(Object.keys(post.acf).length, 41);
  assert.deepEqual(published.skipped, ['admission_steps_list (no such field in WordPress)']);

  // Approved, it's offered in the Linked University dropdown of course/specialization pages.
  const directory = (await t.api(intern, 'GET', '/api/directory?pageType=university')).body.entries;
  assert.ok(directory.some(e => e.display_name === UNIVERSITY));
});

test('a Course published after its university is linked to it on WordPress, by itself', async () => {
  const { post, published } = await fullCycle('course', { program_name: COURSE, university_name: UNIVERSITY, linked_university: UNIVERSITY });
  const university = [...posts.values()].find(p => p.type === 'university');
  assert.equal(post.status, 'publish');
  assert.equal(post.acf.linked_university, university.id, 'Linked University = the university page\'s WordPress ID');
  assert.ok(!published.skipped.some(s => /linked_university/.test(s)));
});

test('a Specialization published after both is linked to its university and its course', async () => {
  const { post, published } = await fullCycle('specialization', { spec_name: SPEC, university_name: UNIVERSITY, linked_university: UNIVERSITY, linked_course: COURSE, emi_amount: 'INR 5,000 /-' });
  const university = [...posts.values()].find(p => p.type === 'university');
  const course = [...posts.values()].find(p => p.type === 'course');
  assert.equal(post.status, 'publish');
  assert.equal(post.acf.linked_university, university.id);
  assert.equal(post.acf.linked_course, course.id);
  assert.equal(post.acf.specialization_lowest_emi_strats_from, '5,000');
  assert.ok(!published.skipped.some(s => /linked_/.test(s)), published.skipped.join(' | '));
  assert.equal([...posts.values()].filter(p => p.status === 'publish').length, 3, 'three pages, no duplicates');
});
