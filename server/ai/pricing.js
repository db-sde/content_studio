import { config } from '../config.js';

// Reference USD rates, $ per 1M tokens — update alongside config.usdToInrRate when providers change
// prices. Claude rates checked against platform.claude.com/docs/en/about-claude/pricing on
// 2026-10-17: Sonnet 5's $2/$10 launch price became its standard price (the planned rise to $3/$15
// on 2026-09-01 was cancelled) - this table had still been charging every Sonnet call at $3/$15,
// overstating the cost shown in the app (and counted against the daily AI budget) by 50%.
const RATES = {
  'claude-sonnet-5': { inputPerMillion: 2.00, outputPerMillion: 10.00 },
  'claude-sonnet-5-5': { inputPerMillion: 2.00, outputPerMillion: 10.00 },
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
