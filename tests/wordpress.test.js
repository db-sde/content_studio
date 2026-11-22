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
import { publishDraftToWordPress, __clearWordPressCachesForTests, __setChallengeRetryDelayForTests, degreeOf } from '../server/integrations/wordpressClient.js';
import { mapToWordPress, conformToSchema, htmlToRows, syllabusToYears, pickLinkedPost, emiFigure, partnersToHtmlList, pageTitle, yearsOf } from '../server/integrations/wordpressAcf.js';
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
  // taxonomies: null = a site without the institution/program tags; { institution: [...], program: [...] } = with them.
  wp = { posts: new Map(), nextId: 900, linkable: { university: [], course: [] }, failWith: null, failFill: null, delayMs: 0, challengeOnce: new Set(), taxonomies: null };
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
      const terms = m && wp.taxonomies?.[m[1]];
      if (terms) {
        if (req.method === 'GET') return res.json(terms.filter(t => t.name.toLowerCase().includes(String(req.query.search || '').toLowerCase())));
        const term = { id: 300 + terms.length, name: req.body.name, slug: req.body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') };
        terms.push(term);
        return res.status(201).json(term);
      }
      const schema = m && SCHEMAS[m[1]];
      if (!schema) return res.status(404).json({ code: 'rest_no_route', message: 'No route was found matching the URL and request method.' });
      const [, type, id] = m;
      if (req.method === 'OPTIONS') {
        const tags = wp.taxonomies && type !== 'university' ? { institution: { type: 'array' }, program: { type: 'array' } } : {};
        return res.json({ schema: { properties: { acf: schema, ...tags } } });
      }
      if (req.method === 'GET' && id) {
        const post = wp.posts.get(Number(id));
        return post ? res.json({ id: post.id, status: post.status }) : res.status(404).json({ code: 'rest_post_invalid_id', message: 'Invalid post ID.' });
      }
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
        Object.assign(post, { status: req.body.status, title: req.body.title, acf: req.body.acf, institution: req.body.institution, program: req.body.program });
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
    hiring_partners: 'IBM, KPMG, Larsen & Toubro, etc.',
    certificate_heading: 'Your Certificate',
    emi_amount: 'INR 6,917 /-'
  });
}

test("default post types are the site's own REST bases", () => {
  // Blog posts are WordPress's own posts; category pages their own type ("categories" is the taxonomy).
  assert.deepEqual(config.wordpress.postTypeSlugs, { university: 'university', course: 'course', specialization: 'specialization', blog: 'posts', category: 'category-page' });
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
  // The theme prints "₹ <EMI> /month" itself, so the amount goes bare - never "₹ INR 6,917 /- /month".
  assert.equal(stored.acf.emi_amount, '6,917');
  assert.equal(stored.acf.specialization_lowest_emi_strats_from, '6,917');

  // What has nowhere to go is reported, not sent.
  const skipped = result.skipped.join(' | ');
  assert.match(skipped, /hero_image/);
  // Placement stats and the admission steps list are facts for the AI; specialization pages no
  // longer have a certificate heading. None of them is "missing" on WordPress.
  assert.doesNotMatch(skipped, /placement_stats|admission_steps_list|certificate_heading/);
  // Filled from what the page already has: Best Fee, the At a Glance duration, the syllabus heading.
  assert.equal(stored.acf.best_price_specialization, undefined, 'Total Fee here is "Test value" - no amount, so no Best Fee');
  assert.equal(stored.acf.duration_specialization, undefined, 'Duration here is "Test value" - no number, so no figure');
  assert.equal(stored.acf.syllabus_section_heading, stored.acf.syllabus_heading);
  // Hiring partners: the company chips, from their own field.
  assert.equal(stored.acf.hiring_partners_specialization, '<ul><li>IBM</li><li>KPMG</li><li>Larsen &amp; Toubro</li></ul>');
  for (const k of ['highlights', 'exam_details', 'syllabus_subjects', 'admission_steps_list', 'placement_stats', 'certificate_heading', 'hero_image']) {
    assert.ok(!(k in stored.acf), `${k} must not be sent`);
  }
});

