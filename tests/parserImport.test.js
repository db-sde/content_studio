// Drafts handed over by the document parser (micro app): signed server-to-server import, straight
// into Senior Review with the Word document attached, the parser's field names translated into
// Content Studio's.
import './helpers/env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from './helpers/testApp.js';
import { sign, toFormData } from '../server/integrations/parserImport.js';

const SECRET = 'test-parser-import-secret-0123456789abcdef';
let t, S, I;

before(async () => {
  t = await startTestApp();
  t.config.parserImportSecret = SECRET;
  S = await t.createUser('Senior S', 'senior');
  I = await t.createUser('Intern I', 'intern');
});
after(async () => {
  assert.deepEqual(globalThis.__blockedRequests, [], 'a test tried to reach an outside service');
  await t.close();
});

const COURSE_PAYLOAD = {
  program_name: 'Amity University Online MBA program',
  university_name: 'Amity University Online',
  total_fee: 'INR 1,99,000 /-',
  eligibility_content: [{ eligibility_title: 'Qualification', eligibility_description: 'A bachelor’s degree with 40% marks.' }],
  top_hiring_partners_course: '<ul><li>IBM</li><li>KPMG</li><li>Larsen &amp; Toubro</li></ul>',
  partner_banks_course: '<ul><li>HDFC Bank</li><li>Propelld</li></ul>',
  course_syllabus_description: 'The syllabus has four semesters.',
  course_academic_years: [{ course_year_title: 'Year I', course_semesters: [
    { course_semester_title: 'Semester I', course_semester_subjects: '<ul><li>Accounting</li><li>Economics</li></ul>' },
    { course_semester_title: 'Semester II', course_semester_subjects: '<ul><li>Marketing</li></ul>' }] }],
  validity: '4 Years',
  fee_intro: 'Fees can be paid per semester.',
  admission_fee_note: 'Should never be imported',
  some_parser_only_field: 'x',
  _meta: { document_title: 'x.docx' }
};

