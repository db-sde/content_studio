// The Admin's Field Settings: what each toggle does to the form, the checks, AI generation and the
// "→ WordPress" tags - as pure rules first, then end to end through the real routes.
import './helpers/env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, completeSpecializationFormData } from './helpers/testApp.js';
import { schemas, validateState, validateFactsOnly } from '../src/config/schemas.js';
import { buildEffectiveSchemas, findSchemaField, aiFieldsOf, aiFactsOf, fieldsOutOfInternReach, defaultAiInstructions } from '../src/config/fieldSettings.js';
import { canEditField, getLockReason } from '../src/utils/permissions.js';
import { wordpressTargetOf } from '../server/integrations/wordpressAcf.js';
import { wordpressTagOf } from '../src/utils/wordpressTag.js';

const field = (schema, key) => findSchemaField(schema, key);
const o = (pageType, fieldKey, settings) => ({ pageType, fieldKey, ...settings });

// ---------------------------------------------------------------- rules
test('with no settings changed, every field behaves exactly as before', () => {
  const effective = buildEffectiveSchemas([]);
  for (const [pageType, schema] of Object.entries(schemas)) {
    const base = schema.sections.flatMap(s => s.fields);
    const eff = effective[pageType].sections.flatMap(s => s.fields);
    assert.deepEqual(eff.map(f => f.key), base.map(f => f.key), `${pageType}: same fields, same order`);
    assert.deepEqual(effective[pageType].hiddenFieldKeys, []);
    for (const f of base) {
      const e = field(effective[pageType], f.key);
      assert.equal(e.required, f.required, `${pageType}.${f.key} required`);
      assert.equal(!!e.aiAssist, !!f.aiAssist, `${pageType}.${f.key} AI`);
      assert.equal(e.aiAssist?.instructions, f.aiAssist?.instructions);
      for (const ctx of [{ allowInternAiEdit: false }, { allowInternAiEdit: true }]) {
        const who = { role: 'intern', draftStatus: 'intern_editing', ...ctx };
        assert.equal(canEditField(e, who), canEditField(f, who), `${pageType}.${f.key} intern edit ${JSON.stringify(ctx)}`);
      }
    }
  }
});

test('hiding a field takes it off the form, out of the checks and out of the AI facts', () => {
  const effective = buildEffectiveSchemas([o('specialization', 'about_content', { visible: false }), o('specialization', 'duration', { visible: false })]);
  const spec = effective.specialization;
  assert.equal(field(spec, 'about_content'), null);
  assert.deepEqual(spec.hiddenFieldKeys.sort(), ['about_content', 'duration']);
  assert.ok(!aiFieldsOf(spec).some(f => f.fieldKey === 'about_content'), 'the AI skips it');
  assert.ok(!('duration' in aiFactsOf(spec, { duration: '2 Years' })), 'not handed to the AI as a fact');
  const empty = { spec_name: 'x' };
  assert.ok(validateState(empty, 'specialization').invalidFields.about_content, 'required by default');
  assert.ok(!validateState(empty, 'specialization', { schema: spec }).invalidFields.about_content, 'not once hidden');
});

test('the title, university and linked page fields ignore every setting', () => {
  const effective = buildEffectiveSchemas([
    o('specialization', 'spec_name', { visible: false, required: false }),
    o('specialization', 'linked_course', { visible: false }),
    o('course', 'university_name', { required: false, internFillable: false })
  ]);
  assert.equal(field(effective.specialization, 'spec_name').required, true);
  assert.ok(field(effective.specialization, 'linked_course'));
  const uni = field(effective.course, 'university_name');
  assert.equal(uni.required, true);
  assert.equal(canEditField(uni, { role: 'intern', draftStatus: 'intern_editing' }), true);
});

test('mandatory on and off', () => {
  const effective = buildEffectiveSchemas([o('course', 'fee_heading', { required: true }), o('course', 'duration', { required: false })]);
  assert.equal(field(effective.course, 'fee_heading').required, true);
  assert.equal(field(effective.course, 'duration').required, false);
  const errors = validateState({}, 'course', { schema: effective.course }).invalidFields;
  assert.ok(errors.fee_heading);
  assert.ok(!errors.duration);
});

