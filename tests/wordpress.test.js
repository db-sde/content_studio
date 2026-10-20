// Publishing to WordPress, against a stand-in WordPress on this machine that enforces the real
// site's rules: its actual ACF field definitions (tests/fixtures/wp-*-acf-schema.json, read from
// the site), "Invalid parameter(s): acf" for any value of the wrong shape or any column a repeater
// doesn't have, and "acf" sent with a create being dropped. The first real publishes failed on
// each of these in turn (plus a stripped login and a Cloudflare challenge) - this pins that a fully
// filled draft gets through, that what can't go is reported, and that every failure names its fix.
import './helpers/env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import express from 'express';
import { config } from '../server/config.js';
import { publishDraftToWordPress, __clearWordPressCachesForTests, __setChallengeRetryDelayForTests } from '../server/integrations/wordpressClient.js';
import { mapToWordPress, conformToSchema, htmlToRows, syllabusToYears, pickLinkedPost } from '../server/integrations/wordpressAcf.js';
import { transformToACF } from '../src/config/schemas.js';
import { startTestApp, completeSpecializationFormData } from './helpers/testApp.js';

const SCHEMAS = Object.fromEntries(['specialization', 'course', 'university'].map(t => [t, JSON.parse(fs.readFileSync(new URL(`./fixtures/wp-${t}-acf-schema.json`, import.meta.url)))]));

// WordPress's type rules (rest_validate_value_from_schema) as the site applies them to "acf".
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

let server, wp;
const requests = [];

function resetWordPress() {
  wp = { posts: new Map(), nextId: 900, linkable: { university: [], course: [] }, failWith: null, failFill: null, delayMs: 0, challengeOnce: new Set() };
}

before(async () => {
  resetWordPress();
  __setChallengeRetryDelayForTests(10);
  const app = express();
  app.use(express.json());
  app.use((req, res) => {
    requests.push({ method: req.method, path: req.path, query: req.query, headers: req.headers, body: req.body });
    setTimeout(() => {
      if (res.destroyed) return;
      // Challenge the first request of each listed method, then let that method through.
      if (wp.challengeOnce.delete(req.method)) {
        return res.status(403).set({ server: 'cloudflare', 'cf-ray': 'a4da137a3d4a5aae-CMH', 'cf-mitigated': 'challenge' }).type('html').send('<!DOCTYPE html><title>Just a moment...</title>');
      }
      if (wp.failWith) {
        const [status, body, headers = {}] = wp.failWith;
        res.status(status).set(headers);
        return typeof body === 'string' ? res.type('html').send(body) : res.json(body);
      }
      const m = /^\/wp-json\/wp\/v2\/([a-z-]+)(?:\/(\d+))?$/.exec(req.path);
      const schema = m && SCHEMAS[m[1]];
      if (!schema) return res.status(404).json({ code: 'rest_no_route', message: 'No route was found matching the URL and request method.' });
      const [, type, id] = m;
      if (req.method === 'OPTIONS') return res.json({ schema: { properties: { acf: schema } } });
      if (req.method === 'GET') return res.json(wp.linkable[type] || []);
      if (req.method === 'POST' && !id) {
        // The real site's quirk: "acf" sent with a create is silently dropped.
        const post = { id: wp.nextId++, status: req.body.status, title: req.body.title, acf: {}, type };
        wp.posts.set(post.id, post);
        return res.status(201).json({ id: post.id, status: post.status, link: `https://site.test/?p=${post.id}` });
      }
      if (req.method === 'PUT' && id) {
        const post = wp.posts.get(Number(id));
        if (!post) return res.status(404).json({ code: 'rest_post_invalid_id', message: 'Invalid post ID.' });
        if (wp.failFill) return res.status(400).json(wp.failFill);
        for (const [k, v] of Object.entries(req.body.acf || {})) {
          const problem = schema.properties[k] ? wpInvalid(v, schema.properties[k], `acf[${k}]`) : `acf[${k}] is not a valid property of Object.`;
          if (problem) return res.status(400).json({ code: 'rest_invalid_param', message: 'Invalid parameter(s): acf', data: { status: 400, params: { acf: problem } } });
        }
        Object.assign(post, { status: req.body.status, title: req.body.title, acf: req.body.acf });
        return res.json({ id: post.id, status: post.status, link: `https://site.test/${type}/${post.id}` });
      }
      res.status(405).json({ code: 'rest_no_route', message: 'Method not allowed.' });
    }, wp.delayMs);
  });
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  Object.assign(config.wordpress, { siteUrl: `http://127.0.0.1:${server.address().port}`, appUser: 'editor', appPassword: 'abcd efgh ijkl mnop qrst uvwx' });
});

