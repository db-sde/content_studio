import { config } from '../config.js';

// Reference USD rates, $ per 1M tokens — update alongside config.usdToInrRate when providers change
// prices. Claude rates checked against platform.claude.com/docs/en/about-claude/pricing on
// 2026-10-17: Sonnet 5's $2/$10 launch price became its standard price (the planned rise to $3/$15
// on 2026-09-01 was cancelled) - this table had still been charging every Sonnet call at $3/$15,
// overstating the cost shown in the app (and counted against the daily AI budget) by 50%.
// cacheWrite/cacheRead: prompt caching (see providers/*). Anthropic bills a 5-minute cache write
// at 1.25x input and a read at 0.1x; OpenAI caches automatically (no write charge) and bills a read
// at half price. GPT rates are OpenAI's published gpt-4o / gpt-4o-mini prices.
const RATES = {
  'claude-sonnet-5': { inputPerMillion: 2.00, outputPerMillion: 10.00, cacheWritePerMillion: 2.50, cacheReadPerMillion: 0.20 },
  'claude-sonnet-5-5': { inputPerMillion: 2.00, outputPerMillion: 10.00, cacheWritePerMillion: 2.50, cacheReadPerMillion: 0.20 },
  'claude-haiku-4-5': { inputPerMillion: 1.00, outputPerMillion: 5.00, cacheWritePerMillion: 1.25, cacheReadPerMillion: 0.10 },
  'gpt-4o': { inputPerMillion: 2.50, outputPerMillion: 10.00, cacheWritePerMillion: 2.50, cacheReadPerMillion: 1.25 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.60, cacheWritePerMillion: 0.15, cacheReadPerMillion: 0.075 },
  // Not a model: the free deterministic checks in ai/seoChecks.js (SEO title/meta rules, empty
  // output), logged alongside real evaluations so every generation still has one.
  'rules': { inputPerMillion: 0, outputPerMillion: 0, cacheWritePerMillion: 0, cacheReadPerMillion: 0 }
};

// Used only if a model string isn't in the table above (e.g. config overridden to an unlisted
// model) — better to show a rough number than crash the cost UI.
const FALLBACK_RATE = { inputPerMillion: 3.00, outputPerMillion: 15.00, cacheWritePerMillion: 3.75, cacheReadPerMillion: 0.30 };
const warnedModels = new Set();

// inputTokens is the uncached input only - providers report cached tokens separately (see
// anthropicProvider/openaiProvider), so the three input counts never overlap.
export function computeCostUsd({ model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }) {
  const rate = RATES[model];
  if (!rate && !warnedModels.has(model)) {
    warnedModels.add(model);
    console.warn(`[pricing] no rate entry for model "${model}" — cost totals will use a default rate and may be inaccurate. Add it to RATES in server/ai/pricing.js.`);
  }
  const r = rate || FALLBACK_RATE;
  return ((inputTokens || 0) * r.inputPerMillion
    + (outputTokens || 0) * r.outputPerMillion
    + (cacheWriteTokens || 0) * r.cacheWritePerMillion
    + (cacheReadTokens || 0) * r.cacheReadPerMillion) / 1_000_000;
}

// Total cost of a list of per-model usage rows ({ model, input_tokens, output_tokens,
// cache_read_tokens, cache_write_tokens } - already summed per model by the repositories). Cost is
// linear in tokens, so summing tokens first and pricing once per model gives exactly the same total
// as pricing every individual call.
export function computeCostUsdForUsage(usageRows) {
  return usageRows.reduce((sum, row) => sum + computeCostUsd({
    model: row.model, inputTokens: row.input_tokens, outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens, cacheWriteTokens: row.cache_write_tokens
  }), 0);
}

// Same, for a provider call's own usage object ({ inputTokens, outputTokens, cacheReadTokens,
// cacheWriteTokens }) - what the orchestrator gets back from writer/editor.
export function computeCostUsdForCall(model, usage) {
  return computeCostUsd({ model, ...(usage || {}) });
}

export function usdToInr(usd) {
  return usd * config.usdToInrRate;
}
