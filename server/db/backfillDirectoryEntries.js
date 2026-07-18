// One-time backfill: the directory_entries table (which backs the searchable Linked
// University/Linked Course dropdowns) is only populated going forward, on each new approve
// action — any university/course draft that was already 'approved' before this feature existed
// has no row yet. Run once, any time, safe to re-run (upsertDirectoryEntry is keyed by draft_id):
//
//   node server/db/backfillDirectoryEntries.js
import { getDb } from './index.js';
import { listDrafts, getDraftById } from '../repositories/draftsRepo.js';
import { upsertDirectoryEntry } from '../repositories/directoryRepo.js';

const TITLE_FIELD_BY_PAGE_TYPE = {
  university: 'university_name',
  course: 'program_name'
};

async function main() {
  await getDb();

  const summaries = await listDrafts();
  const candidates = summaries.filter(d => d.status === 'approved' && TITLE_FIELD_BY_PAGE_TYPE[d.page_type]);

  let count = 0;
  for (const summary of candidates) {
    const draft = await getDraftById(summary.id);
    const titleField = TITLE_FIELD_BY_PAGE_TYPE[draft.page_type];
    const displayName = draft.form_data[titleField];
    if (!displayName) {
      console.log(`[backfill-directory] skipping ${draft.id} — ${titleField} is empty`);
      continue;
    }
    const secondaryLabel = draft.page_type === 'course' ? (draft.form_data.university_name || null) : null;
    await upsertDirectoryEntry({ draftId: draft.id, pageType: draft.page_type, displayName, secondaryLabel });
    console.log(`[backfill-directory] ${draft.page_type}: "${displayName}"${secondaryLabel ? ` (${secondaryLabel})` : ''} (${draft.id})`);
    count++;
  }

  console.log(`[backfill-directory] done — ${count} entr${count === 1 ? 'y' : 'ies'} upserted.`);
  process.exit(0);
}

main().catch(e => {
  console.error('[backfill-directory] failed:', e);
  process.exit(1);
});
