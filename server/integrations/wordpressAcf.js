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
const INTERNAL_ONLY_FIELDS = new Set([
  'about_additional_notes', 'why_choose_additional_notes', 'emi_additional_notes', 'placement_additional_notes'
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

// Per page type: what each Content Studio field becomes on WordPress. Each entry gets the field's
// value and returns { wpKey: value, ... } to send in its place (an empty object = not sent).
const toHtmlList = (wpKey, titleKey, descKey) => (rows) => ({ [wpKey]: rowsToHtmlList(rows, titleKey, descKey) });
const rename = (wpKey) => (value) => ({ [wpKey]: value });
const remapRows = (wpKey, keyMap) => (rows) => ({
  [wpKey]: (Array.isArray(rows) ? rows : []).map(row => Object.fromEntries(Object.entries(keyMap).map(([from, to]) => [to, row?.[from] ?? ''])))
});
const eligibilityRows = (rows) => ({ eligibility_content: htmlToRows(rows, 'eligibility_title', 'eligibility_description') });

// "INR 6,917 /-" -> "6,917" (the first amount in the text; '' if there is none).
export const emiFigure = (value) => (/\d[\d,]*(?:\.\d+)?/.exec(htmlToText(value)) || [''])[0];

const FIELD_MAPS = {
  university: {
    facts: toHtmlList('facts_content', 'fact_title', 'fact_description'),
    exam_details: remapRows('examination_cards', { detail_label: 'exam_card_title', detail_value: 'exam_card_description' }),
    placement_stats: toHtmlList('placement_highlights', 'stat_label', 'stat_value'),
    emi_partners: (rows) => ({ partner_banks_names: (Array.isArray(rows) ? rows : []).map(r => htmlToText(r?.bank_name)).filter(Boolean).join(', ') }),
    faculty_members: (rows) => ({
      // The site's repeater has only name + designation; fold program and qualification in.
      faculty_members: (Array.isArray(rows) ? rows : []).map(r => ({
        member_name: r?.member_name || '',
        member_designation: [r?.member_designation, r?.member_program, r?.member_qualification].filter(v => String(v || '').trim()).join(', ')
      }))
    })
  },
  course: {
    // course has a highlights repeater of its own AND a single-block copy for the summary display.
    highlights: (rows) => ({ highlights: rows, highlights_section_content: rowsToHtmlList(rows, 'highlight_title', 'highlight_description') }),
    eligibility_content: eligibilityRows,
    syllabus_subjects: (rows) => ({ course_academic_years: syllabusToYears(rows, { yearTitle: 'course_year_title', semesters: 'course_semesters', semesterTitle: 'course_semester_title', semesterSubjects: 'course_semester_subjects' }) })
  },
  specialization: {
    // The page shows EMI twice: "EMI From <emi_amount>" at the top, and a No-Cost EMI box reading
    // "Starting from ₹ <specialization_lowest_emi_strats_from> /month" - which stayed blank because
    // nothing filled that field. Same figure; the box adds the ₹ and /month itself, so just the number.
    emi_amount: (value) => ({ emi_amount: value, specialization_lowest_emi_strats_from: emiFigure(value) }),
    highlights: toHtmlList('highlights_content', 'highlight_title', 'highlight_description'),
    eligibility_content: eligibilityRows,
    exam_content: rename('examination_content'),
    exam_details: remapRows('examination_process', { detail_label: 'exam_process_title', detail_value: 'exam_process_description' }),
    syllabus_subjects: (rows) => ({ academic_years: syllabusToYears(rows, { yearTitle: 'year_title', semesters: 'semesters', semesterTitle: 'semester_title', semesterSubjects: 'semester_subjects' }) })
  }
};

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
  return { fields, linkedNames, skipped };
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

// `acfSchema` is the "acf" property of the post type's REST schema (OPTIONS /wp-json/wp/v2/<type>).
export function conformToSchema(fields, acfSchema) {
  const props = acfSchema?.properties;
  if (!props) return { fields, skipped: [] };
  const out = {};
  const skipped = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!props[key]) { skipped.push(`${key} (no such field in WordPress)`); continue; }
    const r = conformValue(value, props[key], key, skipped);
    if (!r.drop) out[key] = r.value;
  }
  return { fields: out, skipped };
}

const normalizeTitle = (s) => htmlToText(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

// Picks the post whose title is exactly `name` (ignoring case/punctuation) from a WordPress search
// result. Several exact matches (e.g. "Online MCA" at different universities) are narrowed to the
// one linked to `universityId` when given; still ambiguous or none -> null.
export function pickLinkedPost(posts, name, universityId = null) {
  const wanted = normalizeTitle(name);
  let matches = (posts || []).filter(p => normalizeTitle(p?.title?.rendered ?? p?.title) === wanted);
  if (matches.length > 1 && universityId) {
    matches = matches.filter(p => [].concat(p?.acf?.linked_university ?? []).map(Number).includes(Number(universityId)));
  }
  return matches.length === 1 ? matches[0].id : null;
}
