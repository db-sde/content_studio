// Shared by the global "Paste Data" box (App.jsx), the per-field scoped paste on plain
// text/textarea/rich-text inputs, and the per-repeater table paste (FieldTypes.jsx) — one parser
// so all three paste surfaces agree on what a "key: value" line or a pasted table looks like.

// Normalizes a pasted key so "University Name", "university_name", "UNIVERSITY_NAME" all match
// the same field.
export const normalizeKey = (str) => String(str || '')
  .trim()
  .replace(/^[`"'*]+|[`"'*]+$/g, '')
  .toLowerCase()
  .replace(/[\s-]+/g, '_')
  .replace(/[^a-z0-9_]/g, '');

// Splits pasted text into [key, value] pairs, supporting spreadsheet (tab), markdown table,
// ".env" (key=value), and "key: value" formats — whatever a writer is likely to copy from.
export const parseBulkPasteLines = (text) => {
  const pairs = [];

  text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach(line => {
    if (line.startsWith('|') && line.endsWith('|')) {
      const cells = line.slice(1, -1).split('|').map(c => c.trim());
      if (cells.every(c => /^:?-+:?$/.test(c))) return; // markdown separator row
      if (cells.length >= 2 && cells[0] && cells[1]) pairs.push([cells[0], cells[1]]);
      return;
    }

    if (line.includes('\t')) {
      const [key, ...rest] = line.split('\t');
      const value = rest.join('\t').trim();
      if (key.trim() && value) pairs.push([key.trim(), value]);
      return;
    }

    let match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      if (match[1].trim() && value) pairs.push([match[1].trim(), value]);
      return;
    }

    match = line.match(/^([^:]+):(.*)$/);
    if (match && match[2].trim()) {
      pairs.push([match[1].trim(), match[2].trim()]);
    }
  });

  return pairs;
};

// Lines like "● some text" or "- some text" or "1. some text" are treated as a continuation
// of the previous row's last column, not a new row — this is what lets a pasted table survive
// a cell that itself contains a bulleted, multi-line list (e.g. eligibility criteria).
const BULLET_LINE_RE = /^\s*(?:[•●◦▪‣*-]|\d+[.)])\s*/;

// Splits pasted spreadsheet/table text into repeater rows. Each non-continuation line becomes
// a new row: its cells are assigned positionally to every subfield except the last, and every
// remaining cell (plus any following bullet/continuation lines) is joined into the last
// subfield — the last column is assumed to be the "long text" column, which matches how these
// tables are actually laid out (name/fee/eligibility, question/answer, etc).
export const parseRepeaterPasteText = (text, subfields) => {
  if (!subfields.length) return [];
  const lastKey = subfields[subfields.length - 1].key;
  const rows = [];
  let current = null;

  text.split(/\r?\n/).forEach(rawLine => {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) return;

    if (BULLET_LINE_RE.test(line) && current) {
      const text = line.split('\t').map(c => c.trim()).filter(Boolean).join(' ');
      current[lastKey] = current[lastKey] ? `${current[lastKey]}\n${text}` : text;
      return;
    }

    if (current) rows.push(current);
    const cells = line.split('\t').map(c => c.trim());
    current = {};
    subfields.forEach((sf, i) => {
      current[sf.key] = i < subfields.length - 1
        ? (cells[i] || '')
        : cells.slice(i).join(' ').trim();
    });
  });
  if (current) rows.push(current);

  // Drop a header row if every cell just repeats that subfield's own label (e.g. "Program Fee").
  if (rows.length > 1) {
    const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const looksLikeHeader = subfields.every(sf => {
      const cell = normalize(rows[0][sf.key] || '');
      const labelWords = normalize(sf.label).split(/\s+/).filter(w => w.length >= 3);
      return cell && labelWords.some(w => cell.includes(w));
    });
    if (looksLikeHeader) rows.shift();
  }

  return rows.filter(row => Object.values(row).some(v => String(v).trim() !== ''));
};

