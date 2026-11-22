// "Blog & Category Summary": the page summary and the SEO title/description, written from the text of
// an uploaded Word document. The prompts, token limits and temperatures are the DegreeBaba micro
// app's Blog Summarizer's own (backend/pipeline/blog_pipeline.py), word for word, so the output
// matches what the team is used to; the model is Content Studio's writing model (config), not the
// micro app's Haiku. Every call is logged to generation_logs, so it counts towards the daily AI
// budget and shows in the page's cost summary like every other AI call.
import sanitizeHtml from 'sanitize-html';
import { config } from '../config.js';
import * as anthropicProvider from './providers/anthropicProvider.js';
import { insertGenerationLog } from '../repositories/generationLogsRepo.js';
import { cleanSummaryHtml, summaryEditorHtml } from '../../src/config/summaryPages.js';

export const SUMMARY_PROMPT_VERSION = 'blog-summary-v1';

export const SUMMARY_SYSTEM_PROMPT = `You are an expert content writer for an education platform.
Your task is to read the raw text of a Blog or Category page and generate an engaging "Complete Page Summary".
This summary will be placed at the top of the page.

RULES:
- The summary MUST be highly appealing and optimized for short attention spans.
- The output MUST consist of exactly 4-5 key bullet points summarizing the core essence of the page.
- CRITICAL: Keep each bullet point extremely brief and punchy. Maximum 1-2 short sentences (or phrases) per point. Do not write huge, wordy paragraphs.
- Return the output strictly as a clean HTML unordered list (<ul>).
- Each point should be enclosed in an <li> tag.
- You may use <strong> tags inside the <li> for emphasis if helpful.
- DO NOT return any markdown formatting (like \`\`\`html). Return ONLY the raw HTML string starting with <ul> and ending with </ul>.
- DO NOT add introductory or concluding sentences.
`;

export const SEO_SYSTEM_PROMPT = `You are an SEO expert for an education platform. Generate concise, compelling SEO fields for a blog or category page.
Return ONLY valid JSON, no markdown, no explanation.
`;

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const summaryUserPrompt = (pageType, text) =>
  `Please read the following ${pageType} content and generate the 4-5 point HTML bulleted summary:\n\n<content>\n${text}\n</content>`;

export const seoUserPrompt = (pageType, text) =>
  `Generate SEO fields for the following ${capitalize(pageType)} page content.\n\n` +
  'Rules:\n' +
  '- seo_title: 50-60 characters, compelling, keyword-rich title for search engines.\n' +
  '- meta_description: 140-160 characters, compelling search snippet that drives clicks.\n\n' +
  `Content (truncated):\n${text.slice(0, 1500)}\n\n` +
  'Return ONLY a valid JSON object: {"seo_title": "...", "meta_description": "..."}';

// A very long document would make every call expensive for no better summary; the first ~120,000
// characters (about 20,000 words) are plenty for 5 bullet points.
const MAX_TEXT_CHARS = 120000;

// Content Studio's writing model may think before answering, and thinking counts against max_tokens
// (see writer.generateField) - the micro app's 800 / 400 caps would cut answers off. Only tokens
// actually produced are billed, so the headroom costs nothing.
const SUMMARY_MAX_TOKENS = 2048;
const SEO_MAX_TOKENS = 1024;

function aiFailed(e) {
  const err = new Error(`The AI service couldn't write this (${e.message || e}). Nothing was saved - try again.`, { cause: e });
  err.status = 502;
  err.code = 'ai_failed';
  return err;
}

async function logCall({ draftId, pageType, fieldKey, system, prompt, model, output, usage }) {
  // The document can be long; the log keeps the instructions and the opening of the text.
  const logged = `${system}\n\n${prompt.length > 4000 ? `${prompt.slice(0, 4000)}\n…(${prompt.length - 4000} more characters)` : prompt}`;
  await insertGenerationLog({
    draftId, pageType, fieldKey, attemptNumber: 1, model, prompt: logged, factsJson: '{}',
    styleVersion: SUMMARY_PROMPT_VERSION, output, ...usage
  });
}

async function call({ draftId, pageType, fieldKey, system, prompt, maxTokens, temperature, timeoutMs }) {
  const model = config.anthropicModel;
  let result;
  try {
    result = await anthropicProvider.complete({ system, prompt, maxTokens, temperature, timeoutMs, model });
  } catch (e) {
    throw aiFailed(e);
  }
  await logCall({ draftId, pageType, fieldKey, system, prompt, model, output: result.text, usage: result.usage });
  if (result.stopReason === 'max_tokens' || !result.text.trim()) throw aiFailed(new Error('the answer came back empty or cut off'));
  return result.text.trim();
}

const stripFences = (raw) => raw.trim().replace(/^```(?:html|json)?[^\n]*\n?/i, '').replace(/```\s*$/, '').trim();

// The summary as one clean <ul>: tags the editor and WordPress expect, nothing else.
export function summaryHtmlFrom(raw) {
  const safe = sanitizeHtml(stripFences(raw), {
    allowedTags: ['ul', 'ol', 'li', 'p', 'strong', 'b', 'em', 'a', 'br'],
    allowedAttributes: { a: ['href'] },
    allowedSchemes: ['http', 'https', 'mailto']
  }).replace(/<(\/?)b>/g, '<$1strong>');
  return cleanSummaryHtml(safe);
}

export async function generateSummary({ draftId, pageType, text }) {
  const raw = await call({
    draftId, pageType, fieldKey: 'complete_page_summary', system: SUMMARY_SYSTEM_PROMPT,
    prompt: summaryUserPrompt(pageType, text.slice(0, MAX_TEXT_CHARS)), maxTokens: SUMMARY_MAX_TOKENS, temperature: 0.4, timeoutMs: 60000
  });
  const html = summaryHtmlFrom(raw);
  if (!html) throw aiFailed(new Error('the summary came back without any bullet points'));
  return summaryEditorHtml(html);
}

// { seo_title, meta_description } from one call over the opening of the document.
export async function generateSeo({ draftId, pageType, text }) {
  const raw = await call({
    draftId, pageType, fieldKey: 'seo_fields', system: SEO_SYSTEM_PROMPT,
    prompt: seoUserPrompt(pageType, text), maxTokens: SEO_MAX_TOKENS, temperature: 0.3, timeoutMs: 30000
  });
  let data;
  const json = stripFences(raw);
  try {
    data = JSON.parse(json);
  } catch {
    const braces = /\{[\s\S]*\}/.exec(json);
    try { data = braces ? JSON.parse(braces[0]) : null; } catch { data = null; }
  }
  const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const result = { seo_title: clean(data?.seo_title), meta_description: clean(data?.meta_description) };
  if (!result.seo_title || !result.meta_description) throw aiFailed(new Error('the SEO title and description came back unreadable'));
  return result;
}

// Both, one after the other (the summary first, as the micro app did). A failed summary fails the
// whole run; a failed SEO call doesn't - the draft is still made, with those two fields empty and a
// note (`seoError`), so the summary already paid for isn't thrown away. Regenerate fills them later.
export async function generateSummaryFields({ draftId, pageType, text }) {
  const complete_page_summary = await generateSummary({ draftId, pageType, text });
  try {
    return { fields: { complete_page_summary, ...(await generateSeo({ draftId, pageType, text })) }, seoError: null };
  } catch (e) {
    return { fields: { complete_page_summary, seo_title: '', meta_description: '' }, seoError: e.message };
  }
}