test('AI on for a hand-filled text field: it joins generation, with its own or a default instruction', () => {
  const effective = buildEffectiveSchemas([
    o('specialization', 'fee_section_paragraph', { aiGenerated: true }),
    o('specialization', 'syllabus_section_paragraph', { aiGenerated: true, aiInstructions: 'Two lines on how the syllabus is laid out.' }),
    o('specialization', 'faqs', { aiGenerated: true }), // a list - can't be AI-written
    o('specialization', 'about_content', { aiGenerated: false })
  ]);
  const ai = Object.fromEntries(aiFieldsOf(effective.specialization).map(f => [f.fieldKey, f]));
  const fee = field(effective.specialization, 'fee_section_paragraph');
  assert.equal(ai.fee_section_paragraph.fieldInstructions, defaultAiInstructions(fee));
  assert.equal(ai.syllabus_section_paragraph.fieldInstructions, 'Two lines on how the syllabus is laid out.');
  assert.equal(ai.syllabus_section_paragraph.outputFormat, 'plain');
  assert.ok(!ai.faqs);
  assert.ok(!ai.about_content, 'AI off');
  const about = field(effective.specialization, 'about_content');
  assert.equal(canEditField(about, { role: 'intern', draftStatus: 'intern_editing' }), true, 'now typed in by the intern');
  assert.ok('about_content' in aiFactsOf(effective.specialization, {}), 'and a fact for the AI fields that remain');
  assert.equal(canEditField(fee, { role: 'intern', draftStatus: 'intern_editing' }), false, 'a new AI field is the AI\'s, like the others');

  const kept = buildEffectiveSchemas([o('specialization', 'about_content', { aiGenerated: false, internFillable: false })]);
  assert.equal(canEditField(field(kept.specialization, 'about_content'), { role: 'intern', draftStatus: 'intern_editing' }), false, 'unless the admin also chose "Senior & Admin only"');
});

test('"Senior & Admin only": interns can\'t fill it and aren\'t held up by it; approval still needs it', () => {
  const effective = buildEffectiveSchemas([o('specialization', 'emi_amount', { internFillable: false })]);
  const emi = field(effective.specialization, 'emi_amount');
  const intern = { role: 'intern', draftStatus: 'intern_editing', allowInternAiEdit: true };
  assert.equal(canEditField(emi, intern), false, 'Intern AI Edit doesn\'t unlock a hand-filled field');
  assert.equal(getLockReason(emi, intern), 'Filled by Senior/Admin');
  assert.equal(canEditField(emi, { role: 'senior', draftStatus: 'senior_review' }), true);

  const data = { emi_amount: '' };
  const internView = { schema: effective.specialization, skipField: fieldsOutOfInternReach({ role: 'intern', draftStatus: 'intern_editing' }) };
  assert.ok(!validateFactsOnly(data, 'specialization', internView).invalidFields.emi_amount);
  assert.ok(!validateState(data, 'specialization', internView).invalidFields.emi_amount);
  assert.ok(validateState(data, 'specialization', { schema: effective.specialization }).invalidFields.emi_amount, 'the admin approving still needs it');

  const uniAi = field(buildEffectiveSchemas([o('university', 'about_content', { internFillable: false })]).university, 'about_content');
  assert.equal(canEditField(uniAi, { role: 'intern', draftStatus: 'intern_editing' }), false);
  assert.equal(canEditField(uniAi, { role: 'intern', draftStatus: 'intern_editing', allowInternAiEdit: true }), true, 'an AI field still opens with Intern AI Edit');
});

