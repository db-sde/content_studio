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

// Powers the per-field "paste corner" on plain text/textarea/rich-text fields — pasting a big,
// multi-field blob directly onto ONE field must only ever apply that one field's own value, never
// leak another field's content into it. A plain single-value paste (the common "copied just this
// cell" case) is returned verbatim so normal paste behavior is unaffected; a structured paste
// (multiple lines, or a single "key: value"/"key=value" line) is parsed and matched strictly by
// this field's own key/label, returning null — not a fallback guess — when nothing matches, so the
// field is left untouched rather than filled with the wrong thing.
export const extractSingleFieldValue = (text, { fieldKey, label }) => {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const looksStructured = /\r?\n/.test(trimmed) || /^[^:=\t]+[:=\t]/.test(trimmed);
  if (!looksStructured) return trimmed;

  const wanted = new Set([normalizeKey(fieldKey), normalizeKey(label)]);
  const pairs = parseBulkPasteLines(text);
  const match = pairs.find(([k]) => wanted.has(normalizeKey(k)));
  return match ? match[1] : null;
};
