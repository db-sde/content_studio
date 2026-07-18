import { schemas } from '../../src/config/schemas.js';

// Mirrors src/utils/permissions.js's canEditField exactly. Imports the same schemas.js the
// frontend uses (plain data + lucide-react component refs, no browser-only APIs — safe to import
// under Node) so the aiAssist classification can never drift between client and server. This is
// the server-side backstop for PUT /api/drafts/:id — the UI already disables locked fields and
// filters the JSON edit-mode's bulk-apply, but nothing enforced it against a direct API call.
function findField(pageType, fieldKey) {
  const schema = schemas[pageType];
  if (!schema) return null;
  for (const section of schema.sections) {
    const field = section.fields.find(f => f.key === fieldKey);
    if (field) return field;
  }
  return null;
}

export function canEditFieldServer(pageType, fieldKey, { role, draftStatus, allowInternAiEdit }) {
  if (role === 'senior' || role === 'admin') return true;

  const internHasTurn = draftStatus === 'intern_editing';
  if (!internHasTurn) return false;

  const field = findField(pageType, fieldKey);
  if (field?.aiAssist) return !!allowInternAiEdit;
  return true;
}
