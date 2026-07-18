// Single source of truth for "can this user edit this field right now" — consulted by App.jsx's
// per-field renderer and reused by the JSON slide-over's bulk-apply (Phase 6) so both paths
// enforce the exact same rule.
//
// Rules:
// - Senior or Admin: always true. Admin has every permission Senior has, plus the final
//   approve-and-publish step — never more locked than Senior, never less.
// - Intern, non-AI field, draft still with the Intern (intern_editing): true.
// - Intern, AI field: true only if the Senior has explicitly unlocked it for this draft
//   (allowInternAiEdit) AND the draft is still with the Intern.
// - Anything else (draft in senior_review/admin_review/approved, etc.): false for the Intern.
export function canEditField(field, { role, draftStatus, allowInternAiEdit }) {
  if (role === 'senior' || role === 'admin') return true;

  const internHasTurn = draftStatus === 'intern_editing';
  if (!internHasTurn) return false;

  if (field.aiAssist) return !!allowInternAiEdit;
  return true;
}

// Explains a locked field to an Intern — a plain grayed-out box with no reason reads as broken
// rather than as "wait for AI" or "wait for the Senior/Admin". Mirrors canEditField's exact
// branches so the two can never disagree about whether/why a field is locked. Returns null when
// editable.
export function getLockReason(field, { role, draftStatus, allowInternAiEdit }) {
  if (role === 'senior' || role === 'admin') return null;
  if (draftStatus === 'admin_review') return 'With Admin for review';
  if (draftStatus !== 'intern_editing') return 'With Senior for review';
  if (field.aiAssist && !allowInternAiEdit) return 'AI-generated field';
  return null;
}
