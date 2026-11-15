// Fields an Admin adds on the Field Settings page: picked from the WordPress fields nothing fills
// yet, shown on every draft (old ones too), checked like any other field, sent to WordPress only
// when filled, and removed by archiving. WordPress here is a stand-in on this machine that serves
// the staging site's own field definitions (tests/fixtures).
import './helpers/env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { startTestApp } from './helpers/testApp.js';
import { config } from '../server/config.js';
import { schemas, transformToACF, validateState } from '../src/config/schemas.js';
import { withCustomFields, buildEffectiveSchemas, findSchemaField, humanizeFieldKey } from '../src/config/fieldSettings.js';
import { classifyWordPressField } from '../server/integrations/wordpressAcf.js';
import { __clearWordPressCachesForTests } from '../server/integrations/wordpressClient.js';

const FIXTURES = Object.fromEntries(['specialization', 'course', 'university'].map(t => [t, JSON.parse(fs.readFileSync(new URL(`./fixtures/wp-${t}-acf-schema.json`, import.meta.url)))]));
// about_info: a specialization field nothing in the app fills (most others are built in now).
const cert = { pageType: 'specialization', fieldKey: 'about_info', label: 'About Info', type: 'TEXT_INPUT', sectionId: 'fee', afterFieldKey: 'validity' };

// ---------------------------------------------------------------- rules
test('an added field sits where the admin placed it; a removed one is gone', () => {
  const keys = (s) => s.specialization.sections.flatMap(x => x.fields).map(f => f.key);
  const placed = keys(withCustomFields([cert]));
  assert.equal(placed[placed.indexOf('validity') + 1], 'about_info');
  const atEnd = withCustomFields([{ ...cert, afterFieldKey: null }]).specialization.sections.find(s => s.id === 'fee').fields;
  assert.equal(atEnd[atEnd.length - 1].key, 'about_info');
  const lostSection = withCustomFields([{ ...cert, sectionId: 'gone' }]).specialization.sections;
  assert.equal(lostSection[lostSection.length - 1].fields.at(-1).key, 'about_info', 'a section that no longer exists: end of the page');
  assert.ok(!keys(withCustomFields([{ ...cert, archivedAt: '2026-11-01' }])).includes('about_info'));
  assert.equal(schemas.specialization.sections.flatMap(s => s.fields).some(f => f.key === 'about_info'), false, 'the built-in schemas are untouched');
});

test('an added field is optional and filled by hand until the admin says otherwise', () => {
  const plain = findSchemaField(buildEffectiveSchemas([], [cert]).specialization, 'about_info');
  assert.equal(plain.required, false);
  assert.equal(plain.aiAssist, undefined);
  assert.equal(plain.internWritable, true);
  const set = findSchemaField(buildEffectiveSchemas([{ pageType: 'specialization', fieldKey: 'about_info', required: true, aiGenerated: true }], [cert]).specialization, 'about_info');
  assert.equal(set.required, true);
  assert.match(set.aiAssist.instructions, /"About Info"/);
  assert.ok(validateState({}, 'specialization', { schema: buildEffectiveSchemas([{ pageType: 'specialization', fieldKey: 'about_info', required: true }], [cert]).specialization }).invalidFields.about_info);
});

test('an added field is exported only when it has something in it - a blank never reaches WordPress', () => {
  const schema = withCustomFields([cert, { pageType: 'specialization', fieldKey: 'syllabus_description', label: 'Syllabus Description', type: 'RICH_TEXT', sectionId: 'syllabus' }]).specialization;
  const empty = transformToACF({ about_info: '  ', syllabus_description: '<p></p>', duration: '' }, 'specialization', schema);
  assert.ok(!('about_info' in empty));
  assert.ok(!('syllabus_description' in empty));
  assert.equal(empty.duration, '', 'built-in fields export as before');
  assert.equal(transformToACF({ about_info: 'Lifetime' }, 'specialization', schema).about_info, 'Lifetime');
});

test('which WordPress fields an admin can add a field for', () => {
  assert.deepEqual(classifyWordPressField({ type: ['string', 'null'] }), { kind: 'text' });
  assert.equal(classifyWordPressField({ type: ['string', 'null'], description: 'A `Y-m-d H:i:s` formatted date string.' }).kind, 'unsupported');
  assert.match(classifyWordPressField({ type: ['integer', 'null'] }).reason, /image, file or page link/);
  assert.deepEqual(classifyWordPressField({ type: ['array', 'null'], items: { type: 'object', properties: { name: { type: ['string', 'null'] }, logo: { type: ['string'] } } } }), { kind: 'list', columns: ['name', 'logo'] });
  assert.equal(classifyWordPressField({ type: ['array', 'null'], items: { type: 'object', properties: { logo: { type: ['integer'] } } } }).kind, 'unsupported');
  assert.equal(humanizeFieldKey('nirf_rank_course'), 'NIRF Rank Course');
});

