import { schemas } from '../../src/config/schemas.js';
import { findSchemaField } from '../../src/config/fieldSettings.js';
import { canEditField } from '../../src/utils/permissions.js';

// The server-side backstop for PUT /api/drafts/:id: the UI already disables locked fields, but
// nothing would stop a direct API call. Runs the frontend's own canEditField (permissions.js, plain
// JS) on the same effective schema the form shows, so the two can never disagree.
// `schema`: the page's effective schema (admin field settings applied - see
// config/fieldSettings.js and repositories/fieldSettingsRepo.js); defaults to the built-in one.
export function canEditFieldServer(pageType, fieldKey, { role, draftStatus, allowInternAiEdit, isDraftOwner = true }, schema = schemas[pageType]) {
  if (role === 'senior' || role === 'admin') return true;

  // An Intern may only edit drafts they own (see isDraftOwnerOrNotIntern in routes/drafts.js).
  if (!isDraftOwner) return false;

  const internHasTurn = draftStatus === 'intern_editing';
  if (!internHasTurn) return false;

  // A field the Admin has hidden isn't on the Intern's form, so nothing of theirs may change it.
  if (schema?.hiddenFieldKeys?.includes(fieldKey)) return false;
  const field = findSchemaField(schema, fieldKey);
  if (!field) return true;
  return canEditField(field, { role, draftStatus, allowInternAiEdit, isDraftOwner });
}
