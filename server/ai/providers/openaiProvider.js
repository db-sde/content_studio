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
export async function complete({ system, prompt, maxTokens = 800, timeoutMs = 30000, jsonSchema = null, temperature = 0 }) {
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
      ...(jsonSchema ? { response_format: { type: 'json_schema', json_schema: jsonSchema } } : {})
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