test('course and specialization pages are tagged with their university; the program tag is left to the team', async () => {
  wp.taxonomies = { institution: [{ id: 45, name: 'Lovely Professional University Online', slug: 'lpu' }], program: [{ id: 42, name: 'MBA', slug: 'mba' }] };
  // A stray space in the name still finds the existing tag.
  const r = await publishDraftToWordPress({ pageType: 'specialization', title: 'T', acfFields: { spec_name: 'Online MBA in Finance', university_name: 'Lovely Professional University Online ' } });
  const post = wp.posts.get(r.id);
  assert.deepEqual(post.institution, [45]);
  assert.equal(post.program, undefined, 'set by hand in WordPress, never by a publish');
  assert.equal(wp.taxonomies.institution.length, 1, 'no duplicate tag');
  assert.deepEqual(r.skipped, []);

  const amity = await publishDraftToWordPress({ pageType: 'course', title: 'X', acfFields: { program_name: 'Online MCom', university_name: 'Amity University Online' } });
  assert.equal(wp.taxonomies.institution.at(-1).name, 'Amity University Online', 'a university without a tag gets one');
  assert.deepEqual(wp.posts.get(amity.id).institution, [wp.taxonomies.institution.at(-1).id]);

  // University pages, and sites without the taxonomy, are left alone.
  const uni = await publishDraftToWordPress({ pageType: 'university', title: 'LPU', acfFields: { university_name: 'Lovely Professional University Online' } });
  assert.equal(wp.posts.get(uni.id).institution, undefined);
  wp.taxonomies = null;
  __clearWordPressCachesForTests();
  const plain = await publishDraftToWordPress({ pageType: 'course', title: 'Y', acfFields: { program_name: 'Online MBA', university_name: 'Z' } });
  assert.equal(wp.posts.get(plain.id).institution, undefined);
  assert.deepEqual(plain.skipped, []);
});

test('the new optional fields are left out while empty - a re-publish never blanks what was typed into WordPress', () => {
  const sent = mapToWordPress({ program_name: 'Online MBA', nirf_rank_course: '', scholarship_facility: ' ', certificate_validity: '', syllabus_section_paragraph: '', duration: '' }, 'course').fields;
  for (const k of ['nirf_rank_course', 'scholarship_facility', 'certificate_validity', 'course_syllabus_description']) assert.ok(!(k in sent), k);
  assert.equal(sent.duration, '', 'long-standing fields still send what the draft holds');
  assert.ok(!('specialization_hero_description' in mapToWordPress({ specialization_hero_description: '' }, 'specialization').fields));
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
    admission_steps_list: [{ step_title: 'x', step_description: 'y' }],
    course_accreditations: [{ course_body_name: 'NAAC', course_body_descriptor: 'A+ Grade', course_body_detail: 'Accredited with A+' }],
    specializations_intro: 'Choose from several specializations.\nEach has its own fee.',
    specialization: [{ specialization_name: 'Data Science', specialization_details: 'INR 24,750/- per semester' }, { specialization_name: 'Cloud', specialization_details: '' }],
    num_specializations: '8'
  }, 'course');
  const c = conformToSchema(course.fields, SCHEMAS.course);
  assert.equal(c.fields.highlights_section_content, '<ul><li><strong>A</strong>: B</li></ul>');
  assert.deepEqual(c.fields.highlights, [{ highlight_title: 'A', highlight_description: 'B' }]);
  assert.deepEqual(c.fields.eligibility_content, [{ eligibility_title: 'Graduation', eligibility_description: 'any stream' }]);
  assert.deepEqual(c.fields.course_academic_years, [{ course_year_title: 'Year 1', course_semesters: [{ course_semester_title: 'Year 1', course_semester_subjects: '<ul><li>C</li></ul>' }] }]);
  assert.equal(c.fields.annual_plan_amount, '50,000');
  // Accreditations (with a description each) and specializations (with a fee each) publish under the site's own fields.
  assert.deepEqual(c.fields.course_accreditations, [{ course_body_name: 'NAAC', course_body_descriptor: 'NAAC A+ Grade', course_body_detail: 'Accredited with A+' }], 'the card heading names the body');
  assert.deepEqual(c.fields.specialization, [{ specialization_name: 'Data Science', specialization_details: 'INR 24,750/- per semester' }, { specialization_name: 'Cloud', specialization_details: '' }]);
  assert.equal(c.fields.num_specializations, '8', 'the number the intern typed, not the length of the list');
  assert.equal(c.fields.specializations_intro, 'Choose from several specializations.\nEach has its own fee.');
  assert.deepEqual(c.skipped, []);
  assert.ok(!('admission_steps_list' in c.fields), 'facts for the AI, never published');
  for (const [k, v] of Object.entries(c.fields)) assert.equal(wpInvalid(v, SCHEMAS.course.properties[k], k), null);

  const uni = mapToWordPress({
    university_name: 'NMIMS', about_additional_notes: 'internal only',
    facts: [{ fact_title: 'Founded', fact_description: '1981' }],
    exam_details: [{ detail_label: 'Mode', detail_value: 'Online' }],
    placement_stats: [{ stat_label: 'Partners', stat_value: '500+' }],
    hiring_partners: 'Amazon\nDeloitte, etc.',
    emi_partners: [{ bank_name: 'HDFC', emi_terms: '0%' }, { bank_name: 'ICICI', emi_terms: '' }],
    faculty_members: [{ member_name: 'Dr. A', member_program: 'MBA', member_designation: 'Professor', member_qualification: 'PhD' }]
  }, 'university');
  const u = conformToSchema(uni.fields, SCHEMAS.university);
  assert.equal(u.fields.facts_content, '<ul><li><strong>Founded</strong>: 1981</li></ul>');
  assert.deepEqual(u.fields.examination_cards, [{ exam_card_title: 'Mode', exam_card_description: 'Online' }]);
  // placement_highlights is the page's "Top Hiring Partners" chips: company names, never the stats.
  assert.equal(u.fields.placement_highlights, '<ul><li>Amazon</li><li>Deloitte</li></ul>');
  assert.ok(!u.skipped.some(s => /placement_stats/.test(s)));
  assert.equal(u.fields.partner_banks_names, '<ul><li>HDFC</li><li>ICICI</li></ul>', 'bank chips, like the hiring partners');
  assert.deepEqual(u.fields.faculty_members, [{ member_name: 'Dr. A', member_designation: 'Professor, MBA, PhD' }]);
  assert.ok(!('about_additional_notes' in u.fields) && !u.skipped.some(s => /additional_notes/.test(s)), 'AI-only notes are never published, and not reported as missing');
  for (const [k, v] of Object.entries(u.fields)) assert.equal(wpInvalid(v, SCHEMAS.university.properties[k], k), null);
});

