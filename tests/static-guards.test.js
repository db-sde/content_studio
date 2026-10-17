// Source-level guards: they read the code and fail when a change would quietly remove a cost or
// load protection - a new AI route without the budget check, a new paid image route without the
// limiter, a poll that bypasses the idle/hidden pause, an outbound call with no timeout. Cheap,
// and they catch the mistake in the pull request rather than on the bill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const listFiles = (dir, exts) => fs.readdirSync(path.join(ROOT, dir), { recursive: true })
  .filter(f => exts.some(e => f.endsWith(e))).map(f => path.join(dir, f));

// Splits a route file into one chunk per `xxxRouter.<verb>(` definition.
function routeBlocks(file) {
  const src = read(file);
  const re = /\n\w+Router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g;
  const starts = [...src.matchAll(re)].map(m => ({ index: m.index, verb: m[1], path: m[2] }));
  return starts.map((s, i) => ({ ...s, file, body: src.slice(s.index, starts[i + 1]?.index ?? src.length) }));
}
const allRoutes = listFiles('server/routes', ['.js']).flatMap(routeBlocks);

test('every route that can call Claude/GPT is behind the daily AI budget AND a per-user rate limit', () => {
  const aiCallers = allRoutes.filter(r => /generateAndEvaluateField\(|generateAllAiFields\(|Provider\.complete\(/.test(r.body));
  assert.ok(aiCallers.length >= 3, `expected the known AI routes, found ${aiCallers.map(r => r.path)}`);
  for (const r of aiCallers) {
    assert.match(r.body, /requireAiBudget/, `${r.file} ${r.verb.toUpperCase()} ${r.path} calls an AI model without requireAiBudget`);
    assert.match(r.body, /rateLimit\(/, `${r.file} ${r.verb.toUpperCase()} ${r.path} calls an AI model without a rate limit`);
  }
});

test('every route that triggers a paid image generation uses the shared image limiter', () => {
  const imageCallers = allRoutes.filter(r => /\b(generateImages|generateImagesFromDocx|regenerateImage)\(/.test(r.body));
  assert.ok(imageCallers.length >= 5, `expected the known image routes, found ${imageCallers.map(r => r.path)}`);
  for (const r of imageCallers) {
    assert.match(r.body, /imageGenerationLimiter/, `${r.file} ${r.verb.toUpperCase()} ${r.path} starts a paid image job without imageGenerationLimiter`);
  }
});

test('every authenticated route group goes through the per-user request limiter', () => {
  const app = read('server/app.js');
  const mounts = [...app.matchAll(/app\.use\('\/api\/(?!auth)[^']+',\s*([^)]+)\)/g)].map(m => m[1]);
  assert.ok(mounts.length >= 9);
  for (const m of mounts) assert.match(m, /\.\.\.authed/, `route group mounted without the authed (requireAuth + apiRequestLimiter) chain: ${m}`);
  assert.match(app, /const authed = \[requireAuth, apiRequestLimiter\]/);
});

test('the per-field AI pipeline is hard-capped at 2 generate + 2 evaluate calls', () => {
  const src = read('server/ai/orchestrator.js');
  assert.equal((src.match(/writer\.generateField\(/g) || []).length, 2, 'orchestrator.js must call the writer at most twice per field');
  // Every evaluation goes through evaluateAttempt (GPT editor, or free rules for SEO fields).
  assert.equal((src.match(/await evaluateAttempt\(/g) || []).length, 2, 'orchestrator.js must evaluate at most twice per field');
  assert.equal((src.match(/editor\.evaluateField\(/g) || []).length, 1, 'the GPT editor is only reached through evaluateAttempt');
  assert.ok(!/\b(while|for)\s*\(/.test(src), 'no loops around model calls in the orchestrator');
  const batch = read('server/ai/batchGenerate.js');
  const concurrency = Number(batch.match(/const CONCURRENCY = (\d+)/)[1]);
  assert.ok(concurrency <= 3, `batch concurrency ${concurrency}`);
  // One prompt-cache warm-up per batch, outside the per-field pool.
  assert.equal((batch.match(/warmPageCache\(/g) || []).length, 1);
  assert.equal((batch.match(/await warmPromptCache\(/g) || []).length, 1);
  assert.ok(batch.indexOf('await warmPromptCache(') < batch.indexOf('runWithConcurrencyLimit(toGenerate'), 'the warm-up must run before the fields start');
});

test('prompt caching stays in place: per-field text is outside the cached prefix', () => {
  const provider = read('server/ai/providers/anthropicProvider.js');
  assert.equal((provider.match(/cache_control: CACHE_BREAKPOINT/g) || []).length, 2, 'system prompt and facts are the two cache breakpoints');
  assert.doesNotMatch(provider, /ttl:/, '1-hour cache writes cost 2x; a batch finishes well inside the default 5 minutes');
  const writer = read('server/ai/writer.js');
  assert.match(writer, /cachedPrefix = buildWriterFactsBlock\(facts\)/);
  assert.doesNotMatch(writer, /anthropicCheapModel|CHEAP_MODEL/, 'a second writer model would need its own cache');
  // Nothing time- or request-dependent may enter the cached part of the prompt.
  const prompts = read('server/ai/prompts/writerPrompts.js');
  const cachedBuilders = prompts.slice(0, prompts.indexOf('export function buildWriterUserPrompt'));
  assert.doesNotMatch(cachedBuilders, /Date|random|uuid|fieldLabel|fieldInstructions/i);
});

test('every model call has a timeout and a token ceiling', () => {
  for (const f of ['server/ai/providers/anthropicProvider.js', 'server/ai/providers/openaiProvider.js']) {
    const src = read(f);
    assert.match(src, /timeout: timeoutMs/, `${f} must pass a timeout`);
    assert.match(src, /max_tokens: maxTokens/, `${f} must pass max_tokens`);
  }
  const writer = read('server/ai/writer.js');
  for (const m of writer.matchAll(/maxTokens = [^;]+/g)) for (const n of m[0].match(/\d+/g)) assert.ok(Number(n) <= 4096, `writer maxTokens ${n}`);
});

test('every outbound HTTP call to an outside service has a deadline', () => {
  for (const f of listFiles('server/integrations', ['.js'])) {
    const src = read(f);
    const rawFetches = [...src.matchAll(/await fetch\(/g)].length;
    const guarded = [...src.matchAll(/signal: AbortSignal\.timeout\(/g)].length;
    assert.ok(rawFetches <= guarded, `${f}: ${rawFetches} fetch() calls but only ${guarded} with a timeout`);
  }
});

test('the database pool kills runaway queries and gives up connecting', () => {
  const src = read('server/db/pgPool.js');
  assert.match(src, /statement_timeout: config\.limits\.dbStatementTimeoutMs/);
  assert.match(src, /connectionTimeoutMillis: config\.limits\.dbConnectTimeoutMs/);
});

test('polled endpoints never fetch full log rows (prompts/outputs)', () => {
  const drafts = read('server/routes/drafts.js');
  for (const r of routeBlocks('server/routes/drafts.js').concat(routeBlocks('server/routes/costs.js'))) {
    if (/getGenerationLogsByDraft|getEvaluationLogsByDraft|getAllGenerationLogs|getAllEvaluationLogs/.test(r.body)) {
      assert.equal(r.path, '/:id/full-export', `${r.file} ${r.path} pulls whole log rows; use the *Usage* aggregates instead`);
    }
  }
  assert.ok(drafts.includes("'/:id/full-export'"));
});

test('no polling outside useActivePolling (the idle/hidden-aware hook), except the known two', () => {
  const allowed = {
    'src/utils/useActivePolling.js': 1,             // the hook itself
    'src/App.jsx': 1,                               // autosave (skips when nothing changed)
    'src/components/ImageGenerationPanel.jsx': 1    // a running image job, capped at 5 minutes
  };
  for (const f of listFiles('src', ['.js', '.jsx'])) {
    const n = (read(f).match(/setInterval\(/g) || []).length;
    assert.ok(n <= (allowed[f] || 0), `${f} has ${n} setInterval() - new polling must go through useActivePolling`);
  }
  assert.match(read('src/components/ImageGenerationPanel.jsx'), /MAX_POLL_MS/, 'the image job poll must keep its time cap');
});

test('the image service makes exactly one image per call, on the agreed model', () => {
  const flux = read('image_pipeline/app/providers/flux_provider.py');
  assert.match(flux, /"num_images": 1,/);
  assert.match(flux, /fal-ai\/flux\/dev/);
  const tasks = read('image_pipeline/app/tasks/generation_tasks.py');
  const attempts = Number(tasks.match(/_MAX_ATTEMPTS_PER_PROVIDER = (\d+)/)[1]);
  assert.ok(attempts <= 2, `retries per provider: ${attempts}`);
});

test('tests can never read the real .env', () => {
  assert.match(read('tests/helpers/env.js'), /DOTENV_CONFIG_PATH = '\/nonexistent/);
});
