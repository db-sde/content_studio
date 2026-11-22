// Blog and category pages ("Blog & Category Summary"): a writer uploads the page as a Word file, the
// app writes a short summary and the SEO title/description from it, and the team reviews and
// publishes them like any other draft. Shared by the browser and the server so both apply the same
// rules. Replaces the Blog Summarizer in the DegreeBaba micro app; the numbers below are its own.

export const SUMMARY_PAGE_TYPES = ['blog', 'category'];
export const isSummaryPageType = (pageType) => SUMMARY_PAGE_TYPES.includes(pageType);

// The fields the AI writes (and can rewrite on request). reading_time is counted, never written.
export const SUMMARY_AI_FIELDS = ['complete_page_summary', 'seo_title', 'meta_description'];

// Target lengths, in characters. The upper bounds are the limits search results show
// (server/ai/seoChecks.js uses the same 60 / 160); the lower bounds keep the space used.
export const SEO_TARGETS = {
  seo_title: { min: 50, max: 60 },
  meta_description: { min: 140, max: 160 }
};

// 'short' (under the target), 'ok' (inside it) or 'over' (past what search results show).
export function lengthTone(fieldKey, text) {
  const target = SEO_TARGETS[fieldKey];
  const length = String(text || '').length;
  if (!target || length === 0) return 'empty';
  if (length > target.max) return 'over';
  return length < target.min ? 'short' : 'ok';
}

// Round half to even, as Python's round() does - the micro app computed reading time in Python, and
// 2.5 minutes must still read "2 min read", not 3.
function roundHalfEven(x) {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (Math.abs(diff - 0.5) < 1e-9) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(x);
}

// Words split on whitespace, 200 a minute, at least 1: "6 min read".
export function wordCount(text) {
  return String(text || '').split(/\s+/).filter(Boolean).length;
}
export function readingTimeOf(text) {
  return `${Math.max(1, roundHalfEven(wordCount(text) / 200))} min read`;
}

// The summary's bullet points (<li> items), for the "aim for 4-5" hint.
export function countBullets(html) {
  return (String(html || '').match(/<li\b/gi) || []).length;
}

// The summary as WordPress gets it: one clean <ul> of <li> items. The editor wraps each item's text
// in <p> and the model sometimes adds a fence or a lead-in line; both are taken off. <strong>, <em>
// and links inside an item are kept.
export function cleanSummaryHtml(html) {
  let s = String(html || '').trim()
    .replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/, '');
  const items = [...s.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
    .map(m => m[1].replace(/<\/?p\b[^>]*>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim())
    .filter(text => text.replace(/<[^>]+>/g, '').trim());
  if (items.length) return `<ul>${items.map(t => `<li>${t}</li>`).join('')}</ul>`;
  // No list at all: one item per non-empty line ("- point" / "* point" / "1. point").
  const lines = s.replace(/<\/?(ul|ol|p|div)\b[^>]*>/gi, '\n').split('\n')
    .map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean);
  return lines.length ? `<ul>${lines.map(t => `<li>${t}</li>`).join('')}</ul>` : '';
}

// The same list as the draft editor (TipTap) stores it - each item's text in a <p>. Saving it in this
// form means the editor has nothing to rewrite when the draft opens (a rewrite on load would count as
// an edit and trigger a save). cleanSummaryHtml turns it back into the clean list for WordPress.
export function summaryEditorHtml(html) {
  const clean = cleanSummaryHtml(html);
  return clean.replace(/<li>([\s\S]*?)<\/li>/g, '<li><p>$1</p></li>');
}