test('WordPress tags: where each field lands, and whether the site has that field', () => {
  const course = (key) => findSchemaField(schemas.course, key);
  assert.deepEqual(wordpressTargetOf('course', course('validity')).wpKeys, ['program_validity']);
  assert.deepEqual(wordpressTargetOf('course', course('highlights')).wpKeys, ['highlights', 'highlights_section_content']);
  assert.deepEqual(wordpressTargetOf('course', course('fee_plans')).wpKeys, ['fee_plans', 'semester_plan_amount', 'annual_plan_amount', 'one-time_payment_amount']);
  assert.equal(wordpressTargetOf('course', course('linked_university')).kind, 'linked');
  assert.equal(wordpressTargetOf('university', findSchemaField(schemas.university, 'about_additional_notes')).kind, 'internal');

  const live = ['validity', 'job_roles_salary_paragraph', 'about_content'];
  const v = wordpressTargetOf('course', course('validity'), live);
  assert.deepEqual(v, { kind: 'sent', wpKeys: ['validity'], missing: [] }, 'an older site\'s name for it counts');
  assert.deepEqual(wordpressTargetOf('course', course('job_roles_&_salary_paragraph'), live).wpKeys, ['job_roles_salary_paragraph']);
  const syllabus = wordpressTargetOf('course', course('syllabus_section_paragraph'), live);
  assert.deepEqual(syllabus.missing, ['syllabus_section_paragraph']);
  assert.equal(wordpressTagOf(syllabus, true).tone, 'warn');
  assert.match(wordpressTagOf(syllabus, true).text, /^Missing on WordPress/);
  assert.equal(wordpressTagOf(wordpressTargetOf('course', course('about_content'), live), true).text, '→ WordPress: about_content');
});

// ---------------------------------------------------------------- through the routes
let t, intern, senior, admin, filled;

before(async () => {
  t = await startTestApp();
  intern = await t.createUser('Intern', 'intern');
  senior = await t.createUser('Senior', 'senior');
  admin = await t.createUser('Admin', 'admin');
  filled = await completeSpecializationFormData();
});
beforeEach(async () => {
  await t.query('DELETE FROM field_settings');
});
after(async () => {
  assert.deepEqual(globalThis.__blockedRequests, [], 'a test tried to reach an outside service');
  await t.close();
});

const setField = (user, pageType, key, body) => t.api(user, 'PUT', `/api/field-settings/${pageType}/${encodeURIComponent(key)}`, body);

async function draftAt(status, formData) {
  const { body } = await t.api(intern, 'POST', '/api/drafts', { pageType: 'specialization' });
  await t.query('UPDATE drafts SET form_data_json = $1, status = $2 WHERE id = $3', [JSON.stringify(formData), status, body.draft.id]);
  return body.draft.id;
}

test('everyone reads the settings; only an admin changes them', async () => {
  assert.equal((await t.api(intern, 'GET', '/api/field-settings')).status, 200);
  assert.equal((await setField(intern, 'specialization', 'duration', { required: false })).status, 403);
  assert.equal((await setField(senior, 'specialization', 'duration', { required: false })).status, 403);
  assert.equal((await t.api(senior, 'DELETE', '/api/field-settings/specialization/duration')).status, 403);

  const r = await setField(admin, 'specialization', 'duration', { required: false });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.overrides.map(x => [x.pageType, x.fieldKey, x.required, x.visible, x.updatedByName]), [['specialization', 'duration', false, null, 'Admin']]);

  const again = await setField(admin, 'specialization', 'duration', { visible: false });
  assert.equal(again.body.overrides[0].required, false, 'changing one setting keeps the others');
  assert.equal(again.body.overrides[0].visible, false);

  const reset = await t.api(admin, 'DELETE', '/api/field-settings/specialization/duration');
  assert.deepEqual(reset.body.overrides, []);
});

test('bad changes are refused with a reason', async () => {
  const cases = [
    [['specialization', 'spec_name', { visible: false }], /needed for every page/],
    [['specialization', 'faqs', { aiGenerated: true }], /only write text fields/],
    [['specialization', 'duration', { required: 'yes' }], /true, false or null/],
    [['specialization', 'nope', { required: true }], /Unknown field/],
    [['blog', 'duration', { required: true }], /Unknown page type/],
    [['specialization', 'duration', {}], /Nothing to change/]
  ];
  for (const [[pageType, key, body], message] of cases) {
    const r = await setField(admin, pageType, key, body);
    assert.equal(r.status, 400, `${key} ${JSON.stringify(body)}`);
    assert.match(r.body.error, message);
  }
});