// Pulls repeater-shaped tables out of a bigger pasted blob before the flat key:value parser ever
// sees them — the global "Paste Data" box otherwise has no way to tell "here's a 3-row fee table"
// apart from a run of unrelated lines, so this requires the pasted block to be preceded by a line
// naming the repeater's own field label (e.g. a "Fee Plans" line, then the table rows below it).
// That's an unambiguous, teachable convention rather than a guess at column counts, which would
// silently misfire whenever two repeaters on the same page happen to share a column count.
// Returns the matched {repeaterField, rows} blocks plus whatever text was NOT claimed by one, so
// the caller can still run the normal flat-field parser over the leftovers.
export function extractRepeaterBlocks(text, repeaterFields) {
  const labelToRepeater = {};
  repeaterFields.forEach(f => { labelToRepeater[normalizeKey(f.label)] = f; });

  const lines = text.split(/\r?\n/);
  const blocks = [];
  const leftoverLines = [];
  let current = null;

  lines.forEach(rawLine => {
    const line = rawLine.replace(/\r$/, '');
    const trimmed = line.trim();
    if (!trimmed) {
      (current ? current.lines : leftoverLines).push(line);
      return;
    }

    const repeater = labelToRepeater[normalizeKey(trimmed.replace(/[:*]+$/, ''))];
    if (repeater) {
      current = { repeaterField: repeater, lines: [] };
      blocks.push(current);
      return;
    }

    (current ? current.lines : leftoverLines).push(line);
  });

  const populated = blocks
    .map(b => ({ repeaterField: b.repeaterField, rows: parseRepeaterPasteText(b.lines.join('\n'), b.repeaterField.subfields) }))
    .filter(b => b.rows.length > 0);

  return { blocks: populated, remainingText: leftoverLines.join('\n') };
}

// What a single field does with a Ctrl+V (TextInput / TextArea / RichText). Returns:
//   { action: 'default' }        - let the paste happen normally (the usual case);
//   { action: 'insert', value }  - the paste is a multi-field blob with a line for THIS field:
//                                  put just that line's value in;
//   { action: 'ignore' }         - a multi-field blob without this field: don't dump it here (the
//                                  field shows a hint to use Paste Data instead).
// A "multi-field blob" is text with "Label: value" lines for at least two of the page's OTHER
// fields (`knownFieldNames`: the page's field keys and labels, normalized). Anything else - several
// paragraphs, a bulleted list, a web address, "NMIMS: a leading university..." - is ordinary
// content and pastes normally. (An earlier rule treated any paste with a line break or an early
// colon as a blob and silently dropped it, so multi-paragraph text and links couldn't be pasted.)
export const decideFieldPaste = (text, { fieldKey, label, knownFieldNames = new Set() }) => {
  const trimmed = String(text || '').trim();
  if (!trimmed) return { action: 'default' };
  const pairs = parseBulkPasteLines(trimmed);
  if (!pairs.length) return { action: 'default' };

  const own = new Set([normalizeKey(fieldKey), normalizeKey(label)]);
  const ownPair = pairs.find(([k]) => own.has(normalizeKey(k)));
  const otherFields = new Set(pairs.map(([k]) => normalizeKey(k)).filter(k => knownFieldNames.has(k) && !own.has(k)));

  if (otherFields.size >= 2) return ownPair ? { action: 'insert', value: ownPair[1] } : { action: 'ignore' };
  // A single "This Field: value" line (e.g. copied from a filled-in template): take just the value.
  if (ownPair && pairs.length === 1 && !/\r?\n/.test(trimmed)) return { action: 'insert', value: ownPair[1] };
  return { action: 'default' };
};

// What a paste into one cell of a list (repeater) does: 'rows' splits it into rows/columns,
// 'default' leaves it in the cell. A spreadsheet copy (tabs) is always rows. Several lines without
// tabs are rows only in a one-line cell (a column copied from a sheet); in a multi-line cell - an
// FAQ answer, a review, a description - or a bullet-list cell they are that cell's own text.
export const decideSubfieldPaste = (text, subfield) => {
  const value = String(text || '');
  if (value.includes('\t')) return 'rows';
  if (!/\r?\n/.test(value.trim())) return 'default';
  if (subfield.outputFormat === 'bullets' || subfield.type === 'textarea') return 'default';
  return 'rows';
};

// Builds the knownFieldNames set decideFieldPaste needs, from a page type's schema.
export const fieldNamesOf = (schema) => new Set((schema?.sections || []).flatMap(sec => sec.fields)
  .flatMap(f => [normalizeKey(f.key), normalizeKey(f.label)]));
