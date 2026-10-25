// Core business logic, end to end through the real HTTP routes: who may edit what, the review
// hand-offs, authorship, duplicate detection, assignment and the notifications each step raises.
import './helpers/env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, completeSpecializationFormData } from './helpers/testApp.js';

let t, A, B, C, S, gone, filled;
const label = 'Online MBA in Marketing Management · Test University Online';

before(async () => {
  t = await startTestApp();
  A = await t.createUser('Intern A', 'intern');
  B = await t.createUser('Intern B', 'intern');
  C = await t.createUser('Intern C', 'intern');
  S = await t.createUser('Senior S', 'senior');
  gone = await t.createUser('Gone Intern', 'intern', { deactivated: true });
  filled = await completeSpecializationFormData();
});
after(async () => {
  assert.deepEqual(globalThis.__blockedRequests, [], 'a test tried to reach an outside service');
  await t.close();
});

// Puts a draft in a state where it may be sent on: an intern's own save can't fill AI-only fields,
// so simulate the AI step having filled them.
async function makeComplete(id) {
  await t.query('UPDATE drafts SET form_data_json = $1 WHERE id = $2', [JSON.stringify(filled), id]);
}
async function newDraft(user, formData) {
  const { body } = await t.api(user, 'POST', '/api/drafts', { pageType: 'specialization' });
  if (formData) await t.api(user, 'PUT', `/api/drafts/${body.draft.id}`, { formData });
  return body.draft.id;
}

test('the creator owns a new draft and is its first editor', async () => {
  const r = await t.api(A, 'POST', '/api/drafts', { pageType: 'specialization' });
  assert.equal(r.status, 200);
  assert.equal(r.body.draft.created_by_user_id, A.id);
  assert.equal(r.body.draft.last_edited_by_user_id, A.id);
});

test('another intern can read but never change, send, generate for, or delete a draft', async () => {
  const id = await newDraft(A, filled);
  let r = await t.api(B, 'PUT', `/api/drafts/${id}`, { formData: { ...filled, spec_name: 'HACKED' } });
  assert.equal(r.body.draft.form_data.spec_name, filled.spec_name);
  assert.ok(r.body.skippedKeys.includes('spec_name'));
  assert.equal(r.body.draft.last_edited_by_user_id, A.id, 'a rejected edit must not make B the last editor');
  await makeComplete(id);
  assert.equal((await t.api(B, 'PATCH', `/api/drafts/${id}/status`, { action: 'send-to-senior' })).status, 403);
  assert.equal((await t.api(B, 'POST', `/api/drafts/${id}/generate-all-fields`, { fields: [{ fieldKey: 'x' }], facts: {} })).status, 403);
  assert.equal((await t.api(B, 'DELETE', `/api/drafts/${id}`)).status, 403);
  assert.equal((await t.api(B, 'GET', `/api/drafts/${id}`)).status, 200);
});

test('unauthenticated requests are rejected', async () => {
  assert.equal((await t.api(null, 'GET', '/api/drafts')).status, 401);
  assert.equal((await t.api({ cookie: 'sid=forged' }, 'GET', '/api/drafts')).status, 401);
});

test('review chain: intern -> senior -> back to intern, recording who submitted and who edited', async () => {
  const id = await newDraft(A, filled);
  await makeComplete(id);
  let r = await t.api(A, 'PATCH', `/api/drafts/${id}/status`, { action: 'send-to-senior', message: 'ready' });
  assert.equal(r.status, 200);
  assert.equal(r.body.draft.status, 'senior_review');
  assert.equal(r.body.draft.submitted_by_user_id, A.id);

  r = await t.api(A, 'PATCH', `/api/drafts/${id}/status`, { action: 'send-to-admin' });
  assert.equal(r.status, 403, 'an intern cannot skip the senior');

  r = await t.api(S, 'PUT', `/api/drafts/${id}`, { formData: { ...filled, about_heading: 'about the program' } });
  assert.equal(r.body.draft.last_edited_by_user_id, S.id);

  r = await t.api(S, 'PATCH', `/api/drafts/${id}/status`, { action: 'revert-to-intern', message: 'fix headings' });
  assert.equal(r.body.draft.status, 'intern_editing');
  assert.ok(r.body.draft.prioritized_at, 'a reverted draft is flagged for the Sent Back bucket');

  const list = (await t.api(S, 'GET', '/api/drafts')).body.drafts;
  const row = list.find(d => d.id === id);
  assert.equal(row.created_by_name, 'Intern A');
  assert.equal(row.submitted_by_name, 'Intern A');
  assert.equal(row.last_edited_by_name, 'Senior S');

  const note = (await t.api(A, 'GET', '/api/notifications')).body.notifications.find(n => n.draft_id === id);
  assert.equal(note.type, 'reverted_to_intern');
  assert.equal(note.draft_label, label, 'notifications name the specialization, not just the university');
  assert.ok(!(await t.api(B, 'GET', '/api/notifications')).body.notifications.some(n => n.draft_id === id));
});