// Section paragraphs typed by hand on course/specialization pages, against the staging site's own
// fields (tests/fixtures): what it has is sent, what it lacks is reported only if filled in, and
// names that differ between sites (validity / program_validity, "&" in a name) still find their field.
test('hand-written section paragraphs reach the fields the site has, under whatever name it uses', () => {
  const coursePage = mapToWordPress({
    program_name: 'Online MBA', validity: '4 Years', fee_heading: 'Fee Structure',
    accreditation_paragraph: 'Approved by UGC-DEB and AICTE.', eligibility_criteria_paragraph: '',
    fee_structure_paragraph: 'Pay per semester or yearly.', 'job_roles_&_salary_paragraph': 'Roles pay INR 6-12 LPA.',
    syllabus_section_paragraph: 'Four semesters of core and elective subjects.'
  }, 'course');
  const staging = conformToSchema(coursePage.fields, SCHEMAS.course);
  assert.equal(staging.fields.fee_heading, 'Fee Structure');
  assert.equal(staging.fields.program_validity, '4 Years');
  assert.equal(staging.fields.accreditation_paragraph, 'Approved by UGC-DEB and AICTE.');
  assert.equal(staging.fields.fee_structure_paragraph, 'Pay per semester or yearly.');
  assert.equal(staging.fields['job_roles_&_salary_paragraph'], 'Roles pay INR 6-12 LPA.');
  // Course pages keep the paragraph above the syllabus in course_syllabus_description.
  assert.equal(staging.fields.course_syllabus_description, 'Four semesters of core and elective subjects.');
  assert.deepEqual(staging.skipped, [], 'the empty eligibility paragraph is not reported');

  // A site with the older names: validity, and the "&" dropped from the job roles field.
  const props = { ...SCHEMAS.course.properties, validity: { type: ['string', 'null'] }, job_roles_salary_paragraph: { type: ['string', 'null'] } };
  delete props.program_validity;
  delete props['job_roles_&_salary_paragraph'];
  const older = conformToSchema(coursePage.fields, { ...SCHEMAS.course, properties: props });
  assert.equal(older.fields.validity, '4 Years');
  assert.equal(older.fields.job_roles_salary_paragraph, 'Roles pay INR 6-12 LPA.');

  const specPage = mapToWordPress({ spec_name: 'Online MBA in Finance', fee_section_paragraph: 'EMI available.', other_specializations_section_paragraph: 'Also offered: HR, Marketing.', syllabus_section_paragraph: 'Core and electives.', eligibility_criteria_paragraph: 'Any graduate.', job_profiles_section_paragraph: '' }, 'specialization');
  const spec = conformToSchema(specPage.fields, SCHEMAS.specialization);
  for (const k of ['fee_section_paragraph', 'other_specializations_section_paragraph', 'syllabus_section_paragraph', 'eligibility_criteria_paragraph']) assert.ok(spec.fields[k], k);
  assert.equal(spec.fields.job_profiles_section_paragraph, '');
  assert.deepEqual(spec.skipped, []);
});

