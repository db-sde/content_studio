import { cleanSummaryHtml } from '../../src/config/summaryPages.js';

// Turns a draft's exported fields (src/config/schemas.js's transformToACF) into the "acf" object the
// DegreeBaba WordPress site accepts. Pure functions - no network - so every rule is unit-tested
// (tests/wordpress.test.js); wordpressClient.js does the fetching and sending.
//
// Content Studio's field set and the site's ACF field groups were designed separately and don't
// line up one to one. WordPress rejects the WHOLE "acf" object ("Invalid parameter(s): acf") if any
// value has the wrong shape - a string where it expects a list of rows, a name where it expects a
// post ID, or a key inside a row that its repeater doesn't have. So:
//   1. mapToWordPress  - known differences, per page type: renames, list -> HTML, rich text -> rows,
//                        syllabus -> years/semesters, fee plans -> the site's fixed fee fields.
//   2. conformToSchema - a safety net against the site's live ACF schema (fetched at publish time):
//                        anything still unknown or mis-shaped is left out and reported, never sent.
// Mappings follow the ones the DegreeBaba Micro Parser settled on against this same site.

// Content Studio-only fields: notes that exist to feed facts to the AI, never page content. Left
// out quietly (not reported as "not published").
// Placement Stats too: the site has no field for them on any page type (on university pages
// placement_highlights is the hiring-partner chips, not stats) - they're the facts the AI writes
// Placement Content from.
// The Admission Steps list likewise feeds the AI's Admission Steps text (the site has no list field
// for it), and specialization pages no longer have a certificate heading.
const INTERNAL_ONLY_FIELDS = new Set([
  'about_additional_notes', 'why_choose_additional_notes', 'emi_additional_notes', 'placement_additional_notes',
  'placement_stats', 'admission_steps_list', 'certificate_heading'
]);

// Linked University / Linked Course hold a name in Content Studio; WordPress wants the post ID of
// that university/course page on the site. Resolved by wordpressClient (findLinkedPostIds).
export const LINKED_FIELDS = {
  course: { linked_university: 'university' },
  specialization: { linked_university: 'university', linked_course: 'course' }
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
const decodeEntities = (s) => s.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e) => ENTITIES[e]);
export const htmlToText = (html) => decodeEntities(String(html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))
  .replace(/\s+/g, ' ').trim();
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A repeater whose WordPress field is a single rich-text block: one <li> per row, "Title: description".
export function rowsToHtmlList(rows, titleKey, descKey) {
  const items = (Array.isArray(rows) ? rows : []).map(row => {
    const title = htmlToText(row?.[titleKey]);
    const desc = htmlToText(row?.[descKey]);
    if (title && desc) return `<li><strong>${escapeHtml(title)}</strong>: ${escapeHtml(desc)}</li>`;
    return title || desc ? `<li>${escapeHtml(title || desc)}</li>` : null;
  }).filter(Boolean);
  return items.length ? `<ul>${items.join('')}</ul>` : '';
}

