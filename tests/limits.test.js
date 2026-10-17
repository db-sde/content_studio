// Every ceiling that protects money or capacity (config.limits) actually stops the thing it's for.
// Run with deliberately tiny limits (helpers/tight-limits-env.js).
import './helpers/env.js';
import './helpers/tight-limits-env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, startImagePipelineStub, completeSpecializationFormData } from './helpers/testApp.js';
import { __resetRateLimitsForTests } from '../server/middleware/rateLimit.js';
import { __resetLoginThrottleForTests } from '../server/routes/auth.js';
import { hashPassword } from '../server/utils/passwords.js';
import { startOfUtcDay } from '../server/ai/budget.js';
import { computeCostUsd } from '../server/ai/pricing.js';

let t, stub, A, S1, S2, filled;

before(async () => {
  t = await startTestApp();
  stub = await startImagePipelineStub();
  A = await t.createUser('Intern A', 'intern');
  S1 = await t.createUser('Senior One', 'senior');
  S2 = await t.createUser('Senior Two', 'senior');
  filled = await completeSpecializationFormData();
});
beforeEach(() => { __resetRateLimitsForTests(); __resetLoginThrottleForTests(); });
after(async () => {
  assert.deepEqual(globalThis.__blockedRequests, [], 'a test tried to reach an outside service');
  await stub.close();
  await t.close();
});

async function draftIn(status) {
  const id = (await t.api(A, 'POST', '/api/drafts', { pageType: 'specialization' })).body.draft.id;
  await t.query('UPDATE drafts SET form_data_json = $1, status = $2 WHERE id = $3', [JSON.stringify(filled), status, id]);
  return id;
}
async function logAiSpend({ usd, at }) {
  // Derived from the live pricing table so this keeps meaning "$usd worth" if rates change.
  const perMillionOutput = computeCostUsd({ model: 'claude-sonnet-5', inputTokens: 0, outputTokens: 1_000_000 });
  const outputTokens = Math.ceil((usd / perMillionOutput) * 1_000_000);
  await t.query(
    "INSERT INTO generation_logs (draft_id,page_type,field_key,attempt_number,model,prompt,facts_json,style_version,output,input_tokens,output_tokens,created_at) VALUES ('x','course','f',1,'claude-sonnet-5','p','{}','v1','o',0,$1,$2)",
    [outputTokens, at]
  );
}

// ---------------------------------------------------------------- daily AI budget
test('under the daily AI budget, AI requests go through', async () => {
  await t.query('DELETE FROM generation_logs');
  const id = await draftIn('intern_editing');
  const r = await t.api(A, 'POST', `/api/drafts/${id}/generate-all-fields`, { fields: [{ fieldKey: 'about_content', fieldLabel: 'About', outputFormat: 'markdown' }], facts: {} });
  assert.equal(r.status, 200); // the provider then fails only because the test has no API key
});

test('spend from earlier days does not count against today', async () => {
  await t.query('DELETE FROM generation_logs');
  await logAiSpend({ usd: 100, at: '2020-01-01T10:00:00Z' });
  const id = await draftIn('intern_editing');
  assert.notEqual((await t.api(A, 'POST', `/api/drafts/${id}/generate-all-fields`, { fields: [{ fieldKey: 'x' }], facts: {} })).status, 429);
});

test('once today\'s spend reaches the budget, every AI route refuses before calling any model', async () => {
  await t.query('DELETE FROM generation_logs');
  await logAiSpend({ usd: 0.06, at: startOfUtcDay() });
  const before = (await t.query('SELECT count(*)::int n FROM generation_logs')).rows[0].n;

  const id = await draftIn('intern_editing');
  let r = await t.api(A, 'POST', `/api/drafts/${id}/generate-all-fields`, { fields: [{ fieldKey: 'about_content' }], facts: {} });
  assert.equal(r.status, 429);
  assert.match(r.body.error, /AI spending limit of \$0\.05/);

  const rid = await draftIn('senior_review');
  r = await t.api(S1, 'POST', '/api/ai/generate-field', { draftId: rid, pageType: 'specialization', fieldKey: 'about_content', fieldLabel: 'About' });
  assert.equal(r.status, 429, 'per-field regenerate must be capped too');
  r = await t.api(S1, 'POST', '/api/ai/test-generate', {});
  assert.equal(r.status, 429, 'the provider smoke-test endpoint must be capped too');

  assert.equal((await t.query('SELECT count(*)::int n FROM generation_logs')).rows[0].n, before, 'no model call should have been attempted');

  const summary = (await t.api(S1, 'GET', '/api/costs/summary')).body;
  assert.ok(summary.today.spentUsd >= 0.06 && summary.today.budgetUsd === 0.05, JSON.stringify(summary.today));
  await t.query('DELETE FROM generation_logs');
});