test('values the page shows as stats: filled from what the page has, cleaned of placeholders', () => {
  const course = mapToWordPress({
    program_name: 'Online MBA', total_fee: 'INR 1,25,000 /-', duration: '2 Years', syllabus_heading: 'Online MBA Syllabus',
    emi_amount: 'INR 3,743 /-', num_specializations: '0 (Not Offered)', validity: 'Validity is not mentioned', naac_grade: 'N/A',
    nirf_rank_course: '#69', partner_banks: 'HDFC Bank, Propelld', scholarship_facility: '25% early bird discount.', certificate_validity: 'Lifetime',
    specialization: [{ specialization_name: 'Finance', specialization_details: 'INR 88,500 /-' }, { specialization_name: 'HR', specialization_details: 'INR 1,10,000 /-' }]
  }, 'course');
  const c = conformToSchema(course.fields, SCHEMAS.course);
  assert.deepEqual(c.skipped, []);
  assert.equal(c.fields.best_price_value, 'INR 1,25,000 /-');
  assert.equal(c.fields.program_duration, '2', 'the theme adds "Yrs" itself');
  assert.equal(c.fields.course_syllabus_section_heading, 'Online MBA Syllabus');
  assert.equal(c.fields.course_amount_range, 'INR 88,500 /- – INR 1,10,000 /-');
  assert.equal(c.fields.emi_amount, '3,743', 'the theme adds "₹" and "/month" itself');
  for (const k of ['num_specializations', 'program_validity', 'naac_grade']) assert.equal(c.fields[k], '', `${k}: a placeholder prints as written, so it goes empty`);
  assert.equal(c.fields.nirf_rank_course, '#69');
  assert.equal(c.fields.partner_banks_course, '<ul><li>HDFC Bank</li><li>Propelld</li></ul>');
  assert.equal(c.fields.scholarship_facility, '25% early bird discount.');
  assert.equal(c.fields.certificate_validity, 'Lifetime');

  // Nothing to fill from: nothing sent, so a value typed into WordPress stays.
  const bare = mapToWordPress({ program_name: 'Online MBA', total_fee: 'On request', specialization: [{ specialization_name: 'Finance', specialization_details: 'INR 88,500' }] }, 'course').fields;
  for (const k of ['best_price_value', 'program_duration', 'course_amount_range', 'course_syllabus_section_heading', 'partner_banks_course']) assert.ok(!(k in bare), k);

  const spec = conformToSchema(mapToWordPress({ spec_name: 'Online MBA in Finance', validity: '4 Years', partner_banks: 'Propelld', specialization_hero_description: 'Build a career in finance.' }, 'specialization').fields, SCHEMAS.specialization);
  assert.deepEqual(spec.skipped, []);
  assert.equal(spec.fields.program_validity, '4 Years');
  assert.equal(spec.fields.partner_banks_specialization, '<ul><li>Propelld</li></ul>');
  assert.equal(spec.fields.specialization_hero_description, 'Build a career in finance.');

  const uni = conformToSchema(mapToWordPress({ university_name: 'VGU Online', nirf_rank: '#95', emi_interest_rate_value: '0%' }, 'university').fields, SCHEMAS.university);
  assert.deepEqual([uni.fields.nirf_rank, uni.fields.emi_interest_rate_value, uni.skipped], ['#95', '0%', []]);
});

