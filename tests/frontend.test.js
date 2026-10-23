// Pure frontend logic that decides what gets published and who may edit - no browser needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toTitleCase, defaultSemesterLabel, isGeneratedSemesterLabel, toBulletListHtml, bulletListHtmlToText,
  splitSubjectItems, transformToACF, normalizeLoadedFormData, validateFactsOnly, schemas
} from '../src/config/schemas.js';
import { canEditField, getLockReason } from '../src/utils/permissions.js';
import { isUserActive, IDLE_AFTER_MS, POLL_INTERVAL_MS, LIST_POLL_INTERVAL_MS, SLOW_POLL_INTERVAL_MS } from '../src/utils/useActivePolling.js';
import { NOTIFICATION_TYPE_VERBS } from '../src/utils/notificationFormat.js';
import { universityKey, NO_UNIVERSITY } from '../src/utils/universityFilter.js';
import { ALL, buildDraftColumns, matchesOtherColumns, columnOptions, columnOptionsWithChoice, programOf } from '../src/utils/draftColumnFilters.js';

test('headings: first letter of every word capitalised, acronyms and apostrophes untouched', () => {
  assert.equal(toTitleCase('about the program'), 'About The Program');
  assert.equal(toTitleCase('FAQs about NMIMS'), 'FAQs About NMIMS');
  assert.equal(toTitleCase("student's e-learning"), "Student's E-Learning");
});

test('semester labels default to roman numerals and only generated ones are renumbered', () => {
  assert.deepEqual([0, 1, 2, 3, 9].map(defaultSemesterLabel), ['Semester I', 'Semester II', 'Semester III', 'Semester IV', 'Semester X']);
  assert.ok(isGeneratedSemesterLabel('Semester IV'));
  assert.ok(!isGeneratedSemesterLabel('Semester 1'));
});

test('subjects become a bullet list, escaped, and convert back losslessly', () => {
  assert.deepEqual(splitSubjectItems('Marketing, Finance; Law'), ['Marketing', 'Finance', 'Law']);
  assert.deepEqual(splitSubjectItems('● Research Methods, Applied\n- Ethics'), ['Research Methods, Applied', 'Ethics']);
  const html = toBulletListHtml('R&D <basics>\nEthics');
  assert.equal(html, '<ul><li>R&amp;D &lt;basics&gt;</li><li>Ethics</li></ul>');
  assert.equal(toBulletListHtml(html), html, 'already-converted input is never double-wrapped');
  assert.equal(bulletListHtmlToText(html), 'R&D <basics>\nEthics');
});

test('the published JSON gets title-cased headings, default semesters and bullet subjects', () => {
  const out = transformToACF({
    syllabus_heading: 'syllabus for the course',
    syllabus_subjects: [{ semester: '', subjects: 'A, B' }, { semester: 'Semester II', subjects: 'C' }, { semester: 'Semester III', subjects: '' }]
  }, 'course');
  assert.equal(out.syllabus_heading, 'Syllabus For The Course');
  assert.deepEqual(out.syllabus_subjects, [
    { semester: 'Semester I', subjects: '<ul><li>A</li><li>B</li></ul>' },
    { semester: 'Semester II', subjects: '<ul><li>C</li></ul>' }
  ], 'a row with only a semester label is not a real row');
});

test('opening an old draft fills missing semester labels by position', () => {
  const out = normalizeLoadedFormData({ about_heading: 'about us', syllabus_subjects: [{ semester: '', subjects: 'A' }, { semester: '', subjects: '' }, { semester: '', subjects: 'B' }] }, 'course');
  assert.equal(out.about_heading, 'About Us');
  assert.deepEqual(out.syllabus_subjects.map(r => r.semester), ['Semester I', '', 'Semester II']);
});

test('every page type has a valid schema and the generate button is gated on facts only', () => {
  for (const type of ['university', 'course', 'specialization']) {
    assert.ok(schemas[type].sections.length > 0);
    assert.equal(validateFactsOnly({}, type).isValid, false, `${type}: an empty page must not be generatable`);
  }
});