test('a draft cannot be sent on while required fields are missing', async () => {
  const id = await newDraft(A, { spec_name: 'Half done' });
  assert.equal((await t.api(A, 'PATCH', `/api/drafts/${id}/status`, { action: 'send-to-senior' })).status, 409);
});

test('duplicate detection ignores case, punctuation and filler words; untitled drafts never match', async () => {
  const a = await newDraft(A, { ...filled, spec_name: 'MCA in Cloud & DevOps', university_name: 'Jain University Online' });
  const b = await newDraft(B, { ...filled, spec_name: 'Online MCA in cloud and devops', university_name: 'Jain University' });
  const blank1 = await newDraft(A);
  const blank2 = await newDraft(B);
  const rows = (await t.api(S, 'GET', '/api/drafts')).body.drafts;
  const by = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.deepEqual([by[a].dup_rank, by[a].dup_total], [1, 2]);
  assert.deepEqual([by[b].dup_rank, by[b].dup_total], [2, 2]);
  assert.equal(by[blank1].dup_rank, null);
  assert.equal(by[blank2].dup_rank, null);
});

test('assignment: only seniors/admins, only to active interns, and it moves ownership', async () => {
  const id = await newDraft(A, filled);
  assert.equal((await t.api(A, 'GET', '/api/drafts/assignable-interns')).status, 403);
  const interns = (await t.api(S, 'GET', '/api/drafts/assignable-interns')).body.interns.map(i => i.id);
  assert.ok(interns.includes(B.id) && !interns.includes(gone.id) && !interns.includes(S.id));

  assert.equal((await t.api(A, 'PATCH', `/api/drafts/${id}/assign`, { userId: B.id })).status, 403);
  assert.equal((await t.api(S, 'PATCH', `/api/drafts/${id}/assign`, { userId: S.id })).status, 400);
  assert.equal((await t.api(S, 'PATCH', `/api/drafts/${id}/assign`, { userId: gone.id })).status, 400);
  assert.equal((await t.api(S, 'PATCH', `/api/drafts/${id}/assign`, { userId: 'abc' })).status, 400);

  const r = await t.api(S, 'PATCH', `/api/drafts/${id}/assign`, { userId: C.id });
  assert.equal(r.status, 200);
  assert.equal(r.body.draft.assigned_to_user_id, C.id);
  assert.equal(r.body.draft.created_by_user_id, A.id, 'the creator is permanent');

  assert.ok((await t.api(A, 'PUT', `/api/drafts/${id}`, { formData: { ...filled, spec_name: 'A again' } })).body.skippedKeys.includes('spec_name'));
  assert.equal((await t.api(C, 'PUT', `/api/drafts/${id}`, { formData: { ...filled, spec_name: 'By C' } })).body.draft.form_data.spec_name, 'By C');
  assert.equal((await t.api(A, 'DELETE', `/api/drafts/${id}`)).status, 403, 'a creator cannot delete a draft taken away from them');

  const row = (await t.api(S, 'GET', '/api/drafts')).body.drafts.find(d => d.id === id);
  assert.equal(row.owner_user_id, C.id);
  assert.equal(row.owner_name, 'Intern C');
});