test('accreditation card headings name the body: "AICTE Approved", not just "Approved"', () => {
  const rows = [
    { course_body_name: 'AICTE', course_body_descriptor: 'Approved', course_body_detail: 'Approved by the All India Council for Technical Education.' },
    { course_body_name: 'NAAC', course_body_descriptor: 'A++ Grade', course_body_detail: 'x' },
    { course_body_name: 'NIRF', course_body_descriptor: '#24 University, #40 Overall', course_body_detail: 'x' },
    { course_body_name: 'UGC', course_body_descriptor: 'UGC Entitled', course_body_detail: 'x' },
    { course_body_name: 'NAAC', course_body_descriptor: 'Accredited by naac', course_body_detail: 'x' },
    { course_body_name: 'WES', course_body_descriptor: '', course_body_detail: 'x' }
  ];
  const sent = conformToSchema(mapToWordPress({ course_accreditations: rows }, 'course').fields, SCHEMAS.course);
  assert.deepEqual(sent.fields.course_accreditations.map(r => r.course_body_descriptor),
    ['AICTE Approved', 'NAAC A++ Grade', 'NIRF #24 University, #40 Overall', 'UGC Entitled', 'Accredited by naac', ''], 'already named, or empty: left alone');
  assert.equal(sent.fields.course_accreditations[0].course_body_detail, rows[0].course_body_detail);
  const uni = mapToWordPress({ accreditations: [{ body_name: 'UGC-DEB', body_descriptor: 'Entitled', body_detail: 'x' }] }, 'university').fields;
  assert.equal(uni.accreditations[0].body_descriptor, 'UGC-DEB Entitled');
});

test('what the theme adds by itself is taken off before sending', () => {
  const c = mapToWordPress({ program_name: 'Online MBA', emi_amount: '₹8,750/month', duration: '18 Months', num_specializations: '12+' }, 'course').fields;
  assert.deepEqual([c.emi_amount, c.program_duration, c.num_specializations, c.duration], ['8,750', '1.5', '12', '18 Months'], 'Duration itself is shown as typed elsewhere');
  const s = mapToWordPress({ spec_name: 'x', emi_amount: 'INR 7,078 /-', duration: '2-3 Years' }, 'specialization').fields;
  assert.deepEqual([s.emi_amount, s.specialization_lowest_emi_strats_from, s.duration_specialization], ['7,078', '7,078', '2-3']);
  assert.equal(mapToWordPress({ established_year: 'Est. 1998' }, 'university').fields.established_year, '1998');
  for (const [typed, years] of [['2 Years', '2'], ['3 Year', '3'], ['24 months', '2'], ['1.5 years', '1.5']]) assert.equal(yearsOf(typed), years, typed);
});

test('page titles lead with the university when the name is just the program', () => {
  const lpu = 'Lovely Professional University Online';
  assert.equal(pageTitle('course', { program_name: 'Online BA', university_name: lpu }), 'Lovely Professional University Online BA');
  assert.equal(pageTitle('specialization', { spec_name: 'Online BA in English', university_name: lpu }), 'Lovely Professional University Online BA in English');
  assert.equal(pageTitle('course', { program_name: 'MBA', university_name: 'NMIMS' }), 'NMIMS MBA');
  assert.equal(pageTitle('course', { program_name: 'LPU Online MCA in Data Science', university_name: 'LPU Online' }), 'LPU Online MCA in Data Science', 'already names it');
  assert.equal(pageTitle('course', { program_name: 'Sharda Online MBA', university_name: 'Sharda University Online' }), 'Sharda Online MBA', 'not a bare program name');
  assert.equal(pageTitle('university', { university_name: 'VGU Online' }), 'VGU Online');
  assert.equal(pageTitle('course', { university_name: lpu }), 'Untitled');
  // A specialization still finds its course page under either title.
  assert.equal(pickLinkedPost([{ id: 7, title: { rendered: 'Lovely Professional University Online BA' } }], ['Online BA', pageTitle('course', { program_name: 'Online BA', university_name: lpu })]), 7);
  for (const [name, degree] of [['Online BA in English', 'BA'], ['Online M.Com', 'MCom'], ['Online MBA in HR', 'MBA'], ['Online BA in Mass Communication', 'BA'], ['Executive Program', null]]) {
    assert.equal(degreeOf(name), degree, name);
  }
});

