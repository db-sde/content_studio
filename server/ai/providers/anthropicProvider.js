import Anthropic from '@anthropic-ai/sdk';
import { config, assertAnthropicConfigured } from '../../config.js';

// The ONLY file in this codebase that imports @anthropic-ai/sdk. Business logic (ai/writer.js)
// calls `complete()` and never touches the SDK directly.

let client = null;

function getClient() {
  if (!client) {
    assertAnthropicConfigured();
    client = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return client;
}

// Tests swap in a fake client so no request can leave the machine (see tests/helpers/env.js).
export function __setClientForTests(fake) {
  client = fake;
}

// Prompt caching. `cachedPrefix` is the part of the user message that many calls share word for
// word - a page's facts, the same for every field on that page. When it is given, the system prompt
// and the prefix are each marked as a cache breakpoint and `prompt` (this call's own instructions)
// follows uncached, so every call after the first pays a tenth of the input price for all but the
// last ~150 tokens. Anything that varies between calls must stay out of `system` and
// `cachedPrefix`, or nothing is ever read back.
const CACHE_BREAKPOINT = { type: 'ephemeral' };

function requestBody({ system, cachedPrefix, prompt }) {
  if (!cachedPrefix) return { system, messages: [{ role: 'user', content: prompt }] };
  return {
    system: [{ type: 'text', text: system, cache_control: CACHE_BREAKPOINT }],
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: cachedPrefix, cache_control: CACHE_BREAKPOINT },
        { type: 'text', text: prompt }
      ]
    }]
  };
}

// input_tokens is only the uncached remainder; cached input is reported (and billed) separately.
function usageFrom(response) {
  return {
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
    cacheReadTokens: response.usage?.cache_read_input_tokens || 0,
    cacheWriteTokens: response.usage?.cache_creation_input_tokens || 0
  };
}

export async function complete({ system, cachedPrefix = null, prompt, maxTokens = 1024, timeoutMs = 30000, model }) {
  const anthropic = getClient();

  const response = await anthropic.messages.create(
    {
      model: model || config.anthropicModel,
      max_tokens: maxTokens,
      ...requestBody({ system, cachedPrefix, prompt })
    },
    { timeout: timeoutMs }
  );

  // stopReason 'max_tokens' means the text (if any) was cut off - see writer.generateField.
  const textBlock = response.content.find(block => block.type === 'text');
  return { text: textBlock ? textBlock.text : '', stopReason: response.stop_reason, usage: usageFrom(response) };
}

// Writes the cache for `system` + `cachedPrefix` before several calls that share them start at
// once - a cache entry only becomes readable once a request using it has started responding, so
// parallel calls would otherwise each pay for writing the same entry. max_tokens 0 runs the prompt
// through without generating anything: it returns no content and bills only the cache write.
// Must send the same model and settings as the real calls, or it writes an entry they never read.
export async function warmCache({ system, cachedPrefix, timeoutMs = 30000, model }) {
  const anthropic = getClient();
  const maxTokens = 0;

  const response = await anthropic.messages.create(
    {
      model: model || config.anthropicModel,
      max_tokens: maxTokens,
      ...requestBody({ system, cachedPrefix, prompt: 'warmup' })
    },
    { timeout: timeoutMs }
  );

  return { usage: usageFrom(response) };
}
