// Drafts sent by the DegreeBaba document parser (micro app). The parser reads a page's Word
// document and pre-fills the fields; the draft lands in Senior Review with the document attached,
// and the senior completes it from the document. Content Studio is the only thing that publishes to
// WordPress — the parser no longer does.
//
// The parser sends its own field names (close to WordPress's); this file translates them into
// Content Studio's form fields. Anything with no home here is listed in the hand-off remark, so
// nothing is silently lost.
import crypto from 'node:crypto';
import { rowsToHtmlList, htmlToText } from './wordpressAcf.js';
import { bulletListHtmlToText, normalizeLoadedFormData, schemas } from '../../src/config/schemas.js';

export const PARSER_SOURCE = 'parser';
const MAX_SKEW_SECONDS = 300;

// ── request signing (same scheme as the parser's chatbot sync) ──────────────────────────────────
export function sign(secret, timestamp, rawBody) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
}

export function verifySignature(secret, headers, rawBody, now = Math.floor(Date.now() / 1000)) {
  const timestamp = Number(headers['x-parser-timestamp']);
  const given = String(headers['x-parser-signature'] || '');
  if (!secret || !Number.isFinite(timestamp) || !/^[0-9a-f]{64}$/.test(given)) return false;
  if (Math.abs(now - timestamp) > MAX_SKEW_SECONDS) return false;
  const expected = sign(secret, timestamp, rawBody);
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(given, 'hex'));
}

// ── field translation ────────────────────────────────────────────────────────────────────────────
const listItems = (html) => [...String(html || '').matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(m => htmlToText(m[1])).filter(Boolean);

// "<ul><li>Infosys</li><li>KPMG</li></ul>" -> "Infosys\nKPMG" (the editor's one-per-line box).
const namesToLines = (value) => {
  const items = listItems(value);
  if (items.length) return items.join('\n');
  return htmlToText(value);
};

const rows = (value) => (Array.isArray(value) ? value.filter(r => r && typeof r === 'object') : []);

// Year -> semester syllabus rows -> Content Studio's flat {semester, subjects} list.
function syllabusRows(years, yearKey, semestersKey, semesterKey, subjectsKey) {
  const out = [];
  rows(years).forEach(year => {
    const sems = rows(year[semestersKey]);
    if (!sems.length) return;
    sems.forEach(sem => {
      const label = htmlToText(sem[semesterKey]) || htmlToText(year[yearKey]);
      const subjects = bulletListHtmlToText(sem[subjectsKey] || '');
      if (subjects.trim()) out.push({ semester: label, subjects });
    });
  });
  return out;
}

const examRows = (value, titleKey, descKey) =>
  rows(value).map(r => ({ detail_label: htmlToText(r[titleKey]), detail_value: htmlToText(r[descKey]) }))
    .filter(r => r.detail_label || r.detail_value);

// parser field -> (value, payload) => { contentStudioField: value }
const COMMON = {
  admission_fee_note: () => ({}), // typed in by the senior (never auto-filled)
  eligibility_content: (v) => ({ eligibility_content: rowsToHtmlList(rows(v), 'eligibility_title', 'eligibility_description') }),
  eligibility_intro: (v) => ({ eligibility_criteria_paragraph: v }),
  linked_university: () => ({}), // taken from the document's own Linked_ lines (relationship hints)
  linked_course: () => ({})
};

const MAPS = {
  university: {
    ...COMMON,
    examination_cards: (v) => ({ exam_details: examRows(v, 'exam_card_title', 'exam_card_description') }),
    placement_highlights: (v) => ({ hiring_partners: namesToLines(v) }),
    partner_banks_names: (v) => ({ emi_partners: listItems(v).map(name => ({ bank_name: name, emi_terms: '' })) })
  },
  course: {
    ...COMMON,
    nirf_rank: (v) => ({ nirf_rank_course: v }),
    accreditations_intro: (v) => ({ accreditation_paragraph: v }),
    fee_intro: (v) => ({ fee_structure_paragraph: v }),
    partner_banks_course: (v) => ({ partner_banks: namesToLines(v) }),
    top_hiring_partners_course: (v) => ({ hiring_partners: namesToLines(v) }),
    course_syllabus_description: (v) => ({ syllabus_section_paragraph: v }),
    course_syllabus_section_heading: () => ({}), // Content Studio derives it from syllabus_heading
    course_academic_years: (v) => ({ syllabus_subjects: syllabusRows(v, 'course_year_title', 'course_semesters', 'course_semester_title', 'course_semester_subjects') }),
    jobs_intro: (v) => ({ 'job_roles_&_salary_paragraph': v }),
    course_amount_range: () => ({}), // derived from the specializations when published
    best_price_value: () => ({}) // derived from total_fee when published
  },
  specialization: {
    ...COMMON,
    program_validity: (v) => ({ validity: v }),
    partner_banks_specialization: (v) => ({ partner_banks: namesToLines(v) }),
    hiring_partners_specialization: (v) => ({ hiring_partners: namesToLines(v) }),
    fee_intro: (v) => ({ fee_section_paragraph: v }),
    other_specs_intro: (v) => ({ other_specializations_section_paragraph: v }),
    syllabus_description: (v) => ({ syllabus_section_paragraph: v }),
    syllabus_section_heading: () => ({}),
    academic_years: (v) => ({ syllabus_subjects: syllabusRows(v, 'year_title', 'semesters', 'semester_title', 'semester_subjects') }),
    examination_process: (v) => ({ exam_details: examRows(v, 'exam_process_title', 'exam_process_description') }),
    examination_content: (v) => ({ exam_content: v }),
    jobs_content: (v) => ({ job_profiles_section_paragraph: v }),
    best_price_specialization: () => ({}),
    specialization_lowest_emi_strats_from: () => ({})
  }
};

const isEmpty = (v) => v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length)
  || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);