test('Top Hiring Partners: typed any common way, sent as chips to each page type\'s own field - never blank', () => {
  const cases = [
    ['Infosys, Honeywell, Hitachi, Johnson Controls, ICICI Bank, etc.', ['Infosys', 'Honeywell', 'Hitachi', 'Johnson Controls', 'ICICI Bank']],
    ['IBM\nKPMG\n- Larsen &amp; Toubro\n2. Adecco, etc', ['IBM', 'KPMG', 'Larsen &amp; Toubro', 'Adecco']],
    ['<ul><li>Amazon</li><li>Deloitte</li></ul>', ['Amazon', 'Deloitte']],
    ['Wipro, HCL and Procter and Gamble', ['Wipro', 'HCL', 'Procter and Gamble']],
    ['Infosys, infosys', ['Infosys']]
  ];
  for (const [typed, names] of cases) assert.equal(partnersToHtmlList(typed), `<ul>${names.map(n => `<li>${n}</li>`).join('')}</ul>`, typed);
  for (const [pageType, wpKey] of [['university', 'placement_highlights'], ['course', 'top_hiring_partners_course'], ['specialization', 'hiring_partners_specialization']]) {
    const sent = conformToSchema(mapToWordPress({ hiring_partners: 'TCS, Wipro' }, pageType).fields, SCHEMAS[pageType]);
    assert.equal(sent.fields[wpKey], '<ul><li>TCS</li><li>Wipro</li></ul>', pageType);
    assert.deepEqual(sent.skipped, []);
    const empty = mapToWordPress({ hiring_partners: ' ', placement_stats: [{ stat_label: 'Avg', stat_value: '8 LPA' }] }, pageType);
    assert.deepEqual(empty.fields, {}, `${pageType}: nothing sent - partners typed into WordPress stay`);
  }
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

test('the EMI figure is just the amount', () => {
  assert.equal(emiFigure('INR 6,917 /-'), '6,917');
  assert.equal(emiFigure('₹5,725/month'), '5,725');
  assert.equal(emiFigure('Starts at 4999.50 per month'), '4999.50');
  assert.equal(emiFigure('No-cost EMI available'), '');
  assert.equal(emiFigure(''), '');
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

test('re-publishing updates the same page in place', async () => {
  wp.posts.set(42, { id: 42, status: 'publish', acf: {}, type: 'specialization' });
  const again = await publishDraftToWordPress({ pageType: 'specialization', title: 'Online MBA', acfFields: { spec_name: 'Online MBA' }, existingPostId: 42 });
  assert.equal(again.id, 42);
  assert.equal(again.recreated, false);
  assert.deepEqual(requests.filter(r => r.method !== 'OPTIONS').map(r => `${r.method} ${r.path}`), ['GET /wp-json/wp/v2/specialization/42', 'PUT /wp-json/wp/v2/specialization/42']);
});

test('re-publishing a page that was deleted in WordPress creates a new one', async () => {
  const result = await publishDraftToWordPress({ pageType: 'specialization', title: 'Online MBA', acfFields: { spec_name: 'Online MBA' }, existingPostId: 7 });
  assert.notEqual(result.id, 7);
  assert.equal(result.recreated, true);
  assert.equal(wp.posts.get(result.id).status, 'publish');
  assert.deepEqual(requests.filter(r => r.method !== 'OPTIONS').map(r => r.method), ['GET', 'POST', 'PUT']);
});

test("re-publishing a page that is in WordPress's Trash creates a fresh one and leaves the trashed one alone", async () => {
  wp.posts.set(42, { id: 42, status: 'trash', acf: {}, type: 'specialization' });
  const result = await publishDraftToWordPress({ pageType: 'specialization', title: 'Online MBA', acfFields: { spec_name: 'Online MBA' }, existingPostId: 42 });
  assert.notEqual(result.id, 42);
  assert.equal(result.recreated, true);
  assert.equal(wp.posts.get(42).status, 'trash', 'not pulled back out of the Trash under its __trashed address');
  assert.ok(!requests.some(r => r.method === 'PUT' && r.path.endsWith('/42')));
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
    assert.doesNotMatch(ok.body.skipped.join(' | '), /admission_steps_list/);
  } finally {
    await t.close();
  }
});
