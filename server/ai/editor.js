import Ajv from 'ajv';
import * as openaiProvider from './providers/openaiProvider.js';
import { buildEditorSystemPrompt, buildEditorUserPrompt } from './prompts/editorPrompts.js';

const SCORE_KEYS = [
  'tone', 'vocabulary', 'sentence_flow', 'readability', 'specificity',
  'factual_grounding', 'seo_readability', 'brand_voice', 'generic_language'
];

const scoreProp = { type: 'number', minimum: 0, maximum: 10 };

const EVALUATION_SCHEMA = {
  type: 'object',
  properties: {
    scores: {
      type: 'object',
      properties: Object.fromEntries(SCORE_KEYS.map(k => [k, scoreProp])),
      required: SCORE_KEYS,
      additionalProperties: false
    },
    overall: scoreProp,
    feedback: { type: 'string' }
  },
  required: ['scores', 'overall', 'feedback'],
  additionalProperties: false
};

const ajv = new Ajv();
const validate = ajv.compile(EVALUATION_SCHEMA);

const OPENAI_JSON_SCHEMA = {
  name: 'editorial_evaluation',
  strict: true,
  schema: EVALUATION_SCHEMA
};

async function requestEvaluation(params, { forceJsonReminder = false } = {}) {
  const system = buildEditorSystemPrompt(params.styleProfile) +
    (forceJsonReminder ? '\n\nYour previous response was not valid JSON matching the schema. Return ONLY the JSON object, no other text.' : '');
  const prompt = buildEditorUserPrompt(params);

  return openaiProvider.complete({
    system,
    prompt,
    maxTokens: 700,
    temperature: 0,
    timeoutMs: 30000,
    jsonSchema: OPENAI_JSON_SCHEMA
  });
}

// GPT, evaluation only. Structured Outputs (jsonSchema, strict) is the primary mechanism for
// getting valid JSON back, but that's treated as a strong hint, not a guarantee: we still
// defensively parse + schema-validate, and retry exactly once (temperature 0, explicit reminder)
// on failure. That retry is plumbing, not a semantic evaluation attempt — it doesn't count
// against the orchestrator's "max 2 evaluate calls" budget. If both attempts fail, we return an
// "errored" result so the orchestrator can fall back to returning Claude's draft ungated rather
// than blocking the user.
export async function evaluateField(params) {
  // Accumulates across both attempts — the retry still costs real tokens even though it doesn't
  // count against the orchestrator's "max 2 evaluate calls" semantic budget (see comment above).
  const totalUsage = { inputTokens: 0, outputTokens: 0 };
  const addUsage = (usage) => {
    if (!usage) return;
    totalUsage.inputTokens += usage.inputTokens || 0;
    totalUsage.outputTokens += usage.outputTokens || 0;
  };

  try {
    const { text, usage } = await requestEvaluation(params);
    addUsage(usage);
    const parsed = JSON.parse(text);
    if (validate(parsed)) return { ...parsed, status: 'ok', usage: totalUsage };
  } catch {
    // fall through to retry
  }

  try {
    const { text, usage } = await requestEvaluation(params, { forceJsonReminder: true });
    addUsage(usage);
    const retried = JSON.parse(text);
    if (validate(retried)) return { ...retried, status: 'ok', usage: totalUsage };
  } catch {
    // fall through to errored
  }

  return { scores: null, overall: 0, feedback: '', status: 'errored', usage: totalUsage };
}
