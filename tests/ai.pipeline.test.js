// The AI pipeline's cost shape, end to end through the real routes, with fake Claude and GPT
// clients (nothing leaves the machine). Pins what makes a page cheap: one cache warm-up per page,
// every field reading the same cached prefix, no GPT call for the SEO fields, at most 2 writes +
// 2 evaluations per field - and that the cost shown in the app prices cached tokens correctly.
import './helpers/env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, completeSpecializationFormData } from './helpers/testApp.js';
import { __setClientForTests as setAnthropicClient } from '../server/ai/providers/anthropicProvider.js';
import { __setClientForTests as setOpenAiClient } from '../server/ai/providers/openaiProvider.js';
import { computeCostUsd } from '../server/ai/pricing.js';
import { checkSeoField, checkSeoCandidates, mentions } from '../server/ai/seoChecks.js';
import { schemas } from '../src/config/schemas.js';

const SPEC_NAME = 'Online MBA in Marketing Management';
const UNIVERSITY = 'Test University Online';
const GOOD_TITLE = `${SPEC_NAME} | ${UNIVERSITY}`; // 59 characters
const GOOD_META = `Study the ${SPEC_NAME} at ${UNIVERSITY}: flexible classes, live sessions and a UGC-entitled degree.`; // 130 characters

// Token counts the fakes report, so expected costs can be computed exactly.
const WARMUP_USAGE = { input_tokens: 3, output_tokens: 0, cache_creation_input_tokens: 3200, cache_read_input_tokens: 0 };
const FIELD_USAGE = { input_tokens: 150, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 3200 };
const GPT_USAGE = { prompt_tokens: 2500, completion_tokens: 180, prompt_tokens_details: { cached_tokens: 2000 } };

let t, intern, senior, draftId, fields, facts;
const claudeCalls = [];
const gptCalls = [];
let claudeText = () => 'A grounded paragraph about the program.';
let gptOverall = 8.5;

const lastText = (body) => {
  const content = body.messages[0].content;
  return Array.isArray(content) ? content.at(-1).text : content;
};

before(async () => {
  setAnthropicClient({
    messages: {
      create: async (body, options) => {
        claudeCalls.push({ body, options });
        if (body.max_tokens === 0) return { content: [], stop_reason: 'max_tokens', usage: WARMUP_USAGE };
        const reply = claudeText(lastText(body));
        // A reply object { text, cutOff } simulates hitting max_tokens mid-text.
        const { text, cutOff } = typeof reply === 'string' ? { text: reply, cutOff: false } : reply;
        return { content: [{ type: 'text', text }], stop_reason: cutOff ? 'max_tokens' : 'end_turn', usage: FIELD_USAGE };
      }
    }
  });
  setOpenAiClient({
    chat: {
      completions: {
        create: async (body) => {
          gptCalls.push(body);
          const scores = Object.fromEntries(['tone', 'vocabulary', 'sentence_flow', 'readability', 'specificity',
            'factual_grounding', 'seo_readability', 'brand_voice', 'generic_language'].map(k => [k, gptOverall]));
          return { choices: [{ message: { content: JSON.stringify({ scores, overall: gptOverall, feedback: 'Tighten the second sentence.' }) } }], usage: GPT_USAGE };
        }
      }
    }
  });

  t = await startTestApp();
  intern = await t.createUser('Intern P', 'intern');
  senior = await t.createUser('Senior P', 'senior');

  const filled = await completeSpecializationFormData({ spec_name: SPEC_NAME, university_name: UNIVERSITY });
  const { body } = await t.api(intern, 'POST', '/api/drafts', { pageType: 'specialization' });
  draftId = body.draft.id;
  await t.api(intern, 'PUT', `/api/drafts/${draftId}`, { formData: filled });

  // Built exactly the way App.jsx builds them.
  fields = [];
  facts = {};
  for (const sec of schemas.specialization.sections) for (const f of sec.fields) {
    if (f.aiAssist) {
      fields.push({
        fieldKey: f.key, fieldLabel: f.label, fieldInstructions: f.aiAssist.instructions,
        outputFormat: f.type === 'RICH_TEXT' ? 'markdown' : f.type === 'TEXT_INPUT' ? 'plain-short' : 'plain'
      });
    } else if (!['faqs', 'reviews'].includes(f.key)) {
      facts[f.key] = filled[f.key];
    }
  }
});