test('"Senior & Admin only" on the server: the intern\'s edit is kept out, sending on isn\'t blocked, approval is', async () => {
  await setField(admin, 'specialization', 'emi_amount', { internFillable: false });
  const id = await draftAt('intern_editing', { ...filled, emi_amount: '' });

  const save = await t.api(intern, 'PUT', `/api/drafts/${id}`, { formData: { ...filled, emi_amount: '₹5,000', duration: '2 Years' } });
  assert.deepEqual(save.body.skippedKeys, ['emi_amount']);
  assert.equal(save.body.draft.form_data.duration, '2 Years', 'the rest of the save goes through');

  const sent = await t.api(intern, 'PATCH', `/api/drafts/${id}/status`, { action: 'send-to-senior' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal((await t.api(senior, 'PATCH', `/api/drafts/${id}/status`, { action: 'send-to-admin' })).status, 409, 'the senior must fill it before sending on');
  await t.api(senior, 'PUT', `/api/drafts/${id}`, { formData: { emi_amount: '₹5,000' } });
  assert.equal((await t.api(senior, 'PATCH', `/api/drafts/${id}/status`, { action: 'send-to-admin' })).status, 200);
});

test('a hidden mandatory field no longer blocks approval, and interns can\'t change it', async () => {
  const id = await draftAt('admin_review', { ...filled, about_content: '' });
  assert.equal((await t.api(admin, 'PATCH', `/api/drafts/${id}/status`, { action: 'approve' })).status, 409, 'required by default');
  await setField(admin, 'specialization', 'about_content', { visible: false });
  const ok = await t.api(admin, 'PATCH', `/api/drafts/${id}/status`, { action: 'approve' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));

  const mine = await draftAt('intern_editing', filled);
  const r = await t.api(intern, 'PUT', `/api/drafts/${mine}`, { formData: { about_content: 'sneaked in' } });
  assert.deepEqual(r.body.skippedKeys, ['about_content']);
});

test('a field made mandatory blocks approval until it is filled', async () => {
  const id = await draftAt('admin_review', { ...filled, fee_section_paragraph: '' });
  await setField(admin, 'specialization', 'fee_section_paragraph', { required: true });
  const r = await t.api(admin, 'PATCH', `/api/drafts/${id}/status`, { action: 'approve' });
  assert.equal(r.status, 409);
});

test('AI generation follows the settings, whatever the request lists', async () => {
  await t.query('DELETE FROM generation_logs');
  await t.query('DELETE FROM evaluation_logs');
  await setField(admin, 'specialization', 'about_content', { aiGenerated: false });
  await setField(admin, 'specialization', 'fee_section_paragraph', { aiGenerated: true, aiInstructions: 'One line on paying in parts.' });
  const id = await draftAt('intern_editing', filled);

  const off = await t.api(intern, 'POST', `/api/drafts/${id}/generate-all-fields`, { fields: [{ fieldKey: 'about_content' }], facts: {} });
  assert.equal(off.status, 400);
  assert.match(off.body.error, /set to be AI-generated/i);

  // No API key in tests, so each field fails - which shows exactly which fields were attempted.
  const on = await t.api(intern, 'POST', `/api/drafts/${id}/generate-all-fields`, {
    fields: [{ fieldKey: 'fee_section_paragraph' }, { fieldKey: 'about_content' }, { fieldKey: 'seo_title' }], facts: {}
  });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  assert.deepEqual(on.body.failures.map(f => f.fieldKey).sort(), ['fee_section_paragraph', 'seo_title']);

  const review = await draftAt('senior_review', filled);
  const single = await t.api(senior, 'POST', '/api/ai/generate-field', { draftId: review, pageType: 'specialization', fieldKey: 'about_content', fieldLabel: 'About' });
  assert.equal(single.status, 400, 'per-field regenerate too');

  const estimate = await t.api(intern, 'GET', '/api/ai/pricing-estimate?pageType=specialization');
  assert.equal(estimate.status, 200);
});

test('the WordPress tag list answers even with WordPress not set up', async () => {
  const r = await t.api(intern, 'GET', '/api/field-settings/wordpress');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.checkedLive, { university: false, course: false, specialization: false });
  assert.deepEqual(r.body.targets.course.validity, { kind: 'sent', wpKeys: ['program_validity'] });
});
