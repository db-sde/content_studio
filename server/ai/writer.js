import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { config } from '../config.js';
import * as anthropicProvider from './providers/anthropicProvider.js';
import { buildWriterSystemPrompt, buildWriterFactsBlock, buildWriterUserPrompt } from './prompts/writerPrompts.js';

// Matches exactly what TipTap's starter-kit + link extension render — anything else is
// stripped, regardless of what the model or a markdown conversion might otherwise produce.
const ALLOWED_TAGS = ['p', 'ul', 'ol', 'li', 'strong', 'em', 'a', 'br'];

function markdownToSafeHtml(markdown) {
  const rawHtml = marked.parse(markdown, { breaks: true });
  return sanitizeHtml(rawHtml, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ['href'] },
    allowedSchemes: ['http', 'https', 'mailto']
  });
}

// Claude, generation only. Never touches the SDK directly — only anthropicProvider does.
//
// Every field, the SEO title and meta description included, uses the same model with the same
// system prompt and facts, so they all share one cached prefix (see anthropicProvider.complete):
// a different model per field would mean a separate cache per model. The SEO fields used to go
// to Haiku to save money; once the prefix is cached Sonnet is cheaper for them than an uncached
// Haiku call (Haiku 4.5 can't cache a prompt this size at all - its minimum is 4,096 tokens).
export async function generateField({ fieldLabel, fieldInstructions, facts, styleProfile, outputFormat, existingContent, evaluatorFeedback, alternatives }) {
  const system = buildWriterSystemPrompt(styleProfile);
  const cachedPrefix = buildWriterFactsBlock(facts);
  const fieldPrompt = buildWriterUserPrompt({ fieldLabel, fieldInstructions, outputFormat, existingContent, evaluatorFeedback, alternatives });

  // Sonnet 5 thinks before answering when it judges that useful, and thinking counts against
  // max_tokens - a tight cap could cut a short field off before any text. Only tokens actually
  // produced are billed, so the headroom costs nothing. Thinking length varies a lot from call to
  // call (measured 350 to 1,500+ tokens for the same field), so an occasional call still ends with
  // no text; the orchestrator rewrites those once rather than saving an empty field.
  // The SEO versions are ~75-200 tokens of text; 512 leaves room for brief thinking and caps what a
  // runaway one wastes.
  const maxTokens = alternatives ? 512 : outputFormat === 'plain-short' ? 1024 : 1536;
  const model = config.anthropicModel;
  const { text, stopReason, usage } = await anthropicProvider.complete({ system, cachedPrefix, prompt: fieldPrompt, maxTokens, timeoutMs: 30000, model });

  // Cut off by the token cap: never use half a sentence. With several one-line versions, the
  // complete lines before the cut are still good.
  let cleaned = text.trim();
  if (stopReason === 'max_tokens') cleaned = alternatives ? cleaned.split('\n').slice(0, -1).join('\n').trim() : '';
  const output = outputFormat === 'markdown' ? markdownToSafeHtml(cleaned) : cleaned;

  return { output, prompt: `${cachedPrefix}\n\n${fieldPrompt}`, model, usage };
}

// Writes the page's cached prefix once before a batch of fields starts in parallel (see
// anthropicProvider.warmCache). Same model, system prompt and facts block as generateField.
export async function warmPageCache({ facts, styleProfile }) {
  const model = config.anthropicModel;
  const { usage } = await anthropicProvider.warmCache({
    system: buildWriterSystemPrompt(styleProfile),
    cachedPrefix: buildWriterFactsBlock(facts),
    timeoutMs: 30000,
    model
  });
  return { model, usage };
}