beforeEach(() => {
  claudeCalls.length = 0;
  gptCalls.length = 0;
  gptOverall = 8.5;
  claudeText = (prompt) => {
    if (prompt.includes('"SEO Title"')) return GOOD_TITLE;
    if (prompt.includes('"Meta Description"')) return GOOD_META;
    return 'A grounded paragraph about the program.';
  };
});

after(async () => {
  setAnthropicClient(null);
  setOpenAiClient(null);
  assert.deepEqual(globalThis.__blockedRequests, [], 'a test tried to reach an outside service');
  await t.close();
});

test('Generate All: one cache warm-up, then every field reads the same cached prefix', async () => {
  const r = await t.api(intern, 'POST', `/api/drafts/${draftId}/generate-all-fields`, { fields, facts, onlyEmpty: false });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.failures, []);

  const [warmup, ...fieldCalls] = claudeCalls;
  assert.equal(warmup.body.max_tokens, 0, 'the first Claude call is the warm-up');
  assert.equal(claudeCalls.filter(c => c.body.max_tokens === 0).length, 1, 'exactly one warm-up per page');
  assert.equal(fieldCalls.length, fields.length, 'one Claude call per field when every draft passes');

  for (const { body, options } of fieldCalls) {
    assert.equal(body.model, warmup.body.model, 'all fields on one model, so they share one cache');
    assert.deepEqual(body.system, warmup.body.system, 'system prompt identical to the warm-up');
    const [factsBlock, fieldBlock] = body.messages[0].content;
    assert.deepEqual(factsBlock, warmup.body.messages[0].content[0], 'facts block identical to the warm-up');
    assert.deepEqual(body.system[0].cache_control, { type: 'ephemeral' });
    assert.deepEqual(factsBlock.cache_control, { type: 'ephemeral' });
    assert.equal(fieldBlock.cache_control, undefined, 'the per-field part is never cached');
    assert.ok(factsBlock.text.startsWith('<structured_facts>\n{"'), 'facts are compact JSON');
    assert.ok(options.timeout > 0);
    assert.ok(body.max_tokens > 0 && body.max_tokens <= 4096);
  }
  const labels = fieldCalls.map(c => c.body.messages[0].content[1].text.match(/write the "([^"]+)" field/)[1]);
  assert.deepEqual(labels.sort(), fields.map(f => f.fieldLabel).sort());

  // GPT only scores the narrative fields; the SEO title/meta are checked by rules.
  assert.equal(gptCalls.length, fields.length - 2);
  assert.ok(!gptCalls.some(c => /SEO Title|Meta Description/.test(c.messages[1].content)));
  const gptFactsPrefix = (c) => c.messages[1].content.slice(0, c.messages[1].content.indexOf('</structured_facts>'));
  assert.ok(gptCalls.every(c => c.messages[1].content.startsWith('<structured_facts>')), 'facts first, so OpenAI can cache them');
  assert.equal(new Set(gptCalls.map(gptFactsPrefix)).size, 1);
  assert.equal(new Set(gptCalls.map(c => c.messages[0].content)).size, 1, 'one evaluator system prompt for every field');
  // One OpenAI cache key for the whole page, so its scoring calls land where the prefix is cached.
  assert.equal(new Set(gptCalls.map(c => c.prompt_cache_key)).size, 1);
  assert.match(gptCalls[0].prompt_cache_key, /^editor-[0-9a-f]{24}$/);
  // First drafts are written as before: the "write it directly" nudge is only for rewrites (and SEO lists).
  const narrativeFirstDrafts = fieldCalls.filter(c => !/"(SEO Title|Meta Description)"/.test(c.body.messages[0].content[1].text));
  assert.ok(narrativeFirstDrafts.length && narrativeFirstDrafts.every(c => !/without extended deliberation/.test(c.body.messages[0].content[1].text)));

  const { rows: seoEvals } = await t.query(
    "SELECT e.model, e.status, g.field_key FROM evaluation_logs e JOIN generation_logs g ON g.id = e.generation_log_id WHERE g.draft_id = $1 AND g.field_key IN ('seo_title', 'meta_description')",
    [draftId]
  );
  assert.deepEqual(seoEvals.map(e => e.model), ['rules', 'rules']);

  const { rows: logged } = await t.query(
    "SELECT field_key, attempt_number, input_tokens, cache_read_tokens, cache_write_tokens FROM generation_logs WHERE draft_id = $1 AND attempt_number = 0",
    [draftId]
  );
  assert.equal(logged.length, 1, 'the warm-up is logged, since it is billed');
  assert.equal(logged[0].cache_write_tokens, WARMUP_USAGE.cache_creation_input_tokens);

  // The cost shown in the app: cached tokens priced at their own rates, the warm-up included but
  // not counted as a "generate call".
  const sonnet = t.config.anthropicModel;
  const expected =
    computeCostUsd({ model: sonnet, inputTokens: 3, cacheWriteTokens: 3200 })
    + fields.length * computeCostUsd({ model: sonnet, inputTokens: 150, outputTokens: 300, cacheReadTokens: 3200 })
    + (fields.length - 2) * computeCostUsd({ model: 'gpt-4o', inputTokens: 500, outputTokens: 180, cacheReadTokens: 2000 });
  const cost = await t.api(intern, 'GET', `/api/drafts/${draftId}/cost-summary`);
  assert.equal(cost.body.generateCalls, fields.length);
  assert.equal(cost.body.evaluateCalls, fields.length);
  assert.ok(Math.abs(cost.body.totalUsd - expected) < 1e-9, `${cost.body.totalUsd} vs ${expected}`);
  // Same pricing in the all-drafts total and in today's spend that the daily budget checks.
  const global = await t.api(intern, 'GET', '/api/costs/summary');
  assert.ok(Math.abs(global.body.totalUsd - expected) < 1e-9, `global ${global.body.totalUsd} vs ${expected}`);
  assert.ok(Math.abs(global.body.today.spentUsd - expected) < 1e-9, `today ${global.body.today.spentUsd} vs ${expected}`);
});