test('editing permissions: seniors/admins always; interns only their own draft, only while it is with them', () => {
  const plain = { key: 'spec_name' };
  const ai = { key: 'about_content', aiAssist: {} };
  const ctx = (o) => ({ role: 'intern', draftStatus: 'intern_editing', allowInternAiEdit: false, isDraftOwner: true, ...o });
  assert.ok(canEditField(plain, ctx({ role: 'senior', isDraftOwner: false, draftStatus: 'admin_review' })));
  assert.ok(canEditField(plain, ctx({})));
  assert.ok(!canEditField(plain, ctx({ isDraftOwner: false })));
  assert.equal(getLockReason(plain, ctx({ isDraftOwner: false })), 'Assigned to another intern');
  assert.ok(!canEditField(plain, ctx({ draftStatus: 'senior_review' })));
  assert.ok(!canEditField(ai, ctx({})));
  assert.ok(canEditField(ai, ctx({ allowInternAiEdit: true })));
});

test('polling only happens for a visible tab whose user is around', () => {
  const now = 1_000_000_000;
  assert.ok(isUserActive({ visibilityState: 'visible', lastActivityAt: now - 1000, now }));
  assert.ok(!isUserActive({ visibilityState: 'hidden', lastActivityAt: now - 1000, now }));
  assert.ok(!isUserActive({ visibilityState: 'visible', lastActivityAt: now - IDLE_AFTER_MS, now }));
});

test('polling intervals never drop back below what the database budget was sized for', () => {
  assert.ok(POLL_INTERVAL_MS >= 30_000, `notifications/status poll ${POLL_INTERVAL_MS}ms`);
  assert.ok(LIST_POLL_INTERVAL_MS >= 60_000, `drafts list poll ${LIST_POLL_INTERVAL_MS}ms`);
  assert.ok(SLOW_POLL_INTERVAL_MS >= 5 * 60_000, `cost total poll ${SLOW_POLL_INTERVAL_MS}ms`);
  assert.ok(IDLE_AFTER_MS <= 15 * 60_000, `idle cut-off ${IDLE_AFTER_MS}ms`);
});

test('every notification type has wording', () => {
  for (const [type, verb] of Object.entries(NOTIFICATION_TYPE_VERBS)) assert.ok(verb && verb.length > 2, type);
});