beforeEach(() => {
  resetWordPress();
  requests.length = 0;
  __clearWordPressCachesForTests();
});

after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  assert.deepEqual(globalThis.__blockedRequests, [], 'a test tried to reach an outside service');
});

// A specialization the way Content Studio stores it, every kind of field filled.
function fullSpecialization() {
  return completeSpecializationFormData({
    spec_name: 'Online MCA in Data Science',
    university_name: 'Sikkim Manipal University Online',
    linked_university: 'Sikkim Manipal University Online',
    linked_course: 'Online MCA',
    highlights: [{ highlight_title: 'Live classes', highlight_description: 'Weekend sessions' }],
    eligibility_content: '<p>Candidates must meet the following:</p><ul><li><p><strong>Qualification:</strong> A bachelor\'s degree (10+2+3)</p></li><li><p>Minimum 50% aggregate marks</p></li></ul>',
    fee_plans: [{ plan_name: 'Semester Plan', plan_amount: 'INR 24,750', plan_total: 'INR 99,000' }, { plan_name: 'One-time payment', plan_amount: 'INR 94,000', plan_total: '' }],
    syllabus_subjects: [{ semester: 'Semester I', subjects: 'Python\nStatistics' }, { semester: 'Semester II', subjects: 'Machine Learning' }, { semester: 'Semester III', subjects: 'Big Data' }],
    exam_details: [{ detail_label: 'Mode', detail_value: 'Online proctored' }],
    exam_content: '<p>Exams are held online.</p>',
    admission_steps_list: [{ step_title: 'Apply', step_description: 'Fill the form' }],
    placement_stats: [{ stat_label: 'Hiring partners', stat_value: '300+' }],
    certificate_heading: 'Your Certificate'
  });
}

test("default post types are the site's own REST bases", () => {
  assert.deepEqual(config.wordpress.postTypeSlugs, { university: 'university', course: 'course', specialization: 'specialization' });
});

test("a fully filled specialization passes the site's own field rules: created as a draft, then filled and made live", async () => {
  wp.linkable.university = [{ id: 11, title: { rendered: 'Sikkim Manipal University Online' } }];
  // Two courses called "Online MCA": the one linked to this university is chosen.
  wp.linkable.course = [
    { id: 21, title: { rendered: 'Online MCA' }, acf: { linked_university: [99] } },
    { id: 22, title: { rendered: 'Online MCA' }, acf: { linked_university: [11] } }
  ];
  const acfFields = { ...transformToACF(await fullSpecialization(), 'specialization'), hero_image: 'https://res.cloudinary.com/x/hero.webp' };

  const result = await publishDraftToWordPress({ pageType: 'specialization', title: 'Online MCA in Data Science', acfFields });

  assert.equal(result.status, 'publish');
  const create = requests.find(r => r.method === 'POST');
  assert.deepEqual(create.body, { title: 'Online MCA in Data Science', status: 'draft' }, 'created as a draft, no acf (the site drops it there)');
  const fill = requests.find(r => r.method === 'PUT');
  assert.equal(fill.path, `/wp-json/wp/v2/specialization/${result.id}`);
  assert.equal(fill.body.status, 'publish');

  const stored = wp.posts.get(result.id);
  assert.equal(stored.status, 'publish');
  assert.equal(stored.acf.linked_university, 11);
  assert.equal(stored.acf.linked_course, 22);
  assert.deepEqual(stored.acf.eligibility_content, [
    { eligibility_title: 'Qualification', eligibility_description: 'A bachelor\'s degree (10+2+3)' },
    { eligibility_title: '', eligibility_description: 'Minimum 50% aggregate marks' }
  ]);
  assert.equal(stored.acf.highlights_content, '<ul><li><strong>Live classes</strong>: Weekend sessions</li></ul>');
  assert.equal(stored.acf.examination_content, '<p>Exams are held online.</p>');
  assert.deepEqual(stored.acf.examination_process, [{ exam_process_title: 'Mode', exam_process_description: 'Online proctored' }]);
  assert.deepEqual(stored.acf.academic_years.map(y => [y.year_title, y.semesters.map(s => s.semester_title)]), [['Year 1', ['Semester I', 'Semester II']], ['Year 2', ['Semester III']]]);
  assert.deepEqual(stored.acf.fee_plans, [{ plan_name: 'Semester Plan', plan_amount: 'INR 24,750' }, { plan_name: 'One-time payment', plan_amount: 'INR 94,000' }]);
  assert.equal(stored.acf.semester_plan_value, 'INR 24,750');
  assert.equal(stored.acf['one-time_payment_value'], 'INR 94,000');

  // What has nowhere to go is reported, not sent.
  const skipped = result.skipped.join(' | ');
  for (const k of ['hero_image', 'admission_steps_list', 'placement_stats', 'certificate_heading']) assert.match(skipped, new RegExp(k));
  for (const k of ['highlights', 'exam_details', 'syllabus_subjects', 'admission_steps_list', 'placement_stats', 'certificate_heading', 'hero_image']) {
    assert.ok(!(k in stored.acf), `${k} must not be sent`);
  }
});

