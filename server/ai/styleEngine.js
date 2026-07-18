import { getActiveStyleVersion } from '../repositories/styleVersionsRepo.js';

let cached = null;

// Loads the single active editorial_style_versions row, cached for the process lifetime since it
// rarely changes. Explicitly invalidated by clearStyleCache() whenever the Style Evolution
// workflow activates a new version, so a newly-activated style takes effect immediately rather
// than requiring a server restart.
export async function getActiveStyle() {
  if (cached) return cached;

  const row = await getActiveStyleVersion();
  if (!row) {
    throw new Error('No active editorial_style_versions row found — this should have been seeded on boot.');
  }

  cached = { version: row.version, style_json: JSON.parse(row.style_json) };
  return cached;
}

export function clearStyleCache() {
  cached = null;
}