test('assignment notifies the new intern and the intern who lost it, once, and nobody else', async () => {
  const id = await newDraft(A, filled);
  await t.api(S, 'PATCH', `/api/drafts/${id}/assign`, { userId: C.id });
  await t.api(S, 'PATCH', `/api/drafts/${id}/assign`, { userId: C.id }); // no-op repeat

  const forC = (await t.api(C, 'GET', '/api/notifications')).body.notifications.filter(n => n.draft_id === id);
  const forA = (await t.api(A, 'GET', '/api/notifications')).body.notifications.filter(n => n.draft_id === id);
  const forB = (await t.api(B, 'GET', '/api/notifications')).body.notifications.filter(n => n.draft_id === id);
  assert.deepEqual(forC.map(n => n.type), ['assigned_to_intern']);
  assert.deepEqual(forA.map(n => [n.type, n.message]), [['unassigned_from_intern', 'Reassigned to Intern C']]);
  assert.deepEqual(forB, []);

  // a revert now goes to the assignee
  await makeComplete(id);
  await t.api(C, 'PATCH', `/api/drafts/${id}/status`, { action: 'send-to-senior' });
  await t.api(S, 'PATCH', `/api/drafts/${id}/status`, { action: 'revert-to-intern', message: 'again' });
  assert.ok((await t.api(C, 'GET', '/api/notifications')).body.notifications.some(n => n.draft_id === id && n.type === 'reverted_to_intern'));
  assert.ok(!(await t.api(A, 'GET', '/api/notifications')).body.notifications.some(n => n.draft_id === id && n.type === 'reverted_to_intern'));

  // clearing the assignment tells C, not the creator
  await t.api(S, 'PATCH', `/api/drafts/${id}/assign`, { userId: null });
  const cleared = (await t.api(C, 'GET', '/api/notifications')).body.notifications.find(n => n.draft_id === id && n.type === 'unassigned_from_intern');
  assert.equal(cleared?.message, 'Assignment cleared - back with Intern A');
});

test('approved drafts cannot be reassigned', async () => {
  const id = await newDraft(A, filled);
  await t.query("UPDATE drafts SET status = 'approved' WHERE id = $1", [id]);
  assert.equal((await t.api(S, 'PATCH', `/api/drafts/${id}/assign`, { userId: B.id })).status, 409);
});

// A reviewer's "sent back" remarks used to vanish for them once the intern returned the page: the
// note shown on a page came from the viewer's own notifications, and theirs went to the intern.
test("a page's remarks stay with the page, for everyone, after it comes back", async () => {
  const id = await newDraft(A, filled);
  await makeComplete(id);
  await t.api(A, 'PATCH', `/api/drafts/${id}/status`, { action: 'send-to-senior', message: 'first pass done' });
  await t.api(S, 'PATCH', `/api/drafts/${id}/status`, { action: 'revert-to-intern', message: 'Fix the fee table\nand the FAQs' });
  await t.api(A, 'PATCH', `/api/drafts/${id}/status`, { action: 'send-to-senior' }); // no note this time
  await t.api(A, 'PATCH', `/api/drafts/${id}/status`, { action: 'send-to-senior', message: 'ignored: not allowed twice' });

  for (const viewer of [S, A, B]) {
    const r = await t.api(viewer, 'GET', `/api/drafts/${id}/remarks`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.remarks.map(x => [x.type, x.message, x.created_by_name]), [
      ['reverted_to_intern', 'Fix the fee table\nand the FAQs', 'Senior S'],
      ['sent_to_senior', 'first pass done', 'Intern A']
    ], 'newest first, only hand-offs that carried a note, the same for every viewer');
  }
  assert.equal((await t.api(S, 'GET', '/api/drafts/draft_404/remarks')).status, 404);
});

// University docs come with every section written, so an intern can paste into a University page's
// AI fields - and the server keeps it. On other page types the AI fields stay locked for interns.
test("an intern's text in a University page's AI fields is saved; on a specialization it is not", async () => {
  const { body: uni } = await t.api(A, 'POST', '/api/drafts', { pageType: 'university' });
  const saved = await t.api(A, 'PUT', `/api/drafts/${uni.draft.id}`, { formData: { university_name: 'Test University Online', about_content: '<p>Pasted from the doc.</p>' } });
  assert.equal(saved.body.draft.form_data.about_content, '<p>Pasted from the doc.</p>');
  assert.equal(saved.body.skippedKeys, undefined);

  const { body: spec } = await t.api(A, 'POST', '/api/drafts', { pageType: 'specialization' });
  const blocked = await t.api(A, 'PUT', `/api/drafts/${spec.draft.id}`, { formData: { spec_name: 'Online MBA', about_content: '<p>Typed by the intern.</p>' } });
  assert.deepEqual(blocked.body.skippedKeys, ['about_content']);
  assert.ok(!blocked.body.draft.form_data.about_content);
});
