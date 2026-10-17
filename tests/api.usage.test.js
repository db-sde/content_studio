// Database usage budgets. The Neon database was taken offline once already by its monthly
// data-transfer quota, almost entirely from endpoints every open tab polls. These tests pin how
// many queries and how many bytes those endpoints may cost, so a future change that quietly makes
// a poll heavy fails here instead of on the bill.
import './helpers/env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, completeSpecializationFormData } from './helpers/testApp.js';
import { computeCostUsd } from '../server/ai/pricing.js';

let t, A, B, S, filled, draftId;

before(async () => {
  t = await startTestApp();
  A = await t.createUser('Intern A', 'intern');
  B = await t.createUser('Intern B', 'intern');
  S = await t.createUser('Senior S', 'senior');
  filled = await completeSpecializationFormData();
  // A realistic amount of data, so a query that ships everything is visibly expensive.
  for (let i = 0; i < 60; i++) {
    const { body } = await t.api(A, 'POST', '/api/drafts', { pageType: 'specialization' });
    await t.api(A, 'PUT', `/api/drafts/${body.draft.id}`, { formData: { ...filled, spec_name: `Spec ${i}` } });
    draftId = body.draft.id;
  }
});
after(async () => {
  assert.deepEqual(globalThis.__blockedRequests, [], 'a test tried to reach an outside service');
  await t.close();
});

// Polls an endpoint once to warm any cache, then measures a second, unchanged poll.
async function measureUnchangedPoll(user, path) {
  await t.api(user, 'GET', path);
  t.resetStats();
  const r = await t.api(user, 'GET', path);
  return { r, queries: t.stats.queries, bytes: t.stats.bytes, log: t.stats.log };
}

test('drafts list poll with nothing changed: no big query, under 1 KB from the database', async () => {
  const { r, queries, bytes, log } = await measureUnchangedPoll(S, '/api/drafts');
  assert.equal(r.body.drafts.length, 60);
  assert.ok(!log.some(q => q.includes('WITH base AS')), 'the full list query ran even though nothing changed');
  assert.ok(queries <= 3, `${queries} queries`);
  assert.ok(bytes < 1024, `${bytes} bytes`);
});

test('notifications poll with nothing new: no feed query, under 1 KB', async () => {
  const { queries, bytes, log } = await measureUnchangedPoll(A, '/api/notifications');
  assert.ok(!log.some(q => q.includes('notifications.id, notifications.draft_id')), 'the full feed query ran with nothing new');
  assert.ok(queries <= 4, `${queries} queries`);
  assert.ok(bytes < 1024, `${bytes} bytes`);
});

test('open-draft status check carries no draft content', async () => {
  t.resetStats();
  const r = await t.api(B, 'GET', `/api/drafts/${draftId}/status`);
  assert.equal(r.status, 200);
  assert.ok(!('form_data' in r.body) && !('form_data_json' in r.body));
  assert.ok(t.stats.bytes < 600, `${t.stats.bytes} bytes`);
  assert.equal((await t.api(B, 'GET', '/api/drafts/draft_404/status')).status, 404);
});

test('cost totals stay a few rows no matter how many AI calls have been logged', async () => {
  const models = ['claude-sonnet-5', 'claude-haiku-4-5'];
  let expected = 0;
  for (let i = 0; i < 1500; i++) {
    const model = models[i % 2];
    const { rows: [g] } = await t.query(
      "INSERT INTO generation_logs (draft_id,page_type,field_key,attempt_number,model,prompt,facts_json,style_version,output,input_tokens,output_tokens) VALUES ($1,'specialization','f',1,$2,$3,'{}','v1',$4,$5,$6) RETURNING id",
      [draftId, model, 'p'.repeat(2000), 'o'.repeat(2000), 1000 + i, 200 + i]
    );
    await t.query("INSERT INTO evaluation_logs (generation_log_id,model,scores_json,overall_score,input_tokens,output_tokens) VALUES ($1,'gpt-4o','{}',8,700,90)", [g.id]);
    expected += computeCostUsd({ model, inputTokens: 1000 + i, outputTokens: 200 + i }) + computeCostUsd({ model: 'gpt-4o', inputTokens: 700, outputTokens: 90 });
  }
  t.resetStats();
  const r = await t.api(S, 'GET', '/api/costs/summary');
  assert.ok(Math.abs(r.body.totalUsd - expected) < 1e-6, `${r.body.totalUsd} vs ${expected}`);
  assert.equal(r.body.generateCalls, 1500);
  assert.equal(r.body.evaluateCalls, 1500);
  assert.ok(t.stats.bytes < 2048, `global cost summary pulled ${t.stats.bytes} bytes for 3000 logs`);

  t.resetStats();
  const d = await t.api(S, 'GET', `/api/drafts/${draftId}/cost-summary`);
  assert.ok(Math.abs(d.body.totalUsd - expected) < 1e-6);
  assert.ok(t.stats.bytes < 2048, `per-draft cost summary pulled ${t.stats.bytes} bytes (prompts/outputs must not be fetched)`);
});