// ---------------------------------------------------------------- through the routes
let t, intern, senior, admin, server;
const posts = new Map();
let nextId = 900;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res) => {
    const m = /^\/wp-json\/wp\/v2\/([a-z-]+)(?:\/(\d+))?$/.exec(req.path);
    const schema = m && FIXTURES[m[1]];
    if (!schema) return res.status(404).json({ code: 'rest_no_route', message: 'No route' });
    const [, type, id] = m;
    if (req.method === 'OPTIONS') return res.json({ schema: { properties: { acf: schema } } });
    if (req.method === 'GET' && id) return res.json({ id: Number(id), status: posts.get(Number(id))?.status || 'publish' });
    if (req.method === 'GET') return res.json([]);
    if (req.method === 'POST') {
      const post = { id: nextId++, type, status: req.body.status, acf: {} };
      posts.set(post.id, post);
      return res.status(201).json({ id: post.id, status: post.status, link: `https://site.test/?p=${post.id}` });
    }
    if (req.method === 'PUT') {
      const post = posts.get(Number(id));
      const unknown = Object.keys(req.body.acf || {}).find(k => !schema.properties[k]);
      if (unknown) return res.status(400).json({ code: 'rest_invalid_param', message: 'Invalid parameter(s): acf' });
      Object.assign(post, { status: req.body.status, acf: req.body.acf });
      return res.json({ id: post.id, status: post.status, link: `https://site.test/${type}/${post.id}` });
    }
    res.status(405).end();
  });
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  Object.assign(config.wordpress, { siteUrl: `http://127.0.0.1:${server.address().port}`, appUser: 'editor', appPassword: 'abcd efgh ijkl mnop qrst uvwx' });
  __clearWordPressCachesForTests();

  t = await startTestApp();
  intern = await t.createUser('Intern', 'intern');
  senior = await t.createUser('Senior', 'senior');
  admin = await t.createUser('Admin', 'admin');
});
beforeEach(async () => {
  await t.query('DELETE FROM custom_fields');
  await t.query('DELETE FROM field_settings');
});
after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  assert.deepEqual(globalThis.__blockedRequests, [], 'a test tried to reach an outside service');
  await t.close();
});

const add = (user, pageType, body) => t.api(user, 'POST', `/api/field-settings/${pageType}/custom-fields`, body);
const addCert = (extra = {}) => add(admin, 'specialization', { fieldKey: 'about_info', label: 'About Info', type: 'TEXT_INPUT', sectionId: 'fee', afterFieldKey: 'validity', ...extra });

async function courseDraft(status, formData) {
  const { body } = await t.api(intern, 'POST', '/api/drafts', { pageType: 'specialization' });
  await t.query('UPDATE drafts SET form_data_json = $1, status = $2 WHERE id = $3', [JSON.stringify({ spec_name: 'Online MBA in Finance', university_name: 'Test University Online', ...formData }), status, body.draft.id]);
  return body.draft.id;
}

test('the add list: WordPress fields nothing fills yet, and the ones that need a developer', async () => {
  const r = await t.api(admin, 'GET', '/api/field-settings/wordpress');
  assert.equal(r.status, 200);
  const spec = r.body.available.specialization;
  const addable = spec.addable.map(a => a.key);
  for (const k of ['about_info', 'syllabus_description']) assert.ok(addable.includes(k), k);
  for (const k of ['program_validity', 'semester_plan_value', 'highlights_content', 'about_content', 'best_price_specialization', 'specialization_hero_description', 'partner_banks_specialization']) {
    assert.ok(!addable.includes(k), `${k} is already filled`);
  }
  assert.ok(spec.unsupported.some(u => u.key === 'certificate_image_specialization'));
  assert.ok(r.body.available.course.unsupported.some(u => u.key === 'course_intake' && u.reason === 'a date'));
  assert.deepEqual(r.body.available.course.addable, [], 'every text field on course pages is filled by the app now');
});

