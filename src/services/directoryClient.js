import { getJSON } from './httpClient.js';

// Backs the searchable Linked University / Linked Course dropdowns — pageType is 'university' or
// 'course' (specializations aren't tracked; nothing links to one by name).
export function listDirectoryEntries(pageType) {
  return getJSON(`/api/directory?pageType=${encodeURIComponent(pageType)}`);
}