test('an autosave that changes nothing does not write to the database', async () => {
  const { body } = await t.api(A, 'GET', `/api/drafts/${draftId}`);
  await t.query("UPDATE drafts SET updated_at = '2020-01-01T00:00:00Z' WHERE id = $1", [draftId]);
  t.resetStats();
  const r = await t.api(A, 'PUT', `/api/drafts/${draftId}`, { formData: body.draft.form_data });
  assert.equal(r.status, 200);
  assert.ok(!t.stats.log.some(q => /UPDATE drafts/.test(q)), 'a no-op save rewrote the draft');
  const { rows: [row] } = await t.query('SELECT updated_at FROM drafts WHERE id = $1', [draftId]);
  assert.equal(row.updated_at, '2020-01-01T00:00:00Z', '"Last Edited" must not move when nothing changed');
});

test('the list cache is never stale: create, edit, same-second edit, assign, priority, rename, delete', async () => {
  const get = async () => (await t.api(S, 'GET', '/api/drafts')).body.drafts;
  const { body } = await t.api(A, 'POST', '/api/drafts', { pageType: 'specialization' });
  const id = body.draft.id;
  assert.ok((await get()).some(d => d.id === id), 'create');

  await t.api(A, 'PUT', `/api/drafts/${id}`, { formData: { ...filled, spec_name: 'One' } });
  assert.equal((await get()).find(d => d.id === id).spec_name, 'One', 'edit');

  await t.query("UPDATE drafts SET updated_at = '2030-01-01T00:00:00Z' WHERE id = $1", [id]);
  await get();
  await t.query("UPDATE drafts SET form_data_json = replace(form_data_json, '\"One\"', '\"Two\"'), updated_at = '2030-01-01T00:00:00Z' WHERE id = $1", [id]);
  assert.equal((await get()).find(d => d.id === id).spec_name, 'Two', 'second edit with an identical timestamp');

  await t.api(S, 'PATCH', `/api/drafts/${id}/assign`, { userId: B.id });
  assert.equal((await get()).find(d => d.id === id).owner_user_id, B.id, 'assign');

  await t.query('UPDATE drafts SET prioritized_at = iso_now() WHERE id = $1', [id]);
  assert.ok((await get()).find(d => d.id === id).prioritized_at, 'priority flag');

  await t.query("UPDATE users SET name = 'Renamed B' WHERE id = $1", [B.id]);
  assert.equal((await get()).find(d => d.id === id).owner_name, 'Renamed B', 'user rename');
  await t.query("UPDATE users SET name = 'Intern B' WHERE id = $1", [B.id]);

  await t.query('DELETE FROM drafts WHERE id = $1', [id]);
  assert.ok(!(await get()).some(d => d.id === id), 'delete');
});

test('opening the notifications bell does not force everyone\'s list to refetch', async () => {
  await t.api(S, 'GET', '/api/drafts');
  await t.api(B, 'POST', '/api/notifications/mark-read', {});
  t.resetStats();
  await t.api(S, 'GET', '/api/drafts');
  assert.ok(!t.stats.log.some(q => q.includes('WITH base AS')));
});

test('the notifications cache is per user and never stale', async () => {
  const feed = async (u) => (await t.api(u, 'GET', '/api/notifications')).body.notifications;
  await feed(A); await feed(B);
  const { rows: [n] } = await t.query("INSERT INTO notifications (draft_id,type,created_by_user_id,recipient_user_id,message) VALUES ($1,'reverted_to_intern',$2,$3,'probe') RETURNING id", [draftId, S.id, A.id]);
  assert.ok((await feed(A)).some(x => x.id === n.id), 'a new notification shows on the next poll');
  assert.ok(!(await feed(B)).some(x => x.id === n.id), 'and only for its recipient');
  await t.query('DELETE FROM notifications WHERE id = $1', [n.id]);
  assert.ok(!(await feed(A)).some(x => x.id === n.id), 'a removed notification disappears');
});

test('a failed AI batch fails fast, makes no network call, and leaves the draft with the intern', async () => {
  // The cost test above logged thousands of AI calls "today", which (correctly) trips the daily AI
  // budget - clear them so this test is about the batch, not the budget (tests/limits.test.js
  // covers the budget).
  await t.query('DELETE FROM evaluation_logs');
  await t.query('DELETE FROM generation_logs');
  const id = (await t.api(A, 'POST', '/api/drafts', { pageType: 'specialization' })).body.draft.id;
  await t.api(A, 'PUT', `/api/drafts/${id}`, { formData: filled });
  const fields = [{ fieldKey: 'about_content', fieldLabel: 'About', fieldInstructions: '', outputFormat: 'markdown' }];
  const r = await t.api(A, 'POST', `/api/drafts/${id}/generate-all-fields`, { fields, facts: {} });
  assert.equal(r.status, 200);
  assert.equal(r.body.failures.length, 1);
  assert.match(r.body.failures[0].error, /ANTHROPIC_API_KEY is not set/, 'the real cause must reach the user');
  assert.equal(r.body.draft.status, 'intern_editing');
  assert.deepEqual(globalThis.__blockedRequests, []);
});
