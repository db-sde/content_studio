// Checks for the SEO title and meta description, used instead of the GPT editor for these two
// fields. What makes them good is concrete and checkable: a length limit, naming what the page is
// about, and being a single clean line. The GPT rubric (tone, sentence flow, brand voice...) mostly
// scored things that don't apply to a 60-character title, cost as much as writing the field, and
// sent about 1 in 5 SEO drafts into a paid rewrite. These are free, instant, and when one fails the
// writer gets the exact reason to fix.
//
// The writer is asked for CANDIDATES_PER_CALL versions of different lengths at once, and the
// longest that passes is used (most of the space search results show, without being cut off). A
// model can't count characters as it writes, so a single title lands a few characters over the
// limit often enough - and a rewrite asking for "2 characters shorter" made Sonnet spend its whole
// output budget counting. Three short lines cost a few dozen tokens and almost always include one
// that fits.

// Logged as the evaluator's "model" for every free, deterministic check (priced at 0 in pricing.js).
export const RULES_MODEL = 'rules';
export const CANDIDATES_PER_CALL = 3;

// maxChars is read from the field's own instructions in src/config/schemas.js ("max 60
// characters") when present, so the two can't drift apart; these are the fallbacks.
const RULES_BY_FIELD = {
  seo_title: { maxChars: 60, minChars: 20, mustName: 'subject-and-university' },
  meta_description: { maxChars: 160, minChars: 70, mustName: 'subject' }
};

export function isRuleCheckedField(fieldKey) {
  return Object.hasOwn(RULES_BY_FIELD, fieldKey);
}

function maxCharsFromInstructions(instructions) {
  const match = /\bmax(?:imum)?\s+(\d{2,3})\s+char/i.exec(instructions || '');
  return match ? Number(match[1]) : null;
}