test('an SEO title over the limit gets one rewrite with the exact reason, and no GPT call', async () => {
  let n = 0;
  claudeText = () => (++n === 1 ? `${GOOD_TITLE} - Admissions Open for the 2027 Batch` : GOOD_TITLE);
  const title = fields.find(f => f.fieldKey === 'seo_title');
  const r = await t.api(senior, 'POST', '/api/ai/generate-field', {
    draftId, pageType: 'specialization', ...title, facts, mode: 'regenerate', existingContent: GOOD_TITLE
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(claudeCalls.length, 2);
  assert.ok(claudeCalls.every(c => c.body.max_tokens > 0), 'no warm-up for a single field');
  assert.match(claudeCalls[1].body.messages[0].content[1].text, /the limit is 60/);
  assert.equal(gptCalls.length, 0);
  assert.equal(r.body.content, GOOD_TITLE);
  assert.equal(r.body.evaluation.method, 'rules');
  assert.equal(r.body.evaluation.passed, true);
  assert.equal(r.body.attemptsUsed, 2);
});

test('SEO fields ask for 3 versions and keep the longest that passes - no rewrite needed', async () => {
  claudeText = () => ['MBA Marketing | Test University', `${GOOD_TITLE} - Admissions Open 2027`, `3. ${GOOD_TITLE}`].join('\n');
  const title = fields.find(f => f.fieldKey === 'seo_title');
  const r = await t.api(senior, 'POST', '/api/ai/generate-field', { draftId, pageType: 'specialization', ...title, facts, mode: 'generate' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(claudeCalls[0].body.messages[0].content[1].text, /Write 3 different versions, one per line/);
  assert.match(claudeCalls[0].body.messages[0].content[1].text, /Don't count characters.*without extended deliberation/, 'without these Sonnet thinks for hundreds of tokens');
  assert.equal(claudeCalls.length, 1);
  assert.equal(r.body.content, GOOD_TITLE, 'the longest version that fits, list marker stripped; the over-long one skipped');
  assert.equal(r.body.attemptsUsed, 1);
});

test('an empty draft (all thinking, no text) is not scored, is rewritten once, and is never saved blank', async () => {
  const about = fields.find(f => f.outputFormat === 'markdown');
  let n = 0;
  claudeText = () => (++n === 1 ? '' : 'A grounded paragraph about the program.');
  const r = await t.api(senior, 'POST', '/api/ai/generate-field', { draftId, pageType: 'specialization', ...about, facts, mode: 'generate' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(claudeCalls.length, 2);
  assert.equal(gptCalls.length, 1, 'only the non-empty rewrite is sent to GPT');
  assert.match(claudeCalls[1].body.messages[0].content[1].text, /produced no usable text/);
  assert.match(r.body.content, /grounded paragraph/);

  claudeCalls.length = 0;
  gptCalls.length = 0;
  claudeText = () => '';
  const { rows: before } = await t.query('SELECT COUNT(*)::int AS n FROM generation_logs WHERE draft_id = $1', [draftId]);
  const failed = await t.api(senior, 'POST', '/api/ai/generate-field', { draftId, pageType: 'specialization', ...about, facts, mode: 'generate' });
  assert.equal(failed.status, 500);
  assert.match(failed.body.error || '', /no text .* twice/);
  assert.equal(claudeCalls.length, 2);
  assert.equal(gptCalls.length, 0);
  const { rows: afterRows } = await t.query('SELECT COUNT(*)::int AS n FROM generation_logs WHERE draft_id = $1', [draftId]);
  assert.equal(afterRows[0].n - before[0].n, 2, 'both billed attempts are still logged');
});

test('text cut off by the token cap is never used: half a paragraph is rewritten, a half SEO line dropped', async () => {
  const about = fields.find(f => f.outputFormat === 'markdown');
  let n = 0;
  claudeText = () => (++n === 1 ? { text: 'A grounded paragraph that stops mid-sen', cutOff: true } : 'A complete grounded paragraph.');
  const r = await t.api(senior, 'POST', '/api/ai/generate-field', { draftId, pageType: 'specialization', ...about, facts, mode: 'generate' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(claudeCalls.length, 2);
  assert.equal(gptCalls.length, 1, 'the cut-off draft is not sent to GPT');
  assert.match(r.body.content, /complete grounded paragraph/);

  claudeCalls.length = 0;
  claudeText = () => ({ text: `${GOOD_TITLE}\nMBA Marketing | Test University\nOnline MBA in Marketing Man`, cutOff: true });
  const title = fields.find(f => f.fieldKey === 'seo_title');
  const seo = await t.api(senior, 'POST', '/api/ai/generate-field', { draftId, pageType: 'specialization', ...title, facts, mode: 'generate' });
  assert.equal(seo.body.content, GOOD_TITLE);
  assert.equal(claudeCalls.length, 1);
  assert.equal(claudeCalls[0].body.max_tokens, 512);
});

test('a narrative field that scores low is rewritten once - never more than 2 + 2 calls', async () => {
  gptOverall = 5;
  const about = fields.find(f => f.outputFormat === 'markdown');
  const r = await t.api(senior, 'POST', '/api/ai/generate-field', { draftId, pageType: 'specialization', ...about, facts, mode: 'generate' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(claudeCalls.length, 2);
  assert.equal(gptCalls.length, 2);
  assert.equal(r.body.attemptsUsed, 2);
  assert.match(claudeCalls[1].body.messages[0].content[1].text, /Tighten the second sentence/);
  assert.match(claudeCalls[1].body.messages[0].content[1].text, /Write it directly, without extended deliberation/, 'rewrites were where Sonnet most often thought until it ran out');
  assert.equal(gptCalls[0].prompt_cache_key, gptCalls[1].prompt_cache_key, 'the rewrite is scored with the same cache key');
  assert.deepEqual(claudeCalls[1].body.messages[0].content[0], claudeCalls[0].body.messages[0].content[0], 'the rewrite reads the same cached facts');
});

test('SEO rules: length, names the page, plain single line', () => {
  const titleField = { fieldKey: 'seo_title', fieldLabel: 'SEO Title', fieldInstructions: 'Write an SEO title (max 60 characters) including the specialization name and university.' };
  const specFacts = { spec_name: SPEC_NAME, university_name: UNIVERSITY };
  assert.equal(checkSeoField({ ...titleField, content: GOOD_TITLE, facts: specFacts }).passed, true);

  const long = checkSeoField({ ...titleField, content: `${GOOD_TITLE} 2027`, facts: specFacts });
  assert.equal(long.passed, false);
  assert.match(long.feedback, /64 characters; the limit is 60/);

  assert.match(checkSeoField({ ...titleField, content: `${SPEC_NAME} | Online Degree`, facts: specFacts }).feedback, /university name/);
  assert.match(checkSeoField({ ...titleField, content: `"${SPEC_NAME} | Test University"`, facts: specFacts }).feedback, /no quotes/);
  assert.match(checkSeoField({ ...titleField, content: `SEO Title: MBA Marketing | Test University`, facts: specFacts }).feedback, /no label/);

  // A long official name can't fit in 60 characters; its distinctive words are enough.
  assert.ok(mentions('Online MBA | Guru Jambheshwar University', 'Guru Jambheshwar University of Science and Technology'));
  assert.ok(!mentions('Online MBA | Top University', 'Guru Jambheshwar University of Science and Technology'));
  assert.ok(mentions('MBA Banking and Insurance | Chandigarh University', 'MBA in Banking & Insurance'));
  assert.ok(mentions('Online MCA in AI & Machine Learning - SMU Online', 'Sikkim Manipal University Online'), 'acronym');
  assert.ok(mentions('Online MBA | GJUST', 'Guru Jambheshwar University of Science and Technology'), 'acronym skips "of"/"and"');
  assert.ok(!mentions('Online MBA | SMU', 'Symbiosis University'), 'a different acronym is not a match');

  // The limit comes from the field's own instructions; a university page names only the university.
  const meta = { fieldKey: 'meta_description', fieldLabel: 'Meta Description', fieldInstructions: 'Write an SEO meta description (max 155 characters) summarizing this page.' };
  const uniFacts = { university_name: 'NMIMS' };
  const metaText = 'NMIMS online degrees: UGC-entitled MBA, BBA and more, with live classes, flexible exams and placement support for working learners.';
  assert.equal(checkSeoField({ ...meta, content: metaText, facts: uniFacts }).passed, true);
  assert.match(checkSeoField({ ...meta, content: `${metaText} Apply today for the January session.`, facts: uniFacts }).feedback, /the limit is 155/);

  // When no version passes, the rewrite is told what was wrong with each one.
  const none = checkSeoCandidates({ ...titleField, content: `${GOOD_TITLE} 2027\n${SPEC_NAME} | Online Degree`, facts: specFacts });
  assert.equal(none.passed, false);
  assert.match(none.feedback, /None of the 2 versions passed\. Version 1 .*the limit is 60.* Version 2 .*university name/);
});

test('cached tokens are priced at their own rates', () => {
  const M = 1_000_000;
  assert.equal(computeCostUsd({ model: 'claude-sonnet-5', cacheReadTokens: M }), 0.20);
  assert.equal(computeCostUsd({ model: 'claude-sonnet-5', cacheWriteTokens: M }), 2.50);
  assert.equal(computeCostUsd({ model: 'gpt-4o', cacheReadTokens: M }), 1.25);
  assert.equal(computeCostUsd({ model: 'rules', inputTokens: M, outputTokens: M }), 0);
});
