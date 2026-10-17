import { config } from '../config.js';

// Reference USD rates, $ per 1M tokens — approximate, drifts with the market; update alongside
// config.usdToInrRate rather than treating these as exact.
const RATES = {
  'claude-sonnet-5': { inputPerMillion: 3.00, outputPerMillion: 15.00 },
  'claude-haiku-4-5': { inputPerMillion: 1.00, outputPerMillion: 5.00 },
  'gpt-4o': { inputPerMillion: 2.50, outputPerMillion: 10.00 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.60 }
};

// Used only if a model string isn't in the table above (e.g. config overridden to an unlisted
// model) — better to show a rough number than crash the cost UI.
const FALLBACK_RATE = { inputPerMillion: 3.00, outputPerMillion: 15.00 };
const warnedModels = new Set();

export function computeCostUsd({ model, inputTokens, outputTokens }) {
  const rate = RATES[model];
  if (!rate && !warnedModels.has(model)) {
    warnedModels.add(model);
    console.warn(`[pricing] no rate entry for model "${model}" — cost totals will use a default rate and may be inaccurate. Add it to RATES in server/ai/pricing.js.`);
  }
  const effectiveRate = rate || FALLBACK_RATE;
  return ((inputTokens || 0) / 1_000_000) * effectiveRate.inputPerMillion + ((outputTokens || 0) / 1_000_000) * effectiveRate.outputPerMillion;
}

// Total cost of a list of per-model usage rows ({ model, input_tokens, output_tokens } - already
// summed per model by the repositories). Cost is linear in tokens, so summing tokens first and
// pricing once per model gives exactly the same total as pricing every individual call.
export function computeCostUsdForUsage(usageRows) {
  return usageRows.reduce((sum, row) => sum + computeCostUsd({
    model: row.model, inputTokens: row.input_tokens, outputTokens: row.output_tokens
  }), 0);
}

export function usdToInr(usd) {
  return usd * config.usdToInrRate;
}