// The reverse: Content Studio's rich-text eligibility -> WordPress's {title, description} rows. Each
// list item or paragraph is one row; a lead-in like "<strong>Qualification</strong>:" or
// "Qualification:" becomes the title. A paragraph ending in ":" only introduces the list after it.
export function htmlToRows(html, titleKey, descKey) {
  // The editor (TipTap) writes list items as <li><p>...</p></li>; unwrap so each item is one block.
  const source = String(html || '').replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => `<li>${inner.replace(/<\/?p\b[^>]*>/gi, ' ').trim()}</li>`);
  const blocks = [...source.matchAll(/<(li|p)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(m => m[2]);
  if (!blocks.length && htmlToText(source)) blocks.push(source);
  const rows = [];
  for (const block of blocks) {
    if (/<(li|p)\b/i.test(block)) continue; // a container - its own items are matched separately
    const strong = /^\s*<(strong|b)>([\s\S]{1,80}?)<\/\1>\s*[:\-–—]?\s*([\s\S]*)$/i.exec(block);
    let title = '';
    let desc;
    if (strong) {
      title = htmlToText(strong[2]).replace(/[:\s]+$/, '');
      desc = htmlToText(strong[3]);
    } else {
      const text = htmlToText(block);
      if (!text || /:$/.test(text)) continue;
      const labelled = /^([^:.]{2,60}):\s+(.+)$/.exec(text);
      if (labelled) { title = labelled[1].trim(); desc = labelled[2].trim(); } else desc = text;
    }
    if (title || desc) rows.push({ [titleKey]: title, [descKey]: desc });
  }
  return rows;
}

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };
function semesterNumber(label) {
  const m = /\b(\d{1,2}|xii|xi|x|ix|viii|vii|vi|v|iv|iii|ii|i)\b/i.exec(String(label || ''));
  if (!m) return null;
  return /^\d+$/.test(m[1]) ? Number(m[1]) : ROMAN[m[1].toLowerCase()];
}

// Content Studio's syllabus is a flat list of {semester, subjects}; WordPress groups semesters
// into years (Semester I-II -> Year 1, III-IV -> Year 2...). A row labelled as a year is its own year.
export function syllabusToYears(rows, keys) {
  const years = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row, i) => {
    const label = htmlToText(row?.semester) || `Semester ${i + 1}`;
    const subjects = String(row?.subjects || '');
    if (!htmlToText(subjects)) return;
    const isYear = /\byear\b/i.test(label);
    const n = semesterNumber(label);
    const year = isYear ? (n || i + 1) : Math.ceil((n || i + 1) / 2);
    if (!years.has(year)) years.set(year, []);
    years.get(year).push({ [keys.semesterTitle]: label, [keys.semesterSubjects]: subjects });
  });
  return [...years.entries()].sort((a, b) => a[0] - b[0])
    .map(([year, semesters]) => ({ [keys.yearTitle]: `Year ${year}`, [keys.semesters]: semesters }));
}

// The site has fixed fields per fee tier as well as a fee_plans list; fill the tiers by keyword.
const FEE_TIER_KEYWORDS = [
  ['semester', /semester/i],
  ['annual', /annual|yearly|per year/i],
  ['one_time', /one[- ]?time|lump ?sum|full payment|single payment/i]
];
const FEE_TIER_FIELDS = {
  course: { semester: 'semester_plan_amount', annual: 'annual_plan_amount', one_time: 'one-time_payment_amount' },
  specialization: { semester: 'semester_plan_value', annual: 'annual_plan_value', one_time: 'one-time_payment_value' }
};

// "Top Hiring Partners": the theme shows each <li> of its own field as a company chip - on university
// pages that field is placement_highlights. Typed as "Infosys, KPMG, etc." or one per line; becomes
// <ul><li>Infosys</li><li>KPMG</li></ul> (as the Micro Parser sends it). Left out while empty, so a
// re-publish never wipes partners entered in WordPress by hand.
export const HIRING_PARTNERS_FIELD = { university: 'placement_highlights', course: 'top_hiring_partners_course', specialization: 'hiring_partners_specialization' };