function normalize(text) {
  return String(text || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Words that don't tell one university or program apart from another.
const GENERIC_WORDS = new Set([
  'a', 'an', 'the', 'of', 'and', 'in', 'for', 'with', 'at', 'to', 'be', 'deemed',
  'online', 'distance', 'learning', 'education', 'university', 'institute', 'college', 'school',
  'centre', 'center', 'program', 'programme', 'course', 'degree', 'specialization', 'specialisation'
]);

// Joining words skipped when forming an acronym ("Guru Jambheshwar University of Science and
// Technology" -> GJUST), plus "online", which brands drop from theirs ("SMU", not "SMUO").
const ACRONYM_SKIP = new Set(['a', 'an', 'the', 'of', 'and', 'in', 'for', 'at', 'to', 'online']);

// Does `text` name `name`? The full name; or its first two distinctive words, since a 60-character
// title can't always fit "Guru Jambheshwar University of Science and Technology" next to a program
// name and "Guru Jambheshwar University" plainly names it; or, for a name of several words, its
// acronym (SMU, DSU, GJUST), which is how these universities are commonly written and searched.
export function mentions(text, name) {
  const haystack = ` ${normalize(text)} `;
  const needle = normalize(name);
  if (!needle) return true;
  if (haystack.includes(` ${needle} `)) return true;
  const words = needle.split(' ');
  const distinctive = words.filter(w => !GENERIC_WORDS.has(w));
  const keyWords = (distinctive.length ? distinctive : words).slice(0, 2);
  if (keyWords.every(w => haystack.includes(` ${w} `))) return true;
  const acronymWords = words.filter(w => !ACRONYM_SKIP.has(w));
  const acronym = acronymWords.map(w => w[0]).join('');
  return acronymWords.length >= 2 && haystack.includes(` ${acronym} `);
}

// What the page is about: the specialization, the program, or (on a university page) the
// university itself. Facts keys match src/config/schemas.js.
function subjectName(facts) {
  return facts.spec_name || facts.program_name || facts.university_name || '';
}

export function checkSeoField({ fieldKey, fieldLabel, fieldInstructions, content, facts = {} }) {
  const rules = RULES_BY_FIELD[fieldKey];
  const maxChars = maxCharsFromInstructions(fieldInstructions) || rules.maxChars;
  const text = String(content || '').trim();
  const length = [...text].length;
  const subject = subjectName(facts);
  const university = facts.university_name || '';

  const checks = [];
  const add = (rule, passed, problem) => checks.push({ rule, passed, ...(passed ? {} : { problem }) });

  add('not_empty', length > 0, `The ${fieldLabel} came back empty.`);
  add('max_length', length <= maxChars, `It is ${length} characters; the limit is ${maxChars}. Shorten it.`);
  add('min_length', length >= rules.minChars, `It is only ${length} characters; use at least ${rules.minChars}.`);
  add('single_line', !/[\r\n]/.test(text), 'Keep it to a single line.');
  add(
    'plain_text',
    !/^["'“‘]|["'”’]$|\*\*|^#|^(seo title|meta description|title|description)\s*:/i.test(text),
    'Output only the text itself: no quotes around it, no label like "SEO Title:", no markdown.'
  );
  add('names_subject', mentions(text, subject), `Name what the page is about: "${subject}".`);
  if (rules.mustName === 'subject-and-university' && university && normalize(university) !== normalize(subject)) {
    add('names_university', mentions(text, university), `Include the university name: "${university}".`);
  }

  const failed = checks.filter(c => !c.passed);
  const passedCount = checks.length - failed.length;
  return {
    method: 'rules',
    model: RULES_MODEL,
    status: 'ok',
    passed: failed.length === 0,
    checks,
    scores: Object.fromEntries(checks.map(c => [c.rule, c.passed ? 10 : 0])),
    overall: Math.round((passedCount / checks.length) * 100) / 10,
    feedback: failed.length
      ? failed.map(c => c.problem).join(' ')
      : `All SEO checks passed (${length}/${maxChars} characters, names ${rules.mustName === 'subject' ? 'the page subject' : 'the page subject and the university'}).`,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  };
}

// Strips list markers the model may add despite being told not to ("1. ", "- ", "• ").
function candidateLines(output) {
  return String(output || '').split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:\d+[.)]|[-*•])\s+/, '').trim())
    .filter(Boolean);
}

// Checks every version the writer gave and picks the longest that passes, else the one closest to
// passing. `content` in the result is the chosen version - that, not the raw multi-line output, is
// what goes into the field.
export function checkSeoCandidates(params) {
  const lines = candidateLines(params.content);
  if (!lines.length) return { ...checkSeoField({ ...params, content: '' }), content: '' };

  const results = lines.map(line => ({ ...checkSeoField({ ...params, content: line }), content: line }));
  const passing = results.filter(r => r.passed);
  const best = passing.length
    ? passing.reduce((a, b) => (b.content.length > a.content.length ? b : a))
    : results.reduce((a, b) => (b.overall > a.overall ? b : a));
  if (best.passed) return best;
  return {
    ...best,
    feedback: `None of the ${results.length} versions passed. ` +
      results.map((r, i) => `Version ${i + 1} ("${r.content}"): ${r.feedback}`).join(' ')
  };
}

// The writer returned no usable text - on a bad draw Sonnet spends the whole output budget thinking
// (writer.generateField also drops text the cap cut off). Not worth paying the GPT editor to score
// an empty string; go straight to the rewrite.
export function emptyOutputEvaluation() {
  return {
    method: 'rules',
    model: RULES_MODEL,
    status: 'ok',
    passed: false,
    checks: [{ rule: 'not_empty', passed: false, problem: 'The previous attempt produced no text.' }],
    scores: { not_empty: 0 },
    overall: 0,
    feedback: 'The previous attempt produced no usable text: it ran out of room, mostly spent thinking. Write the field now, directly, without extended deliberation.',
    content: '',
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  };
}