test('an unknown Linked University is left out with a note - never sent blank over a link set in WordPress', async () => {
  const acfFields = transformToACF(await fullSpecialization(), 'specialization');
  const result = await publishDraftToWordPress({ pageType: 'specialization', title: 'X', acfFields });
  const stored = wp.posts.get(result.id);
  assert.ok(!('linked_university' in stored.acf) && !('linked_course' in stored.acf));
  assert.match(result.skipped.join(' | '), /linked_university \("Sikkim Manipal University Online" isn't a university page on WordPress yet/);
});

test("course and university fields map onto the site's own (and pass its field rules)", () => {
  const course = mapToWordPress({
    program_name: 'Online MCA', linked_university: '',
    highlights: [{ highlight_title: 'A', highlight_description: 'B' }],
    eligibility_content: '<ul><li>Graduation: any stream</li></ul>',
    syllabus_subjects: [{ semester: 'Year 1', subjects: '<ul><li>C</li></ul>' }],
    fee_plans: [{ plan_name: 'Annual', plan_amount: '50,000', plan_total: '1,00,000' }],
    admission_steps_list: [{ step_title: 'x', step_description: 'y' }]
  }, 'course');
  const c = conformToSchema(course.fields, SCHEMAS.course);
  assert.equal(c.fields.highlights_section_content, '<ul><li><strong>A</strong>: B</li></ul>');
  assert.deepEqual(c.fields.highlights, [{ highlight_title: 'A', highlight_description: 'B' }]);
  assert.deepEqual(c.fields.eligibility_content, [{ eligibility_title: 'Graduation', eligibility_description: 'any stream' }]);
  assert.deepEqual(c.fields.course_academic_years, [{ course_year_title: 'Year 1', course_semesters: [{ course_semester_title: 'Year 1', course_semester_subjects: '<ul><li>C</li></ul>' }] }]);
  assert.equal(c.fields.annual_plan_amount, '50,000');
  assert.match(c.skipped.join(' | '), /admission_steps_list \(no such field in WordPress\)/);
  for (const [k, v] of Object.entries(c.fields)) assert.equal(wpInvalid(v, SCHEMAS.course.properties[k], k), null);

  const uni = mapToWordPress({
    university_name: 'NMIMS', about_additional_notes: 'internal only',
    facts: [{ fact_title: 'Founded', fact_description: '1981' }],
    exam_details: [{ detail_label: 'Mode', detail_value: 'Online' }],
    placement_stats: [{ stat_label: 'Partners', stat_value: '500+' }],
    emi_partners: [{ bank_name: 'HDFC', emi_terms: '0%' }, { bank_name: 'ICICI', emi_terms: '' }],
    faculty_members: [{ member_name: 'Dr. A', member_program: 'MBA', member_designation: 'Professor', member_qualification: 'PhD' }]
  }, 'university');
  const u = conformToSchema(uni.fields, SCHEMAS.university);
  assert.equal(u.fields.facts_content, '<ul><li><strong>Founded</strong>: 1981</li></ul>');
  assert.deepEqual(u.fields.examination_cards, [{ exam_card_title: 'Mode', exam_card_description: 'Online' }]);
  assert.equal(u.fields.placement_highlights, '<ul><li><strong>Partners</strong>: 500+</li></ul>');
  assert.equal(u.fields.partner_banks_names, 'HDFC, ICICI');
  assert.deepEqual(u.fields.faculty_members, [{ member_name: 'Dr. A', member_designation: 'Professor, MBA, PhD' }]);
  assert.ok(!('about_additional_notes' in u.fields) && !u.skipped.some(s => /additional_notes/.test(s)), 'AI-only notes are never published, and not reported as missing');
  for (const [k, v] of Object.entries(u.fields)) assert.equal(wpInvalid(v, SCHEMAS.university.properties[k], k), null);
});

test("the schema check leaves out what still doesn't fit instead of breaking the publish", () => {
  const { fields, skipped } = conformToSchema({
    spec_name: 'X',
    made_up_field: 'y',
    faqs: [{ question: 'Q', answer: 'A', extra_column: 'z' }, { question: '', answer: '' }],
    eligibility_content: 'plain text where rows are expected',
    linked_university: 'a name'
  }, SCHEMAS.specialization);
  assert.deepEqual(fields.faqs, [{ question: 'Q', answer: 'A' }], 'unknown column dropped, empty row dropped');
  assert.ok(!('made_up_field' in fields) && !('eligibility_content' in fields) && !('linked_university' in fields));
  assert.match(skipped.join(' | '), /made_up_field.*faqs\[0\]\.extra_column.*eligibility_content.*linked_university/);
});

test('eligibility rich text, syllabus and linked-post helpers', () => {
  assert.deepEqual(htmlToRows('<p>Graduates with 50% marks.</p>', 't', 'd'), [{ t: '', d: 'Graduates with 50% marks.' }]);
  assert.deepEqual(htmlToRows('<ul><li><b>Age</b> - no limit</li></ul>', 't', 'd'), [{ t: 'Age', d: 'no limit' }]);
  assert.deepEqual(htmlToRows('', 't', 'd'), []);
  const years = syllabusToYears([{ semester: 'Semester 4', subjects: 'D' }, { semester: 'Semester 1', subjects: 'A' }, { semester: 'Semester 2', subjects: '' }], { yearTitle: 'y', semesters: 's', semesterTitle: 'st', semesterSubjects: 'ss' });
  assert.deepEqual(years, [{ y: 'Year 1', s: [{ st: 'Semester 1', ss: 'A' }] }, { y: 'Year 2', s: [{ st: 'Semester 4', ss: 'D' }] }]);
  assert.equal(pickLinkedPost([{ id: 1, title: { rendered: 'NMIMS &amp; Co' } }], 'nmims & co'), 1);
  assert.equal(pickLinkedPost([{ id: 1, title: { rendered: 'Online MBA' } }, { id: 2, title: { rendered: 'Online MBA' } }], 'Online MBA'), null, 'ambiguous');
});

test('re-publishing updates the same page in place; a page deleted in WordPress is recreated', async () => {
  wp.posts.set(42, { id: 42, status: 'publish', acf: {}, type: 'specialization' });
  const again = await publishDraftToWordPress({ pageType: 'specialization', title: 'Online MBA', acfFields: { spec_name: 'Online MBA' }, existingPostId: 42 });
  assert.equal(again.id, 42);
  assert.deepEqual(requests.filter(r => r.method !== 'OPTIONS').map(r => `${r.method} ${r.path}`), ['PUT /wp-json/wp/v2/specialization/42']);

  requests.length = 0;
  const recreated = await publishDraftToWordPress({ pageType: 'specialization', title: 'Online MBA', acfFields: { spec_name: 'Online MBA' }, existingPostId: 7 });
  assert.notEqual(recreated.id, 7);
  assert.deepEqual(requests.filter(r => r.method !== 'OPTIONS').map(r => r.method), ['PUT', 'POST', 'PUT']);
});

test("if filling a new page fails, the error says why and carries the draft page's ID for the retry", async () => {
  wp.failFill = { code: 'rest_invalid_param', message: 'Invalid parameter(s): acf', data: { status: 400, params: { acf: 'acf[seo_title] is not of type string,null.' } } };
  await assert.rejects(
    () => publishDraftToWordPress({ pageType: 'specialization', title: 'X', acfFields: { spec_name: 'X' } }),
    (e) => e.wordpressPostId === 900 && /rejected some field values - acf: acf\[seo_title\] is not of type string,null.*ID 900, but not made live/.test(e.message)
  );
  assert.equal(wp.posts.get(900).status, 'draft', 'nothing went live');
});

// Global fetch adds browser-style headers on its own (sec-fetch-mode: cors, accept-language: *)
// that, next to a non-browser User-Agent, can trip Cloudflare's bot scoring. Only these go out.
test('every request carries only the headers we set, none of the browser-style ones fetch adds', async () => {
  await publishDraftToWordPress({ pageType: 'specialization', title: 'Online MBA', acfFields: { about_content: '<p>x</p>' } });
  assert.ok(requests.length >= 3);
  for (const { method, headers, body } of requests) {
    assert.equal(headers['sec-fetch-mode'], undefined);
    assert.equal(headers['accept-language'], undefined);
    const expected = ['accept', 'authorization', 'connection', 'host', 'user-agent', ...(method === 'PUT' || method === 'POST' ? ['content-length', 'content-type'] : [])];
    assert.deepEqual(Object.keys(headers).sort(), expected.sort(), method);
    assert.equal(headers.authorization, 'Basic ' + Buffer.from('editor:abcd efgh ijkl mnop qrst uvwx').toString('base64'));
    assert.match(headers['user-agent'], /DegreeBaba-Content-Studio/);
    if (headers['content-length']) assert.equal(Number(headers['content-length']), Buffer.byteLength(JSON.stringify(body)));
  }
});

test('a WordPress that does not answer in time gives the 504 "nothing was published" error', async () => {
  const saved = config.limits.wordpressTimeoutMs;
  config.limits.wordpressTimeoutMs = 150;
  wp.delayMs = 2000;
  try {
    await assert.rejects(() => publishDraftToWordPress({ pageType: 'specialization', title: 'X', acfFields: {} }),
      (e) => e.status === 504 && /didn't respond within 1s - nothing was published/.test(e.message));
  } finally {
    config.limits.wordpressTimeoutMs = saved;
  }
});

test('a Cloudflare challenge is retried once: a request let through on the second try publishes', async () => {
  wp.challengeOnce = new Set(['OPTIONS', 'POST']); // the schema check and the create: each challenged once, then allowed
  const result = await publishDraftToWordPress({ pageType: 'specialization', title: 'X', acfFields: { spec_name: 'X' } });
  assert.equal(result.status, 'publish');
  assert.deepEqual(requests.map(r => r.method), ['OPTIONS', 'OPTIONS', 'POST', 'POST', 'PUT']);
  assert.equal(wp.posts.size, 1, 'the challenged create never reached WordPress, so no duplicate');
});

test('a block that persists is tried exactly twice, then reported with its ray ID', async () => {
  wp.failWith = [403, '<!DOCTYPE html><title>Just a moment...</title>', { server: 'cloudflare', 'cf-ray': 'a4da137a3d4a5aae-CMH', 'cf-mitigated': 'challenge' }];
  await assert.rejects(() => publishDraftToWordPress({ pageType: 'specialization', title: 'X', acfFields: { spec_name: 'X' } }), /Cloudflare challenge.*ray ID: a4da137a3d4a5aae-CMH/);
  assert.equal(requests.filter(r => r.method === 'POST').length, 2);
  assert.equal(wp.posts.size, 0);
});

test('the test safety net also stops https.request to an outside host', () => {
  const countBefore = globalThis.__blockedRequests.length;
  assert.throws(() => https.request('https://degreebaba.demo-nexevo.in/wp-json/'), /Blocked outbound request in tests/);
  assert.equal(globalThis.__blockedRequests.length, countBefore + 1);
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
  for (const [failWith, expected] of cases) {
    __clearWordPressCachesForTests();
    wp.failWith = failWith;
    await assert.rejects(() => publishDraftToWordPress({ pageType: 'specialization', title: 'Online MBA', acfFields: { about_content: '<p>x</p>' } }), expected);
  }
});

test('Publish to WordPress (route): what had no place is shown; a half-made page is remembered for the retry', async () => {
  const t = await startTestApp();
  try {
    const intern = await t.createUser('Intern W', 'intern');
    const admin = await t.createUser('Admin W', 'admin');
    const { body } = await t.api(intern, 'POST', '/api/drafts', { pageType: 'specialization' });
    await t.api(intern, 'PUT', `/api/drafts/${body.draft.id}`, { formData: await fullSpecialization() });
    await t.query("UPDATE drafts SET status = 'approved' WHERE id = $1", [body.draft.id]);

    wp.failFill = { code: 'rest_invalid_param', message: 'Invalid parameter(s): acf', data: { params: { acf: 'acf[x] bad.' } } };
    const failed = await t.api(admin, 'POST', `/api/drafts/${body.draft.id}/publish-to-wordpress`);
    assert.equal(failed.status, 502, 'a WordPress failure, not ours - and never its own 401, which would look like our session expiring');
    assert.match(failed.body.error, /rejected some field values/);
    const { rows } = await t.query('SELECT wordpress_post_id, wordpress_url FROM drafts WHERE id = $1', [body.draft.id]);
    assert.deepEqual(rows[0], { wordpress_post_id: 900, wordpress_url: null });

    wp.failFill = null;
    const ok = await t.api(admin, 'POST', `/api/drafts/${body.draft.id}/publish-to-wordpress`);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.draft.wordpress_post_id, 900, 'the retry filled the same page');
    assert.equal(wp.posts.size, 1, 'no duplicate page');
    assert.match(ok.body.skipped.join(' | '), /placement_stats/);
  } finally {
    await t.close();
  }
});
