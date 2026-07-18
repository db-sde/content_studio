import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { config } from '../config.js';
import * as anthropicProvider from './providers/anthropicProvider.js';
import { buildWriterSystemPrompt, buildWriterUserPrompt } from './prompts/writerPrompts.js';

// Matches exactly what TipTap's starter-kit + link extension render — anything else is
// stripped, regardless of what the model or a markdown conversion might otherwise produce.
const ALLOWED_TAGS = ['p', 'ul', 'ol', 'li', 'strong', 'em', 'a', 'br'];

// Short, mechanical, character-capped fields — not long-form narrative writing — so the cheaper
// model is an intentional quality tradeoff scoped to just these two fields, not a global downgrade.
// Exported so the pricing-estimate route can classify fields the same way without duplicating this set.
export const CHEAP_MODEL_FIELD_KEYS = new Set(['seo_title', 'meta_description']);

function markdownToSafeHtml(markdown) {
  const rawHtml = marked.parse(markdown, { breaks: true });
  return sanitizeHtml(rawHtml, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ['href'] },
    allowedSchemes: ['http', 'https', 'mailto']
  });
}

// Claude, generation only. Never touches the SDK directly — only anthropicProvider does.
export async function generateField({ fieldKey, fieldLabel, fieldInstructions, facts, styleProfile, outputFormat, existingContent, evaluatorFeedback }) {
  const system = buildWriterSystemPrompt(styleProfile);
  const prompt = buildWriterUserPrompt({ fieldLabel, fieldInstructions, facts, outputFormat, existingContent, evaluatorFeedback });

  const maxTokens = outputFormat === 'plain-short' ? 256 : 1536;
  const model = CHEAP_MODEL_FIELD_KEYS.has(fieldKey) ? config.anthropicCheapModel : config.anthropicModel;
  const { text, usage } = await anthropicProvider.complete({ system, prompt, maxTokens, timeoutMs: 30000, model });

  const cleaned = text.trim();
  const output = outputFormat === 'markdown' ? markdownToSafeHtml(cleaned) : cleaned;

  return { output, prompt, model, usage };
}