export function partnersToHtmlList(value) {
  const raw = String(value || '');
  const lines = /<li\b/i.test(raw)
    ? [...raw.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(m => htmlToText(m[1]))
    : decodeEntities(raw.replace(/<\/(p|div)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).split(/\n|•/);
  const names = lines.flatMap(line => {
    const parts = line.split(/[,;]/);
    // "A, B and C": the last "and" separates names; a lone "Procter and Gamble" stays whole.
    if (parts.length > 1) {
      const last = parts.pop();
      const and = /\s+and\s+/i.exec(last);
      parts.push(...(and ? [last.slice(0, and.index), last.slice(and.index + and[0].length)] : [last]));
    }
    return parts;
  }).map(n => n.replace(/^\s*(?:[-*–]|\d+[.)])\s*/, '').replace(/\betc\.?\s*$/i, '').trim().replace(/[.,;:]+$/, '').trim());
  const seen = new Set();
  const unique = names.filter(n => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
  return unique.length ? `<ul>${unique.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : '';
}
const hiringPartners = (pageType) => (value) => {
  const html = partnersToHtmlList(value);
  return html ? { [HIRING_PARTNERS_FIELD[pageType]]: html } : {};
};

// Accreditation cards: the theme shows the body's name only as a small badge, so the card's heading
// (the grade / status column) must name the body itself: "Approved" -> "AICTE Approved", "A++ Grade"
// -> "NAAC A++ Grade". Left alone when it already names the body, or is empty.
const bodyWords = (s) => htmlToText(s).toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim();
export function namedAccreditations(rows, nameKey, descKey) {
  return (Array.isArray(rows) ? rows : []).map(row => {
    const name = htmlToText(row?.[nameKey]);
    const desc = htmlToText(row?.[descKey]);
    if (!name || !desc || ` ${bodyWords(desc)} `.includes(` ${bodyWords(name)} `)) return row;
    return { ...row, [descKey]: `${name} ${desc}` };
  });
}

// Blog / category: the summary goes as one clean <ul> (see summaryPages.js); the other fields as typed.
const summaryList = (value) => ({ complete_page_summary: cleanSummaryHtml(value) });

// Per page type: what each Content Studio field becomes on WordPress. Each entry gets the field's
// value and returns { wpKey: value, ... } to send in its place (an empty object = not sent).
const toHtmlList = (wpKey, titleKey, descKey) => (rows) => ({ [wpKey]: rowsToHtmlList(rows, titleKey, descKey) });
const rename = (wpKey) => (value) => ({ [wpKey]: value });
const remapRows = (wpKey, keyMap) => (rows) => ({
  [wpKey]: (Array.isArray(rows) ? rows : []).map(row => Object.fromEntries(Object.entries(keyMap).map(([from, to]) => [to, row?.[from] ?? ''])))
});
const eligibilityRows = (rows) => ({ eligibility_content: htmlToRows(rows, 'eligibility_title', 'eligibility_description') });

// "INR 6,917 /-" -> "6,917" (the first amount in the text; '' if there is none).
export const emiFigure = (value) => (/\d[\d,]*(?:\.\d+)?/.exec(htmlToText(value)) || [''])[0].replace(/,$/, '');

// What the theme adds around a value by itself is never sent with it: if someone typed it, it's taken
// off. The theme prints "₹ <EMI> /month", "<duration> Yrs", "<count> + Specializations" and
// "Est. <year>", so those go bare: "INR 6,917 /-" -> "6,917", "2 Years" -> "2", "12+" -> "12", "Est. 1998" -> "1998".
export function yearsOf(value) {
  const text = htmlToText(value).toLowerCase();
  const nums = [...text.matchAll(/\d+(?:\.\d+)?/g)].map(m => m[0]);
  if (!nums.length) return '';
  const months = /month/.test(text) && !/year|yr/.test(text);
  const fmt = (n) => (months ? String(Number((Number(n) / 12).toFixed(1))) : n);
  return nums.length > 1 && /\d\s*(-|–|to)\s*\d/.test(text) ? `${fmt(nums[0])}-${fmt(nums[1])}` : fmt(nums[0]);
}
const countOf = (value) => (/\d+/.exec(htmlToText(value)) || [''])[0];
const yearOf = (value) => (/\b(1[89]\d\d|20\d\d)\b/.exec(htmlToText(value)) || [''])[0];
const THEME_ADDS = {
  emi_amount: emiFigure, program_duration: yearsOf, duration_specialization: yearsOf,
  num_specializations: countOf, established_year: yearOf
};

// Partner banks / lenders, typed like hiring partners: chips in that page type's own field.
const BANKS_FIELD = { university: 'partner_banks_names', course: 'partner_banks_course', specialization: 'partner_banks_specialization' };
const partnerBanks = (pageType) => (value) => {
  const html = partnersToHtmlList(value);
  return html ? { [BANKS_FIELD[pageType]]: html } : {};
};

const FIELD_MAPS = {
  blog: { complete_page_summary: summaryList },
  category: { complete_page_summary: summaryList },
  university: {
    facts: toHtmlList('facts_content', 'fact_title', 'fact_description'),
    exam_details: remapRows('examination_cards', { detail_label: 'exam_card_title', detail_value: 'exam_card_description' }),
    hiring_partners: hiringPartners('university'),
    accreditations: (rows) => ({ accreditations: namedAccreditations(rows, 'body_name', 'body_descriptor') }),
    // The EMI partners' bank names, as chips (the terms stay facts for the AI's EMI text).
    emi_partners: (rows) => partnerBanks('university')((Array.isArray(rows) ? rows : []).map(r => htmlToText(r?.bank_name)).filter(Boolean).join('\n')),
    faculty_members: (rows) => ({
      // The site's repeater has only name + designation; fold program and qualification in.
      faculty_members: (Array.isArray(rows) ? rows : []).map(r => ({
        member_name: r?.member_name || '',
        member_designation: [r?.member_designation, r?.member_program, r?.member_qualification].filter(v => String(v || '').trim()).join(', ')
      }))
    })
  },
  course: {
    // WordPress renamed the course page's validity field to program_validity (as on specialization
    // pages); a site still on the old name gets it as validity - see FIELD_ALIASES.
    validity: (value) => ({ program_validity: value }),
    hiring_partners: hiringPartners('course'),
    partner_banks: partnerBanks('course'),
    course_accreditations: (rows) => ({ course_accreditations: namedAccreditations(rows, 'course_body_name', 'course_body_descriptor') }),
    emi_amount: (value) => ({ emi_amount: emiFigure(value) }),
    // On course pages the paragraph above the syllabus is course_syllabus_description.
    syllabus_section_paragraph: rename('course_syllabus_description'),
    // course has a highlights repeater of its own AND a single-block copy for the summary display.
    highlights: (rows) => ({ highlights: rows, highlights_section_content: rowsToHtmlList(rows, 'highlight_title', 'highlight_description') }),
    eligibility_content: eligibilityRows,
    syllabus_subjects: (rows) => ({ course_academic_years: syllabusToYears(rows, { yearTitle: 'course_year_title', semesters: 'course_semesters', semesterTitle: 'course_semester_title', semesterSubjects: 'course_semester_subjects' }) })
  },
  specialization: {
    // The page shows EMI twice: "EMI From <emi_amount>" at the top, and a No-Cost EMI box reading
    // "Starting from ₹ <specialization_lowest_emi_strats_from> /month" - which stayed blank because
    // nothing filled that field. Same figure; the box adds the ₹ and /month itself, so just the number.
    emi_amount: (value) => ({ emi_amount: emiFigure(value), specialization_lowest_emi_strats_from: emiFigure(value) }),
    hiring_partners: hiringPartners('specialization'),
    partner_banks: partnerBanks('specialization'),
    validity: (value) => ({ program_validity: value }),
    highlights: toHtmlList('highlights_content', 'highlight_title', 'highlight_description'),
    eligibility_content: eligibilityRows,
    exam_content: rename('examination_content'),
    exam_details: remapRows('examination_process', { detail_label: 'exam_process_title', detail_value: 'exam_process_description' }),
    syllabus_subjects: (rows) => ({ academic_years: syllabusToYears(rows, { yearTitle: 'year_title', semesters: 'semesters', semesterTitle: 'semester_title', semesterSubjects: 'semester_subjects' }) })
  }
};

// WordPress fields filled from what the page already has, with no typing: per page type, app field
// -> [WordPress field, value]. Sent only when there's a value, so a page never loses one entered by
// hand in WordPress.
const hasDigit = (v) => /\d/.test(htmlToText(v));
const amountOf = (v) => Number((htmlToText(v).replace(/,/g, '').match(/\d+(?:\.\d+)?/) || [NaN])[0]);
// "Lowest – highest" of the specialization fees, when there are at least two; one value if all equal.
export function feeRange(rows) {
  const fees = (Array.isArray(rows) ? rows : []).map(r => htmlToText(r?.specialization_details)).filter(hasDigit);
  if (fees.length < 2) return '';
  const sorted = [...fees].sort((a, b) => amountOf(a) - amountOf(b));
  const [low, high] = [sorted[0], sorted[sorted.length - 1]];
  return amountOf(low) === amountOf(high) ? low : `${low} – ${high}`;
}
const DERIVED = {
  course: {
    total_fee: [['best_price_value', (v) => (hasDigit(v) ? v : '')]],
    duration: [['program_duration', (v) => v]],
    syllabus_heading: [['course_syllabus_section_heading', (v) => v]],
    specialization: [['course_amount_range', feeRange]]
  },
  specialization: {
    total_fee: [['best_price_specialization', (v) => (hasDigit(v) ? v : '')]],
    duration: [['duration_specialization', (v) => v]],
    syllabus_heading: [['syllabus_section_heading', (v) => v]]
  }
};

const SEND_ONLY_WHEN_FILLED = [
  'nirf_rank', 'nirf_rank_course', 'emi_interest_rate_value', 'scholarship_facility', 'certificate_validity',
  'specialization_hero_description', 'course_syllabus_description'
];

// Short values the page shows as a stat or badge. A placeholder ("N/A", "-") or the document's own
// "not mentioned" wording would print as written, so those go as empty and the page hides them.
const VALUE_FIELDS = new Set([
  'program_validity', 'validity', 'certificate_validity', 'emi_amount', 'num_specializations', 'num_programs', 'nirf_rank',
  'nirf_rank_course', 'naac_grade', 'ugc_status', 'ugc_approved', 'duration', 'starting_fee', 'total_fee', 'established_year',
  'emi_interest_rate_value', 'course_amount_range', 'best_price_value', 'best_price_specialization', 'program_duration',
  'duration_specialization', 'specialization_lowest_emi_strats_from'
]);
const PLACEHOLDER_RE = /^\s*(n\/?a|na|nil|none|null|not available|not applicable|not mentioned|not specified|-+|—)\s*\.?\s*$/i;
const NOT_GIVEN_RE = /\bnot\s+(?:been\s+)?(?:mentioned|available|specified|applicable|offered|given|provided|disclosed|stated)\b|\bn\/a\b/i;
export function cleanValue(key, value) {
  if (!VALUE_FIELDS.has(key) || typeof value !== 'string') return value;
  const text = htmlToText(value);
  if (PLACEHOLDER_RE.test(text) || NOT_GIVEN_RE.test(text)) return '';
  if (/^num_/.test(key) && !/[1-9]/.test(text)) return ''; // "0 (Not Offered)": none means empty
  return value;
}

// Known differences (step 1). Returns { fields, linkedNames, skipped }: linkedNames are the
// Linked University/Course names still to be turned into post IDs; skipped lists what isn't sent.
export function mapToWordPress(acf, pageType) {
  const maps = FIELD_MAPS[pageType] || {};
  const linked = LINKED_FIELDS[pageType] || {};
  const fields = {};
  const linkedNames = {};
  const skipped = [];

  for (const [key, value] of Object.entries(acf || {})) {
    if (INTERNAL_ONLY_FIELDS.has(key)) continue;
    if (linked[key]) {
      if (String(value || '').trim()) linkedNames[key] = String(value).trim();
      continue;
    }
    if (key === 'hero_image') {
      // The site has no hero image field; it would be the page's Featured Image, which needs the
      // file uploaded to WordPress's media library first - not done yet.
      if (value) skipped.push('hero_image (generated image - attach it in WordPress as the Featured Image)');
      continue;
    }
    if (key === 'fee_plans') {
      const rows = Array.isArray(value) ? value : [];
      fields.fee_plans = rows.map(r => ({ plan_name: r?.plan_name || '', plan_amount: r?.plan_amount || '' }));
      const tierFields = FEE_TIER_FIELDS[pageType];
      if (tierFields) {
        for (const row of rows) {
          for (const [tier, re] of FEE_TIER_KEYWORDS) {
            if (re.test(row?.plan_name || '') && row?.plan_amount && !(tierFields[tier] in fields)) fields[tierFields[tier]] = row.plan_amount;
          }
        }
      }
      continue;
    }
    Object.assign(fields, maps[key] ? maps[key](value) : { [key]: value });
  }
  for (const [source, targets] of Object.entries(DERIVED[pageType] || {})) {
    for (const [wpKey, derive] of targets) {
      const value = derive(acf?.[source]);
      if (!(wpKey in fields) && !isBlank(value) && !(Array.isArray(value) && !value.length)) fields[wpKey] = value;
    }
  }
  // Optional fields added after many pages were already published: left out while empty, so a
  // re-publish never blanks a value someone typed into WordPress directly.
  for (const key of SEND_ONLY_WHEN_FILLED) if (key in fields && isBlank(fields[key])) delete fields[key];
  for (const [key, value] of Object.entries(fields)) {
    const cleaned = cleanValue(key, value);
    fields[key] = THEME_ADDS[key] && typeof cleaned === 'string' && cleaned.trim() ? THEME_ADDS[key](cleaned) : cleaned;
    // A duration with no number in it ("Self-paced") gives no At a Glance figure: leave it out.
    if ((key === 'program_duration' || key === 'duration_specialization') && !fields[key]) delete fields[key];
  }
  return { fields, linkedNames, skipped };
}

// The page's title on WordPress. Course and specialization names are often just the program ("Online
// BA"), which several universities share; the title then leads with the university, as the
// document's own title does ("Lovely Professional University Online BA").
const BARE_PROGRAM_RE = /^(online|distance|executive|mba|mca|bba|bca|m\.?\s?com|b\.?\s?com|m\.?\s?sc|b\.?\s?sc|ma|ba|pgdm|dba|phd|m\.?\s?tech|b\.?\s?tech|pg|diploma|certificate)\b/i;
const TITLE_FIELD = { university: 'university_name', course: 'program_name', specialization: 'spec_name', blog: 'seo_title', category: 'seo_title' };
const normalizeWords = (s) => htmlToText(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
export function pageTitle(pageType, formData) {
  const name = htmlToText(formData?.[TITLE_FIELD[pageType]]);
  const university = htmlToText(formData?.university_name);
  if (!['course', 'specialization'].includes(pageType) || !name || !university || !BARE_PROGRAM_RE.test(name)) return name || 'Untitled';
  const stem = university.replace(/\s+online$/i, '');
  if (normalizeWords(name).includes(normalizeWords(stem))) return name;
  const online = /\s+online$/i.test(university) || /^online\b/i.test(name);
  return `${stem}${online ? ' Online' : ''} ${name.replace(/^online\s+/i, '')}`;
}

// Where a Content Studio field lands on WordPress - for the tags under every field in the editor
// and the Field Settings page. kind: 'sent' (wpKeys = the WordPress field names it fills),
// 'internal' (notes for the AI, never sent), 'linked' (sent as the linked page's ID) or
// 'featured_image' (not sent - attach it in WordPress). `liveFieldNames`: the site's own ACF field
// names when known; each wpKey is then marked present or missing (aliases count, see FIELD_ALIASES).
export function wordpressTargetOf(pageType, field, liveFieldNames = null) {
  const key = field.key;
  if (INTERNAL_ONLY_FIELDS.has(key)) return { kind: 'internal', wpKeys: [] };
  if (key === 'hero_image') return { kind: 'featured_image', wpKeys: [] };
  let wpKeys;
  if (LINKED_FIELDS[pageType]?.[key]) wpKeys = [key];
  else if (key === 'fee_plans') wpKeys = ['fee_plans', ...Object.values(FEE_TIER_FIELDS[pageType] || {})];
  // A sample value, not an empty one: some fields send nothing at all while empty (hiring partners).
  else if (FIELD_MAPS[pageType]?.[key]) {
    const sample = field.type === 'REPEATER' ? [Object.fromEntries((field.subfields || []).map(sf => [sf.key, 'Sample 1']))] : 'Sample 1';
    wpKeys = Object.keys(FIELD_MAPS[pageType][key](sample));
  }
  else wpKeys = [key];
  for (const [wpKey] of DERIVED[pageType]?.[key] || []) wpKeys.push(wpKey);

  const target = { kind: LINKED_FIELDS[pageType]?.[key] ? 'linked' : 'sent', wpKeys };
  if (liveFieldNames) {
    const live = new Set(liveFieldNames);
    const resolved = wpKeys.map(k => (live.has(k) ? k : (FIELD_ALIASES[k] || []).find(a => live.has(a)) || null));
    target.wpKeys = wpKeys.map((k, i) => resolved[i] || k);
    target.missing = wpKeys.filter((_, i) => !resolved[i]);
  }
  return target;
}

// What an Admin-added field can fill, judged from the site's own schema for that ACF field: plain
// text (the Admin picks one line / paragraph / formatted), or a list whose columns are all text
// (built with those columns). Images and page links (stored as IDs), dates and numbers need code.
export function classifyWordPressField(prop) {
  const types = [].concat(prop?.type || []);
  if (types.includes('string') && !types.includes('array') && !types.includes('integer')) {
    if (/Y-m-d|date/i.test(prop.description || '')) return { kind: 'unsupported', reason: 'a date' };
    return { kind: 'text' };
  }
  if (types.includes('array') && prop.items && [].concat(prop.items.type || []).includes('object')) {
    const columns = Object.entries(prop.items.properties || {});
    if (columns.length && columns.every(([, c]) => [].concat(c?.type || []).includes('string'))) {
      return { kind: 'list', columns: columns.map(([key]) => key) };
    }
    return { kind: 'unsupported', reason: 'a list with non-text columns' };
  }
  if (types.includes('array')) return { kind: 'unsupported', reason: 'links to other pages or categories' };
  if (types.includes('integer')) return { kind: 'unsupported', reason: 'an image, file or page link (stored as an ID)' };
  if (types.includes('number')) return { kind: 'unsupported', reason: 'a number' };
  return { kind: 'unsupported', reason: 'a field type the app can\'t fill' };
}

// The site's fields nothing in the app fills yet - what the Admin can add a field for. `builtInFields`:
// the page's built-in schema fields; `customKeys`: names already taken by added fields (archived
// ones too - those are restored, not added again). Returns { addable: [{ key, kind, columns? }],
// unsupported: [{ key, reason }] }, both sorted by name.
export function addableWordPressFields(pageType, liveProps, builtInFields, customKeys = []) {
  const names = Object.keys(liveProps || {});
  const taken = new Set(customKeys);
  for (const field of builtInFields) {
    for (const k of wordpressTargetOf(pageType, field, names).wpKeys) taken.add(k);
    taken.add(field.key);
  }
  const addable = [];
  const unsupported = [];
  for (const key of names.sort()) {
    if (taken.has(key)) continue;
    const c = classifyWordPressField(liveProps[key]);
    if (c.kind === 'unsupported') unsupported.push({ key, reason: c.reason });
    else addable.push({ key, ...c });
  }
  return { addable, unsupported };
}

const typesOf = (schema) => [].concat(schema?.type || []);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isBlank = (v) => v === null || v === undefined || (typeof v === 'string' && !v.trim());

// Step 2: fit a value to the site's own schema for that field. Returns { value } or { drop: true },
// collecting what was left out (and why) in `skipped`. Unknown keys inside a row are removed - on
// this site one extra key rejects the whole repeater.
function conformValue(value, schema, path, skipped) {
  const types = typesOf(schema);
  const allowsNull = types.includes('null');
  if (value === null || value === undefined) return allowsNull ? { value: null } : { drop: true };

  if (types.includes('array') && Array.isArray(value)) {
    const items = schema.items || {};
    const out = [];
    value.forEach((item, i) => {
      const r = conformValue(item, items, `${path}[${i}]`, skipped);
      if (r.drop) return;
      if (isPlainObject(r.value) && Object.values(r.value).every(isBlank)) return; // empty row
      out.push(r.value);
    });
    return { value: out };
  }
  if ((types.includes('object') || schema.properties) && isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const sub = schema.properties?.[k];
      if (!sub) { skipped.push(`${path}.${k} (no such column in WordPress)`); continue; }
      const r = conformValue(v, sub, `${path}.${k}`, skipped);
      if (!r.drop) out[k] = r.value;
    }
    return { value: out };
  }
  if (types.includes('integer') && (Number.isInteger(value) || (typeof value === 'string' && /^\s*-?\d+\s*$/.test(value)))) return { value: Number(value) };
  if (types.includes('number') && value !== '' && Number.isFinite(Number(value))) return { value: Number(value) };
  if (types.includes('string')) {
    if (typeof value === 'string') return { value };
    if (typeof value === 'number' || typeof value === 'boolean') return { value: String(value) };
  }
  if (types.includes('boolean') && typeof value === 'boolean') return { value };
  if (isBlank(value)) return allowsNull ? { value: null } : { drop: true };
  skipped.push(`${path} (WordPress expects ${types.filter(t => t !== 'null').join(' or ')})`);
  return { drop: true };
}

// Other names a WordPress site may use for a field Content Studio sends: ACF builds field names from
// labels and usually drops characters like "&"; and older sites still call program_validity validity.
const FIELD_ALIASES = {
  'job_roles_&_salary_paragraph': ['job_roles_salary_paragraph', 'job_roles__salary_paragraph', 'job_roles_and_salary_paragraph'],
  program_validity: ['validity']
};

// `acfSchema` is the "acf" property of the post type's REST schema (OPTIONS /wp-json/wp/v2/<type>).
// A field WordPress doesn't have (yet) is left out; it's reported only if it had something in it -
// an empty one loses nothing, and reporting every blank optional field would bury the real notes.
export function conformToSchema(fields, acfSchema) {
  const props = acfSchema?.properties;
  if (!props) return { fields, skipped: [] };
  const out = {};
  const skipped = [];
  for (const [key, value] of Object.entries(fields)) {
    const target = props[key] ? key : (FIELD_ALIASES[key] || []).find(alias => props[alias]);
    if (!target) {
      if (!isBlank(value) && !(Array.isArray(value) && !value.length)) skipped.push(`${key} (no such field in WordPress yet)`);
      continue;
    }
    const r = conformValue(value, props[target], target, skipped);
    if (!r.drop) out[target] = r.value;
  }
  return { fields: out, skipped };
}

const normalizeTitle = (s) => htmlToText(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

// Picks the post whose title is exactly `name` (ignoring case/punctuation) from a WordPress search
// result. Several exact matches (e.g. "Online MCA" at different universities) are narrowed to the
// one linked to `universityId` when given; still ambiguous or none -> null.
export function pickLinkedPost(posts, name, universityId = null) {
  const wanted = new Set([].concat(name).map(normalizeTitle));
  let matches = (posts || []).filter(p => wanted.has(normalizeTitle(p?.title?.rendered ?? p?.title)));
  if (matches.length > 1 && universityId) {
    matches = matches.filter(p => [].concat(p?.acf?.linked_university ?? []).map(Number).includes(Number(universityId)));
  }
  return matches.length === 1 ? matches[0].id : null;
}
