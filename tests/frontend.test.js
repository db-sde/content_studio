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
import { universityKey, universityOptions, NO_UNIVERSITY } from '../src/utils/universityFilter.js';

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

test('university filter: spellings that differ only in case or punctuation are one university', () => {
  const drafts = [
    { university_name: 'Jain University Online' }, { university_name: 'JAIN University  Online' },
    { university_name: 'Jain University Online' }, { university_name: 'NMIMS' }, { university_name: '' }, {}
  ];
  const options = universityOptions(drafts);
  assert.deepEqual(options.map(o => [o.label, o.count]), [['Jain University Online', 3], ['NMIMS', 1], ['No university yet', 2]]);
  assert.equal(universityKey('JAIN University  Online'), universityKey('jain university online'));
  assert.equal(universityKey('   '), NO_UNIVERSITY);
});
