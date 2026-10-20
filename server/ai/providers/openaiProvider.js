import OpenAI from 'openai';
import { config, assertOpenAiConfigured } from '../../config.js';

// The ONLY file in this codebase that imports the openai SDK. Business logic (ai/editor.js)
// calls `complete()` and never touches the SDK directly.

let client = null;

function getClient() {
  if (!client) {
    assertOpenAiConfigured();
    client = new OpenAI({ apiKey: config.openaiApiKey });
  }
  return client;
}

// Tests swap in a fake client so no request can leave the machine (see tests/helpers/env.js).
export function __setClientForTests(fake) {
  client = fake;
}

// `jsonSchema` (optional) — pass an OpenAI Structured Outputs json_schema descriptor to force
// strict-schema JSON back. Callers still must NOT trust this blindly — see ai/editor.js.
// `cacheKey` (optional): calls that share a long prompt prefix should pass the same key - OpenAI uses
// it to send them to the server holding that prefix's cache. Measured (Oct 2026) on the editor's
// calls: an exact repeat is cached (2,176 of 2,324 tokens), but a page's calls for different fields,
// though they share their first ~2,100 tokens, were cached only occasionally, key or no key, and
// with the facts in the system message too. So it helps repeats; don't count on it across fields.
export async function complete({ system, prompt, maxTokens = 800, timeoutMs = 30000, jsonSchema = null, temperature = 0, cacheKey = null }) {
  const openai = getClient();

  const response = await openai.chat.completions.create(
    {
      model: config.openaiModel,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt }
      ],
      ...(jsonSchema ? { response_format: { type: 'json_schema', json_schema: jsonSchema } } : {}),
      ...(cacheKey ? { prompt_cache_key: cacheKey } : {})
    },
    { timeout: timeoutMs }
  );

  // OpenAI caches long prompt prefixes automatically and bills those tokens at half price.
  // prompt_tokens includes them, so they are split out here - inputTokens is the uncached part.
  const promptTokens = response.usage?.prompt_tokens || 0;
  const cachedTokens = response.usage?.prompt_tokens_details?.cached_tokens || 0;
  return {
    text: response.choices?.[0]?.message?.content || '',
    usage: {
      inputTokens: promptTokens - cachedTokens,
      outputTokens: response.usage?.completion_tokens || 0,
      cacheReadTokens: cachedTokens,
      cacheWriteTokens: 0
    }
  };
}
