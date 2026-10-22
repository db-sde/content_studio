// Universities are grouped by a key that ignores case, spacing and punctuation, so "JAIN Online"
// and "Jain online" are one university in the Saved Drafts filter; drafts with no university yet
// share their own key.
export const NO_UNIVERSITY = '__none__';
export const universityKey = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() || NO_UNIVERSITY;