test('only an admin adds fields, and only for a WordPress field the app can fill and nothing fills yet', async () => {
  assert.equal((await add(intern, 'specialization', { fieldKey: 'about_info', sectionId: 'fee' })).status, 403);
  assert.equal((await add(senior, 'specialization', { fieldKey: 'about_info', sectionId: 'fee' })).status, 403);
  const cases = [
    [{ fieldKey: 'no_such_field', sectionId: 'fee' }, /WordPress has no field called no_such_field/],
    [{ fieldKey: 'certificate_image_specialization', sectionId: 'fee' }, /image, file or page link/],
    [{ fieldKey: 'program_validity', sectionId: 'fee' }, /already filled by a field in the app/],
    [{ fieldKey: 'about_info', sectionId: 'nowhere' }, /Choose a section/],
    [{ fieldKey: 'about_info', sectionId: 'fee', afterFieldKey: 'about_content' }, /isn't in that section/],
    [{ fieldKey: 'about_info', sectionId: 'fee', type: 'DROPDOWN' }, /single line, paragraph or formatted/],
    [{ fieldKey: 'about_info', sectionId: 'fee', label: '   ' }, /needs a name/]
  ];
  for (const [body, message] of cases) {
    const r = await add(admin, 'specialization', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.body.error, message);
  }
});

test('an added field appears on old drafts at once, and interns can fill it', async () => {
  const old = await courseDraft('intern_editing', {});
  const r = await addCert({ settings: { required: false } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.customFields.map(c => [c.fieldKey, c.label, c.type, c.sectionId, c.afterFieldKey, c.createdByName]), [['about_info', 'About Info', 'TEXT_INPUT', 'fee', 'validity', 'Admin']]);
  assert.equal((await addCert()).status, 409, 'only once');

  const save = await t.api(intern, 'PUT', `/api/drafts/${old}`, { formData: { about_info: 'Lifetime' } });
  assert.equal(save.body.skippedKeys, undefined);
  assert.equal(save.body.draft.form_data.about_info, 'Lifetime');

  const tags = await t.api(intern, 'GET', '/api/field-settings/wordpress');
  assert.deepEqual(tags.body.targets.specialization.about_info, { kind: 'sent', wpKeys: ['about_info'], missing: [] });
  assert.ok(!tags.body.available.specialization.addable.some(a => a.key === 'about_info'), 'no longer offered');
});

test('making an added field mandatory: the admin sees which drafts lack it, and approval waits for it', async () => {
  await addCert();
  const waiting = await courseDraft('admin_review', {});
  await courseDraft('intern_editing', { about_info: 'Lifetime' });
  const impact = await t.api(admin, 'GET', '/api/field-settings/specialization/about_info/impact');
  assert.equal(impact.body.missingByStatus.admin_review >= 1, true);
  assert.equal(impact.body.missingByStatus.intern_editing || 0, 0, 'the filled draft isn\'t counted');
  assert.equal((await t.api(senior, 'GET', '/api/field-settings/specialization/about_info/impact')).status, 403);

  await t.api(admin, 'PUT', '/api/field-settings/specialization/about_info', { required: true });
  const blocked = await t.api(admin, 'PATCH', `/api/drafts/${waiting}/status`, { action: 'approve' });
  assert.equal(blocked.status, 409);
});

test('publishing sends an added field only when it has something in it', async () => {
  await addCert();
  const blank = await courseDraft('approved', { about_info: '' });
  let r = await t.api(admin, 'POST', `/api/drafts/${blank}/publish-to-wordpress`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  let post = posts.get(r.body.draft.wordpress_post_id);
  assert.ok(!('about_info' in post.acf), 'a blank is never sent - it would wipe what was typed into WordPress');

  const filled = await courseDraft('approved', { about_info: 'Lifetime' });
  r = await t.api(admin, 'POST', `/api/drafts/${filled}/publish-to-wordpress`);
  post = posts.get(r.body.draft.wordpress_post_id);
  assert.equal(post.acf.about_info, 'Lifetime');
});

test('removing archives: off every form, not sent, the text kept, and it can come back', async () => {
  await addCert();
  const id = await courseDraft('approved', { about_info: 'Lifetime' });
  const removed = await t.api(admin, 'POST', '/api/field-settings/specialization/custom-fields/about_info/archive');
  assert.equal(removed.status, 200);
  assert.ok(removed.body.customFields[0].archivedAt);

  const r = await t.api(admin, 'POST', `/api/drafts/${id}/publish-to-wordpress`);
  assert.ok(!('about_info' in posts.get(r.body.draft.wordpress_post_id).acf), 'not sent once removed');
  assert.equal((await t.api(admin, 'GET', `/api/drafts/${id}`)).body.draft.form_data.about_info, 'Lifetime', 'what was typed is kept');
  assert.equal((await t.api(admin, 'PUT', '/api/field-settings/specialization/about_info', { required: true })).status, 400, 'a removed field has no settings to change');
  assert.match((await addCert()).body.error, /restore it instead/);

  const back = await t.api(admin, 'POST', '/api/field-settings/specialization/custom-fields/about_info/restore');
  assert.equal(back.status, 200);
  assert.equal(back.body.customFields[0].archivedAt, null);
});

test('an added field\'s name, kind and place can be changed; a list stays a list', async () => {
  await addCert();
  const r = await t.api(admin, 'PATCH', '/api/field-settings/specialization/custom-fields/about_info', { label: 'About This Program', type: 'TEXTAREA', sectionId: 'certificate', afterFieldKey: null });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.customFields[0].label, r.body.customFields[0].type, r.body.customFields[0].sectionId], ['About This Program', 'TEXTAREA', 'certificate']);
  assert.equal((await t.api(admin, 'PATCH', '/api/field-settings/specialization/custom-fields/about_info', { type: 'REPEATER' })).status, 400);
  assert.equal((await t.api(intern, 'PATCH', '/api/field-settings/specialization/custom-fields/about_info', { label: 'x' })).status, 403);
});

test('with WordPress not answering, nothing can be added - and the message says why', async () => {
  const saved = config.wordpress.siteUrl;
  config.wordpress.siteUrl = '';
  __clearWordPressCachesForTests();
  try {
    const r = await addCert();
    assert.equal(r.status, 503);
    assert.match(r.body.error, /Couldn't read the field list from WordPress/);
    assert.equal((await t.api(admin, 'GET', '/api/field-settings/wordpress')).body.available.course, null);
  } finally {
    config.wordpress.siteUrl = saved;
  }
});
