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

export async function complete({ system, prompt, maxTokens = 1024, timeoutMs = 30000, model }) {
  const anthropic = getClient();

  const response = await anthropic.messages.create(
    {
      model: model || config.anthropicModel,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }]
    },
    { timeout: timeoutMs }
  );

  const textBlock = response.content.find(block => block.type === 'text');
  return {
    text: textBlock ? textBlock.text : '',
    usage: {
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0
    }
  };
}
