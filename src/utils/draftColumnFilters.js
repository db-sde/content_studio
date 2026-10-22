// Dropdown filters on the Saved Drafts table's column headers. Each column turns a draft into one or
// more filter values ({ key, label, group? }); a draft passes a column's filter when one of its
// values has the chosen key. A draft can carry several keys - e.g. one edited today is also in
// "Last 7 days" and "Last 30 days", and a sent-back draft at Senior Review matches both "Senior
// Review" and "Sent back". Option counts are faceted: each dropdown counts the drafts passing every
// OTHER active filter, so the numbers always say what choosing that option would show.
import { universityKey } from './universityFilter.js';

export const ALL = 'all';

const DAY_MS = 24 * 60 * 60 * 1000;
const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// "Online MBA in AI for Finance" -> "Online MBA"; "Online MBA With PMI Certification" -> "Online
// MBA"; "MBA (Executive)" -> "MBA". The program a specialization/course title belongs to.
export function programOf(title) {
  const t = String(title || '').replace(/\s+/g, ' ').trim();
  const cut = /^(.*?)\s*(?:\(|:|\s[-–—]\s|\s(?:in|with|for)\s)/i.exec(t);
  return (cut && cut[1].trim()) || t;
}

const sameLocalDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// `h` - helpers from the app: title(d), isUntitled(d), isDuplicate(d), isRepeated(d), ownerId(d),
// ownerName(d), statusLabels, pageTypeLabel(type), now (a Date).
export function buildDraftColumns(h) {
  return [
    {
      id: 'university',
      values: (d) => {
        const name = String(d.university_name || '').trim();
        return [name ? { key: universityKey(name), label: name } : { key: universityKey(''), label: 'No university yet', order: 1 }];
      },
      sort: 'label'
    },
    {
      id: 'pageType',
      values: (d) => [{ key: d.page_type, label: h.pageTypeLabel(d.page_type) }],
      sort: 'label'
    },
    {
      id: 'program',
      values: (d) => {
        if (h.isUntitled(d)) return [{ key: '__untitled', label: 'Untitled', order: 2 }];
        if (d.page_type === 'university') return [{ key: '__university_pages', label: 'University pages', order: 1 }];
        const program = programOf(h.title(d));
        return [{ key: normalize(program), label: program }];
      },
      sort: 'label'
    },
    {
      id: 'intern',
      values: (d) => {
        const id = h.ownerId(d);
        return [id ? { key: `user:${id}`, label: h.ownerName(d) || 'Unknown' } : { key: '__none', label: 'Nobody', order: 1 }];
      },
      sort: 'label'
    },
    {
      id: 'duplicate',
      values: (d) => {
        if (h.isUntitled(d)) return [{ key: 'untitled', label: 'Untitled', order: 4 }];
        if (h.isDuplicate(d)) return [{ key: 'duplicate', label: 'Duplicate', order: 3 }];
        if (h.isRepeated(d)) return [{ key: 'original', label: 'Original (repeated)', order: 2 }];
        return [{ key: 'unique', label: 'Unique', order: 1 }];
      },
      sort: 'order'
    },
    {
      id: 'status',
      values: (d) => [
        { key: d.status, label: h.statusLabels[d.status] || d.status, order: ['intern_editing', 'senior_review', 'admin_review', 'approved'].indexOf(d.status) + 1 },
        ...(d.prioritized_at ? [{ key: 'sent_back', label: 'Sent back', order: 9 }] : [])
      ],
      sort: 'order'
    },
    {
      id: 'edited',
      values: (d) => {
        const at = new Date(d.updated_at);
        const age = h.now - at;
        const when = Number.isNaN(age) ? [] : [
          ...(sameLocalDay(at, h.now) ? [{ key: 'today', label: 'Today', group: 'When', order: 1 }] : []),
          ...(age <= 7 * DAY_MS ? [{ key: '7d', label: 'Last 7 days', group: 'When', order: 2 }] : []),
          ...(age <= 30 * DAY_MS ? [{ key: '30d', label: 'Last 30 days', group: 'When', order: 3 }] : [{ key: 'older', label: 'Older than 30 days', group: 'When', order: 4 }])
        ];
        const by = d.last_edited_by_name ? [{ key: `by:${normalize(d.last_edited_by_name)}`, label: d.last_edited_by_name, group: 'Edited by', order: 10 }] : [];
        return [...when, ...by];
      },
      sort: 'order'
    }
  ];
}

export function matchesColumn(draft, column, selected) {
  return selected === ALL || selected === undefined || column.values(draft).some(v => v.key === selected);
}

// Every active filter except `exceptId` (the column whose options are being counted).
export function matchesOtherColumns(draft, columns, filters, exceptId = null) {
  return columns.every(c => c.id === exceptId || matchesColumn(draft, c, filters[c.id]));
}

// [{ key, label, group, count }]. A key's label is its most common spelling ("Jain University
// Online" over "JAIN University  Online"); sorted by fixed order where a column has one, then
// alphabetically.
export function columnOptions(drafts, column) {
  const byKey = new Map();
  for (const d of drafts) {
    for (const v of column.values(d)) {
      if (!byKey.has(v.key)) byKey.set(v.key, { key: v.key, group: v.group || null, order: v.order ?? 0, count: 0, labels: new Map() });
      const o = byKey.get(v.key);
      o.count++;
      o.labels.set(v.label, (o.labels.get(v.label) || 0) + 1);
    }
  }
  return [...byKey.values()]
    .map(o => ({ key: o.key, group: o.group, order: o.order, count: o.count, label: [...o.labels.entries()].sort((a, b) => b[1] - a[1])[0][0] }))
    .sort((a, b) => (column.sort === 'order' || a.order || b.order ? a.order - b.order : 0) || a.label.localeCompare(b.label));
}

// The options to show: counted over `facetedDrafts` (those passing the other filters), plus the
// current choice even when nothing passes with it - under its own name with (0), so the dropdown
// still says what is selected. `allDrafts` supplies that name.
export function columnOptionsWithChoice(allDrafts, facetedDrafts, column, selected) {
  const options = columnOptions(facetedDrafts, column);
  if (selected === ALL || selected === undefined || options.some(o => o.key === selected)) return options;
  const known = columnOptions(allDrafts, column).find(o => o.key === selected);
  return known ? [...options, { ...known, count: 0 }].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label)) : options;
}