// -> { formData, unmapped: [parser field names with a value but no Content Studio field] }
export function toFormData(pageType, payload, relationshipHints = {}) {
  const schema = schemas[pageType];
  if (!schema) throw new Error(`Unknown page type: ${pageType}`);
  const known = new Set(schema.sections.flatMap(s => s.fields.map(f => f.key)));
  const map = MAPS[pageType] || {};
  const formData = {};
  const unmapped = [];

  for (const [key, value] of Object.entries(payload || {})) {
    if (key.startsWith('_') || isEmpty(value)) continue;
    if (map[key]) {
      for (const [k, v] of Object.entries(map[key](value, payload))) {
        if (!isEmpty(v) && known.has(k) && isEmpty(formData[k])) formData[k] = v;
      }
      continue;
    }
    if (known.has(key)) {
      if (isEmpty(formData[key])) formData[key] = value;
    } else {
      unmapped.push(key);
    }
  }
  // Linked University / Linked Course hold names in Content Studio (resolved to WordPress posts
  // on publish); the parser reads them from the document's "Linked_university - …" lines.
  for (const field of ['linked_university', 'linked_course']) {
    const name = relationshipHints?.[field];
    if (name && known.has(field) && isEmpty(formData[field])) formData[field] = String(name).trim();
  }
  return { formData: normalizeLoadedFormData(formData, pageType), unmapped };
}

// The hand-off note the senior sees on the draft.
export function handOffRemark({ filename, flags = [], unmapped = [], hasDocument }) {
  const lines = [`Imported from the document${filename ? ` "${filename}"` : ''} by the parser.`];
  lines.push(hasDocument
    ? 'Check every field against the attached document and fill what is missing before sending it on.'
    : 'The original document was not attached; check the fields against it and fill what is missing.');
  const notes = flags.filter(f => f && f.message).slice(0, 15).map(f => `- ${f.field_key}: ${f.message}`);
  if (notes.length) lines.push('', 'The parser flagged:', ...notes);
  if (unmapped.length) lines.push('', `Not imported (no field here): ${unmapped.join(', ')}`);
  return lines.join('\n');
}
