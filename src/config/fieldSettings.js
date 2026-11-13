// Admin-controlled field settings (the Field Settings page): per page type, per field, whether it is
// shown, mandatory, AI-generated, and who fills it in. schemas.js holds each field's default; the
// admin's changes are stored in the field_settings table as overrides (null = keep the default), so
// "Reset to default" just removes the row and a default changed in code still reaches every field
// the admin hasn't touched.
//
// buildEffectiveSchemas() turns the defaults + overrides into the schemas everything else reads -
// the form, validation, permissions and AI generation - in the browser and on the server alike, so
// the two can never disagree. Publishing still uses the full schemas: a hidden field keeps sending
// what was saved in it, so hiding a field never wipes content already live on WordPress.
import { schemas } from './schemas.js';

export const SETTING_KEYS = ['visible', 'required', 'aiGenerated', 'internFillable', 'aiInstructions'];

// Fields every page needs to work: its title, the university it belongs to (drafts are filtered and
// labelled by it) and the Linked University/Course that place it on WordPress. Always shown,
// always mandatory, never AI-written.
export const LOCKED_FIELD_KEYS = {
  university: ['university_name'],
  course: ['program_name', 'university_name', 'linked_university'],
  specialization: ['spec_name', 'university_name', 'linked_university', 'linked_course']
};
export const isLockedField = (pageType, fieldKey) => (LOCKED_FIELD_KEYS[pageType] || []).includes(fieldKey);

// The AI writes text; lists (repeaters) and dropdowns can't be AI-generated.
const AI_CAPABLE_TYPES = new Set(['TEXT_INPUT', 'TEXTAREA', 'RICH_TEXT']);
export const canBeAiGenerated = (field) => AI_CAPABLE_TYPES.has(field.type);

export const defaultAiInstructions = (field) =>
  `Write the "${field.label}" for this page in clear, plain language, grounded only in the facts provided.`;

// Who fills a field unless the Admin says otherwise: an Intern may type in every hand-filled field,
// and in the AI fields on university pages (those arrive already written in the content team's
// docs); other AI fields are the AI's. Follows the AI setting - a field the Admin takes off the AI
// becomes the Intern's to fill, and one put on the AI becomes the AI's.
export const defaultInternFillable = (field, aiGenerated) => !aiGenerated || !!(field.aiAssist && field.internWritable);

// What a field does when nobody has changed it.
export function defaultSettingOf(field) {
  return {
    visible: true,
    required: !!field.required,
    aiGenerated: !!field.aiAssist,
    internFillable: defaultInternFillable(field, !!field.aiAssist),
    aiInstructions: field.aiAssist?.instructions || ''
  };
}

const isSet = (v) => v !== null && v !== undefined;

// One field's settings: its defaults with the admin's (non-null) overrides on top.
export function resolveFieldSetting(pageType, field, override) {
  const setting = defaultSettingOf(field);
  const applies = override && !isLockedField(pageType, field.key);
  if (applies) {
    for (const key of SETTING_KEYS) {
      if (isSet(override[key])) setting[key] = override[key];
    }
  }
  if (!canBeAiGenerated(field)) setting.aiGenerated = false;
  if (setting.aiGenerated && !String(setting.aiInstructions || '').trim()) setting.aiInstructions = defaultAiInstructions(field);
  if (!(applies && isSet(override.internFillable))) setting.internFillable = defaultInternFillable(field, setting.aiGenerated);
  if (!setting.visible) setting.required = false;
  return setting;
}

const overrideIndex = (overrides) => {
  const byKey = new Map();
  for (const o of overrides || []) byKey.set(`${o.pageType}:${o.fieldKey}`, o);
  return byKey;
};

// `overrides`: [{ pageType, fieldKey, visible, required, aiGenerated, internFillable, aiInstructions }]
// as GET /api/field-settings returns them. Each page type's schema keeps only its visible fields
// (sections left empty are dropped) and lists the hidden ones in `hiddenFieldKeys`. In the result a
// field's `required` and `aiAssist` reflect the settings, and `internWritable` is set on every field:
// whether an Intern may fill it in (see canEditField).
export function buildEffectiveSchemas(overrides = []) {
  const byKey = overrideIndex(overrides);
  const result = {};
  for (const [pageType, schema] of Object.entries(schemas)) {
    const hiddenFieldKeys = [];
    const sections = schema.sections.map(section => ({
      ...section,
      fields: section.fields.flatMap(field => {
        const s = resolveFieldSetting(pageType, field, byKey.get(`${pageType}:${field.key}`));
        if (!s.visible) {
          hiddenFieldKeys.push(field.key);
          return [];
        }
        const effective = { ...field, required: s.required, internWritable: s.internFillable };
        if (s.aiGenerated) {
          effective.aiAssist = { ...(field.aiAssist || {}), instructions: String(s.aiInstructions || '').trim() || field.aiAssist?.instructions || defaultAiInstructions(field) };
        } else {
          delete effective.aiAssist;
        }
        return [effective];
      })
    })).filter(section => section.fields.length);
    result[pageType] = { ...schema, sections, hiddenFieldKeys };
  }
  return result;
}

// Hand-filled fields an Intern isn't allowed to fill ("Senior & Admin only"). Left out of what an
// Intern must complete before generating or sending on - they can't fill them, so they mustn't be
// blocked by them; the Senior/Admin fills them, and approval still requires them.
export const isSeniorOnlyField = (field) => field.internWritable === false && !field.aiAssist;

// What the validators should skip for this viewer at this stage (see validateState's skipField).
export const fieldsOutOfInternReach = ({ role, draftStatus }) =>
  (role === 'intern' && draftStatus === 'intern_editing') ? isSeniorOnlyField : undefined;

export const aiOutputFormatOf = (field) =>
  field.type === 'RICH_TEXT' ? 'markdown' : field.type === 'TEXT_INPUT' ? 'plain-short' : 'plain';

export function findSchemaField(schema, fieldKey) {
  for (const section of schema?.sections || []) {
    const field = section.fields.find(f => f.key === fieldKey);
    if (field) return field;
  }
  return null;
}

// The AI fields of a page, in the shape the generation endpoints take.
export function aiFieldsOf(schema) {
  return (schema?.sections || []).flatMap(section => section.fields
    .filter(field => field.aiAssist)
    .map(field => ({
      fieldKey: field.key,
      fieldLabel: field.label,
      fieldInstructions: field.aiAssist.instructions,
      outputFormat: aiOutputFormatOf(field)
    })));
}

// Facts handed to the AI: every shown, hand-filled field's value. FAQs and reviews are left out -
// they're separate content blocks, not facts about the entity, and only inflate every call.
const AI_FACTS_EXCLUDED_KEYS = new Set(['faqs', 'reviews']);
export function aiFactsOf(schema, formData) {
  const facts = {};
  for (const section of schema?.sections || []) {
    for (const field of section.fields) {
      if (!field.aiAssist && !AI_FACTS_EXCLUDED_KEYS.has(field.key)) facts[field.key] = formData?.[field.key];
    }
  }
  return facts;
}
