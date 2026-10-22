// The Saved Drafts university filter groups spellings that differ only in case, spacing or
// punctuation ("JAIN Online" / "Jain online"); drafts with no university yet get their own entry.
export const NO_UNIVERSITY = '__none__';
export const universityKey = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() || NO_UNIVERSITY;

// One option per university, labelled with its most common spelling, alphabetical, the
// "no university yet" entry last.
export function universityOptions(drafts) {
  const groups = new Map();
  for (const d of drafts) {
    const key = universityKey(d.university_name);
    if (!groups.has(key)) groups.set(key, { key, count: 0, spellings: new Map() });
    const g = groups.get(key);
    g.count++;
    const spelling = String(d.university_name || '').trim();
    if (spelling) g.spellings.set(spelling, (g.spellings.get(spelling) || 0) + 1);
  }
  return [...groups.values()]
    .map(g => ({
      key: g.key,
      count: g.count,
      label: g.key === NO_UNIVERSITY ? 'No university yet' : [...g.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0]
    }))
    .sort((a, b) => (a.key === NO_UNIVERSITY) - (b.key === NO_UNIVERSITY) || a.label.localeCompare(b.label));
}