// ---------------------------------------------------------------- image generation
test('image generation is capped per user per hour across every image route', async () => {
  const id = await draftIn('admin_review');
  const before = stub.calls.filter(c => c.startsWith('POST')).length;
  assert.equal((await t.api(S1, 'POST', `/api/drafts/${id}/generate-images`)).status, 202);
  assert.equal((await t.api(S1, 'POST', `/api/drafts/${id}/regenerate-image`, { imageId: 1 })).status, 200);
  assert.equal((await t.api(S1, 'POST', '/api/image-pipeline/generate-images', { pageJson: { program_name: 'x' }, pageType: 'course' })).status, 202);
  const fourth = await t.api(S1, 'POST', '/api/image-pipeline/regenerate-image', { imageId: 1 });
  assert.equal(fourth.status, 429);
  assert.match(fourth.body.error, /Image generation limit reached \(3 per hour\)/);
  assert.equal(stub.calls.filter(c => c.startsWith('POST')).length - before, 3, 'exactly 3 paid generations reached the image service');

  assert.equal((await t.api(S2, 'POST', `/api/drafts/${id}/generate-images`)).status, 202, 'another user has their own allowance');
});

test('a hung image service times out instead of holding the request open', async () => {
  await stub.close();
  const slow = await startImagePipelineStub({ delayMs: 2000 });
  const id = await draftIn('admin_review');
  const started = Date.now();
  const r = await t.api(S1, 'POST', `/api/drafts/${id}/generate-images`);
  const took = Date.now() - started;
  await slow.close();
  stub = await startImagePipelineStub(); // restore a fast stub for anything after this
  assert.equal(r.status, 504);
  assert.match(r.body.error, /didn't respond within/);
  assert.ok(took < 1500, `took ${took}ms with a 400ms timeout`);
});

// ---------------------------------------------------------------- request rate
test('a runaway client is cut off per user, without affecting anyone else', async () => {
  let last;
  for (let i = 0; i < 40; i++) last = await t.api(S1, 'GET', '/api/notifications');
  assert.equal(last.status, 200);
  const blocked = await t.api(S1, 'GET', '/api/notifications');
  assert.equal(blocked.status, 429);
  assert.equal((await t.api(S2, 'GET', '/api/notifications')).status, 200);
});

// ---------------------------------------------------------------- sign-in
test('repeated failed sign-ins pause that account only; a success clears the count', async () => {
  const email = 'login.test@degreebaba.com';
  await t.query("INSERT INTO users (name,email,password_hash,role) VALUES ('Login Test',$1,$2,'intern')", [email, hashPassword('correct-password')]);
  const login = (e, p) => t.api(null, 'POST', '/api/auth/login', { email: e, password: p });

  assert.equal((await login(email, 'wrong')).status, 401);
  assert.equal((await login(email, 'wrong')).status, 401);
  assert.equal((await login(email, 'correct-password')).status, 200, 'a real user who mistyped is not locked out');
  assert.equal((await login(email, 'wrong')).status, 401, 'success reset the count');

  await login(email, 'wrong'); await login(email, 'wrong');
  const paused = await login(email, 'correct-password');
  assert.equal(paused.status, 429, 'after 3 failures even the right password waits');
  assert.match(paused.body.error, /Too many failed sign-in attempts/);
  assert.equal((await login('someone.else@degreebaba.com', 'x')).status, 401, 'other accounts are unaffected');
});