async function send(body, { secret = SECRET, timestamp = Math.floor(Date.now() / 1000), signature } = {}) {
  const raw = JSON.stringify(body);
  const res = await fetch(`${t.baseUrl}/api/import/parser-draft`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-parser-timestamp': String(timestamp),
      'x-parser-signature': signature ?? sign(secret, timestamp, Buffer.from(raw))
    },
    body: raw
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

test('unsigned, wrongly signed or stale requests are refused', async () => {
  const body = { pageType: 'course', uploadId: '1', payload: COURSE_PAYLOAD };
  assert.equal((await send(body, { signature: 'nope' })).status, 401);
  assert.equal((await send(body, { secret: 'another-secret-entirely-0123456789' })).status, 401);
  assert.equal((await send(body, { timestamp: Math.floor(Date.now() / 1000) - 3600 })).status, 401);
  const { rows } = await t.query('SELECT count(*)::int AS n FROM drafts');
  assert.equal(rows[0].n, 0);
});

test('a course arrives in Senior Review, fields translated, with the document and a remark for seniors', async () => {
  const doc = Buffer.from('PK fake docx bytes for the test');
  const res = await send({
    pageType: 'course', uploadId: '481', filename: 'Copy of Amity University Online MBA program.docx',
    payload: COURSE_PAYLOAD, relationshipHints: { linked_university: 'Amity University Online' },
    flags: [{ field_key: 'placement_content', message: 'Hiring partner names also appear in this text.' }],
    document: doc.toString('base64')
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.status, 'senior_review');
  assert.deepEqual(res.body.unmapped, ['some_parser_only_field']);

  const draft = await t.api(S, 'GET', `/api/drafts/${res.body.draftId}`);
  assert.equal(draft.status, 200);
  const d = draft.body.draft;
  assert.equal(d.status, 'senior_review');
  assert.equal(d.source, 'parser');
  assert.equal(d.source_filename, 'Copy of Amity University Online MBA program.docx');
  const f = d.form_data;
  assert.equal(f.program_name, 'Amity University Online MBA program');
  assert.equal(f.hiring_partners, 'IBM\nKPMG\nLarsen & Toubro');
  assert.equal(f.partner_banks, 'HDFC Bank\nPropelld');
  assert.equal(f.syllabus_section_paragraph, 'The syllabus has four semesters.');
  assert.deepEqual(f.syllabus_subjects, [{ semester: 'Semester I', subjects: 'Accounting\nEconomics' },
                                          { semester: 'Semester II', subjects: 'Marketing' }]);
  assert.match(f.eligibility_content, /<strong>Qualification<\/strong>: A bachelor’s degree/);
  assert.equal(f.fee_structure_paragraph, 'Fees can be paid per semester.');
  assert.equal(f.linked_university, 'Amity University Online');
  assert.equal(f.admission_fee_note, undefined); // typed in by the senior
  assert.equal(f.some_parser_only_field, undefined);

  const file = await fetch(`${t.baseUrl}/api/drafts/${res.body.draftId}/source-document`, { headers: { cookie: S.cookie } });
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-disposition'), /Copy of Amity University Online MBA program\.docx/);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), doc);

  const { rows } = await t.query("SELECT type, recipient_role, message FROM notifications WHERE draft_id = $1", [res.body.draftId]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'sent_to_senior');
  assert.equal(rows[0].recipient_role, 'senior');
  assert.match(rows[0].message, /Imported from the document/);
  assert.match(rows[0].message, /Hiring partner names also appear/);
});

test('the drafts list says which drafts came from the micro app (its own home tab)', async () => {
  const list = await t.api(S, 'GET', '/api/drafts');
  const imported = list.body.drafts.find(d => d.source === 'parser' && d.source_filename === 'Copy of Amity University Online MBA program.docx');
  assert.ok(imported, 'the imported draft is listed with its source and file name');
  const { body } = await t.api(S, 'POST', '/api/drafts', { pageType: 'course' });
  const after = await t.api(S, 'GET', '/api/drafts');
  assert.equal(after.body.drafts.find(d => d.id === body.draft.id).source, null); // made here
});

test('sending the same upload again returns the existing draft instead of a copy', async () => {
  const again = await send({ pageType: 'course', uploadId: '481', payload: { ...COURSE_PAYLOAD, total_fee: 'changed' } });
  assert.equal(again.status, 200);
  assert.equal(again.body.existed, true);
  const { rows } = await t.query("SELECT form_data_json FROM drafts WHERE source = 'parser' AND source_ref = '481'");
  assert.equal(rows.length, 1);
  assert.equal(JSON.parse(rows[0].form_data_json).total_fee, 'INR 1,99,000 /-'); // untouched
});

test('a large Word document fits (the app-wide JSON limit is 1 MB)', async () => {
  const doc = Buffer.alloc(3 * 1024 * 1024, 7);
  const res = await send({ pageType: 'university', uploadId: '900', filename: 'Big.docx',
    payload: { university_name: 'Big University Online' }, document: doc.toString('base64') });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const { rows } = await t.query('SELECT length(content) AS n FROM draft_source_documents WHERE draft_id = $1', [res.body.draftId]);
  assert.equal(Number(rows[0].n), doc.length);
});

test('the Document Parser account cannot sign in', async () => {
  const { rows } = await t.query("SELECT role, deactivated_at, password_hash FROM users WHERE email = 'document-parser@system.degreebaba'");
  assert.equal(rows[0].role, 'senior');
  assert.ok(rows[0].deactivated_at);
  const login = await t.api(null, 'POST', '/api/auth/login', { email: 'document-parser@system.degreebaba', password: '!' });
  assert.notEqual(login.status, 200);
});

test('university and specialization fields are translated too', () => {
  const uni = toFormData('university', {
    university_name: 'UPES Online',
    placement_highlights: '<ul><li>Amazon</li><li>Deloitte</li></ul>',
    partner_banks_names: '<ul><li>Axis Bank</li></ul>',
    examination_cards: [{ exam_card_title: 'Mode', exam_card_description: 'Online proctored' }]
  }).formData;
  assert.equal(uni.hiring_partners, 'Amazon\nDeloitte');
  assert.deepEqual(uni.emi_partners, [{ bank_name: 'Axis Bank', emi_terms: '' }]);
  assert.deepEqual(uni.exam_details, [{ detail_label: 'Mode', detail_value: 'Online proctored' }]);

  const spec = toFormData('specialization', {
    spec_name: 'Sikkim Manipal Online MBA in Finance Management',
    program_validity: '4 Years',
    hiring_partners_specialization: '<ul><li>EY</li><li>SBI</li></ul>',
    jobs_content: 'Finance graduates can work as:',
    other_specs_intro: 'Other options:',
    examination_content: '<p>Online exams.</p>',
    academic_years: [{ year_title: 'Year I', semesters: [{ semester_title: 'Semester I', semester_subjects: '<ul><li>Finance</li></ul>' }] }]
  }, { linked_course: 'Sikkim Manipal Online MBA program' }).formData;
  assert.equal(spec.validity, '4 Years');
  assert.equal(spec.hiring_partners, 'EY\nSBI');
  assert.equal(spec.job_profiles_section_paragraph, 'Finance graduates can work as:');
  assert.equal(spec.other_specializations_section_paragraph, 'Other options:');
  assert.equal(spec.exam_content, '<p>Online exams.</p>');
  assert.deepEqual(spec.syllabus_subjects, [{ semester: 'Semester I', subjects: 'Finance' }]);
  assert.equal(spec.linked_course, 'Sikkim Manipal Online MBA program');
});

test('an intern can see the document too (only seniors get the hand-off notification)', async () => {
  const { rows } = await t.query("SELECT id FROM drafts WHERE source_ref = '481'");
  const file = await fetch(`${t.baseUrl}/api/drafts/${rows[0].id}/source-document`, { headers: { cookie: I.cookie } });
  assert.equal(file.status, 200);
});

// Fill every field of a page type with a value its type accepts.
async function everyFieldFilled(pageType) {
  const { schemas } = await import('../src/config/schemas.js');
  const data = {};
  schemas[pageType].sections.forEach(sec => sec.fields.forEach(f => {
    data[f.key] = f.type === 'REPEATER' ? [] : `Edited ${f.key}`;
  }));
  return data;
}

for (const pageType of ['university', 'course', 'specialization']) {
  test(`a senior can edit every field of a ${pageType} sent from the micro app`, async () => {
    const res = await send({ pageType, uploadId: `edit-${pageType}`, payload: { university_name: 'Editable University Online' } });
    const id = res.body.draftId;
    const formData = await everyFieldFilled(pageType);
    const put = await t.api(S, 'PUT', `/api/drafts/${id}`, { formData });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.equal(put.body.skippedKeys, undefined, `locked for the senior: ${put.body.skippedKeys}`);
    const saved = (await t.api(S, 'GET', `/api/drafts/${id}`)).body.draft;
    for (const [k, v] of Object.entries(formData)) assert.deepEqual(saved.form_data[k], v, k);
    assert.equal(saved.last_edited_by_user_id, S.id);
  });
}

test('sent back to an intern: the intern it is assigned to can edit it', async () => {
  const res = await send({ pageType: 'course', uploadId: 'to-intern', payload: { program_name: 'Some Online MBA program' } });
  const id = res.body.draftId;
  // While it's with the senior, an intern's edits are not applied.
  let put = await t.api(I, 'PUT', `/api/drafts/${id}`, { formData: { program_name: 'Intern edit' } });
  assert.deepEqual(put.body.skippedKeys, ['program_name']);
  // No intern yet: sending it back would leave it with no one able to edit it, so it's refused.
  const refused = await t.api(S, 'PATCH', `/api/drafts/${id}/status`, { action: 'revert-to-intern', message: 'please fill' });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error || refused.body.message || '', /assign it to an intern/);
  // Assigned, then sent back: that intern can edit every field they normally could.
  assert.equal((await t.api(S, 'PATCH', `/api/drafts/${id}/assign`, { userId: I.id })).status, 200);
  assert.equal((await t.api(S, 'PATCH', `/api/drafts/${id}/status`, { action: 'revert-to-intern', message: 'please fill' })).status, 200);
  put = await t.api(I, 'PUT', `/api/drafts/${id}`, { formData: { program_name: 'Intern edit' } });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.draft.form_data.program_name, 'Intern edit');
});