// The Saved Drafts table's column-header dropdowns.
const NOW = new Date('2026-10-22T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
const SAMPLE = [
  { id: 1, page_type: 'specialization', university_name: 'Jain University Online', spec_name: 'Online MBA in AI for Finance', owner: [7, 'Mistu'], status: 'admin_review', updated_at: daysAgo(0), last_edited_by_name: 'Krishna Porwal' },
  { id: 2, page_type: 'specialization', university_name: 'JAIN University  Online', spec_name: 'Online MCA in Data Science', owner: [8, 'Harshita'], status: 'senior_review', prioritized_at: daysAgo(1), updated_at: daysAgo(3), last_edited_by_name: 'Harshita' },
  { id: 3, page_type: 'specialization', university_name: 'Amity University Online', spec_name: 'Online MBA With Career Pathways', owner: [8, 'Harshita'], status: 'admin_review', updated_at: daysAgo(10), last_edited_by_name: 'Krishna Porwal', dup: 'duplicate' },
  { id: 4, page_type: 'course', university_name: 'Amity University Online', program_name: 'Online MBA', owner: [7, 'Mistu'], status: 'approved', updated_at: daysAgo(45), last_edited_by_name: 'Admin' },
  { id: 5, page_type: 'university', university_name: '', owner: [8, 'Harshita'], status: 'intern_editing', updated_at: daysAgo(0) }
];
const COLUMNS = buildDraftColumns({
  title: (d) => d.spec_name || d.program_name || d.university_name || '',
  isUntitled: (d) => !(d.spec_name || d.program_name || d.university_name),
  isDuplicate: (d) => d.dup === 'duplicate', isRepeated: (d) => d.dup === 'duplicate',
  ownerId: (d) => d.owner?.[0], ownerName: (d) => d.owner?.[1],
  statusLabels: { intern_editing: 'Intern Editing', senior_review: 'Senior Review', admin_review: 'Admin Review', approved: 'Approved' },
  pageTypeLabel: (t) => ({ specialization: 'Specialization Page', course: 'Course Page', university: 'University Page' })[t], now: NOW
});
const col = (id) => COLUMNS.find(c => c.id === id);
const opts = (id, drafts = SAMPLE) => columnOptions(drafts, col(id)).map(o => `${o.label} (${o.count})`);
const pick = (filters) => SAMPLE.filter(d => matchesOtherColumns(d, COLUMNS, { ...Object.fromEntries(COLUMNS.map(c => [c.id, ALL])), ...filters })).map(d => d.id);

test('column filters: each column offers its values with counts, most common spelling first', () => {
  assert.deepEqual(opts('university'), ['Amity University Online (2)', 'Jain University Online (2)', 'No university yet (1)']);
  assert.equal(universityKey('JAIN University  Online'), universityKey('jain university online'));
  assert.equal(universityKey('   '), NO_UNIVERSITY);
  assert.deepEqual(opts('pageType'), ['Course Page (1)', 'Specialization Page (3)', 'University Page (1)']);
  assert.deepEqual(opts('program'), ['Online MBA (3)', 'Online MCA (1)', 'Untitled (1)']);
  assert.deepEqual(opts('intern'), ['Harshita (3)', 'Mistu (2)']);
  assert.deepEqual(opts('duplicate'), ['Unique (3)', 'Duplicate (1)', 'Untitled (1)']);
  assert.deepEqual(opts('status'), ['Intern Editing (1)', 'Senior Review (1)', 'Admin Review (2)', 'Approved (1)', 'Sent back (1)']);
  assert.deepEqual(opts('edited'), ['Today (2)', 'Last 7 days (3)', 'Last 30 days (4)', 'Older than 30 days (1)', 'Admin (1)', 'Harshita (1)', 'Krishna Porwal (2)']);
});

test('column filters combine, and a sent-back draft matches both its stage and "Sent back"', () => {
  assert.deepEqual(pick({ intern: 'user:8', status: 'admin_review' }), [3]);
  assert.deepEqual(pick({ status: 'sent_back' }), [2]);
  assert.deepEqual(pick({ status: 'senior_review' }), [2]);
  assert.deepEqual(pick({ edited: '7d', university: universityKey('jain university online') }), [1, 2]);
  assert.deepEqual(pick({ edited: 'by:krishna porwal', program: 'online mba' }), [1, 3]);
  // Faceted: the intern dropdown, with Amity chosen, counts only Amity's pages.
  const amity = SAMPLE.filter(d => matchesOtherColumns(d, COLUMNS, { university: universityKey('Amity University Online') }, 'intern'));
  assert.deepEqual(opts('intern', amity), ['Harshita (1)', 'Mistu (1)']);
});

test('a chosen option that matches nothing under the other filters keeps its name, with (0)', () => {
  const approvedOnly = SAMPLE.filter(d => d.status === 'approved');
  const shown = columnOptionsWithChoice(SAMPLE, approvedOnly, col('university'), universityKey('Jain University Online'));
  assert.deepEqual(shown.map(o => `${o.label} (${o.count})`), ['Amity University Online (1)', 'Jain University Online (0)']);
});

test('the program a title belongs to', () => {
  assert.equal(programOf('Online MBA in AI for Finance'), 'Online MBA');
  assert.equal(programOf('Online MBA With PMI Certification Pathways'), 'Online MBA');
  assert.equal(programOf('Online M.Com in Accounting & Taxation'), 'Online M.Com');
  assert.equal(programOf('MBA (Executive)'), 'MBA');
  assert.equal(programOf('Online MBA - Finance'), 'Online MBA');
  assert.equal(programOf('Master of Business Administration'), 'Master of Business Administration');
});

test('course pages: a description per accreditation, a fee per specialization, under the site\'s own field names', async () => {
  const { schemas } = await import('../src/config/schemas.js');
  const fields = Object.fromEntries(schemas.course.sections.flatMap(sec => sec.fields).map(f => [f.key, f]));
  assert.deepEqual(fields.course_accreditations.subfields.map(f => f.key), ['course_body_name', 'course_body_descriptor', 'course_body_detail']);
  assert.deepEqual(fields.specialization.subfields.map(f => f.key), ['specialization_name', 'specialization_details']);
  assert.equal(fields.course_accreditations.subfields[2].type, 'textarea');
  assert.deepEqual([fields.specialization.subfields[1].label, fields.specialization.subfields[1].type], ['Fee', 'text'], "each specialization's fee, in the row's one text field on WordPress");
  assert.equal(fields.specializations_intro.type, 'TEXTAREA');
});
