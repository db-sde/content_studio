import { Router } from 'express';
import { asyncRoute } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';
import { schemas } from '../../src/config/schemas.js';
import { isLockedField, canBeAiGenerated, findSchemaField, humanizeFieldKey, customFieldToSchemaField } from '../../src/config/fieldSettings.js';
import {
  listFieldSettings, upsertFieldSetting, deleteFieldSetting, listCustomFields, insertCustomField,
  updateCustomField, setCustomFieldArchived, countDraftsMissingField, getPublishSchemas
} from '../repositories/fieldSettingsRepo.js';
import { wordpressTargetOf, addableWordPressFields, classifyWordPressField } from '../integrations/wordpressAcf.js';
import { getWordPressAcfProperties } from '../integrations/wordpressClient.js';

// The Admin's Field Settings page. Everyone signed in reads the settings (every form is built from
// them); only an Admin changes them, adds fields or removes them.
export const fieldSettingsRouter = Router();

const BOOLEAN_SETTINGS = ['visible', 'required', 'aiGenerated', 'internFillable'];
const TEXT_TYPES = ['TEXT_INPUT', 'TEXTAREA', 'RICH_TEXT'];
const MAX_INSTRUCTIONS = 2000;
const MAX_LABEL = 80;
const MAX_PLACEHOLDER = 200;

function httpError(status, message) {
  const err = new Error(message); err.status = status; return err;
}
const badRequest = (message) => httpError(400, message);

const assertPageType = (pageType) => {
  if (!schemas[pageType]) throw badRequest('Unknown page type');
};

fieldSettingsRouter.get('/', asyncRoute(async (req, res) => {
  const [overrides, customFields] = await Promise.all([listFieldSettings(), listCustomFields()]);
  res.json({ overrides, customFields });
}));

// Where every field goes on WordPress, checked against the live site's field list when it answers
// (cached there for 10 minutes) - backs the "→ WordPress" tags under each field - and the site's
// fields nothing fills yet, which the Admin can add a field for.
fieldSettingsRouter.get('/wordpress', asyncRoute(async (req, res) => {
  const pageTypes = Object.keys(schemas);
  const [liveProps, publishSchemas, customFields] = await Promise.all([
    Promise.all(pageTypes.map(getWordPressAcfProperties)),
    getPublishSchemas(),
    listCustomFields()
  ]);
  const targets = {};
  const checkedLive = {};
  const available = {};
  pageTypes.forEach((pageType, i) => {
    const names = liveProps[i] ? Object.keys(liveProps[i]) : null;
    checkedLive[pageType] = !!names;
    targets[pageType] = {};
    for (const section of publishSchemas[pageType].sections) {
      for (const field of section.fields) targets[pageType][field.key] = wordpressTargetOf(pageType, field, names);
    }
    available[pageType] = names
      ? addableWordPressFields(pageType, liveProps[i], schemas[pageType].sections.flatMap(s => s.fields), customFields.filter(c => c.pageType === pageType).map(c => c.fieldKey))
      : null;
  });
  res.json({ targets, checkedLive, available });
}));

// Any field on the page now - built-in or an active added one.
async function fieldOr400(pageType, fieldKey) {
  assertPageType(pageType);
  const field = findSchemaField((await getPublishSchemas())[pageType], fieldKey);
  if (!field) throw badRequest('Unknown field');
  if (isLockedField(pageType, fieldKey)) throw badRequest(`"${field.label}" is needed for every page to work, so it can't be changed`);
  return field;
}

// visible / required / aiGenerated / internFillable (true, false, or null = back to the default) and
// aiInstructions (text, or null) - only those present in `body`.
function settingsChangesFrom(body, field) {
  const changes = {};
  for (const key of BOOLEAN_SETTINGS) {
    if (!(key in body)) continue;
    if (body[key] !== null && typeof body[key] !== 'boolean') throw badRequest(`${key} must be true, false or null`);
    changes[key] = body[key];
  }
  if ('aiInstructions' in body) {
    if (body.aiInstructions !== null && typeof body.aiInstructions !== 'string') throw badRequest('aiInstructions must be text');
    const text = body.aiInstructions === null ? null : body.aiInstructions.trim();
    if (text && text.length > MAX_INSTRUCTIONS) throw badRequest(`AI instructions can be at most ${MAX_INSTRUCTIONS} characters`);
    changes.aiInstructions = text || null;
  }
  if (changes.aiGenerated === true && !canBeAiGenerated(field)) throw badRequest(`"${field.label}" is a list or a dropdown - the AI can only write text fields`);
  return changes;
}

const everything = async () => {
  const [overrides, customFields] = await Promise.all([listFieldSettings(), listCustomFields()]);
  return { overrides, customFields };
};

fieldSettingsRouter.put('/:pageType/:fieldKey', requireRole('admin'), asyncRoute(async (req, res) => {
  const { pageType, fieldKey } = req.params;
  const field = await fieldOr400(pageType, fieldKey);
  const changes = settingsChangesFrom(req.body || {}, field);
  if (!Object.keys(changes).length) throw badRequest('Nothing to change');
  await upsertFieldSetting({ pageType, fieldKey, changes, userId: req.currentUser.id });
  res.json(await everything());
}));

// "Reset to default".
fieldSettingsRouter.delete('/:pageType/:fieldKey', requireRole('admin'), asyncRoute(async (req, res) => {
  const { pageType, fieldKey } = req.params;
  await fieldOr400(pageType, fieldKey);
  await deleteFieldSetting(pageType, fieldKey);
  res.json(await everything());
}));

// Drafts with nothing in this field, by status - shown before the Admin makes it mandatory.
fieldSettingsRouter.get('/:pageType/:fieldKey/impact', requireRole('admin'), asyncRoute(async (req, res) => {
  const { pageType, fieldKey } = req.params;
  await fieldOr400(pageType, fieldKey);
  res.json({ missingByStatus: await countDraftsMissingField(pageType, fieldKey) });
}));

// --- Fields an Admin adds ---------------------------------------------------------------------------

function labelFrom(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') throw badRequest('label must be text');
  const label = value.trim();
  if (!label) throw badRequest('The field needs a name');
  if (label.length > MAX_LABEL) throw badRequest(`The name can be at most ${MAX_LABEL} characters`);
  return label;
}

function placeholderFrom(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw badRequest('placeholder must be text');
  if (value.length > MAX_PLACEHOLDER) throw badRequest(`The placeholder can be at most ${MAX_PLACEHOLDER} characters`);
  return value.trim();
}

// The section it goes in, and the field it follows there (null = end of the section).
async function placementFrom(pageType, sectionId, afterFieldKey, ownKey) {
  const section = schemas[pageType].sections.find(s => s.id === sectionId);
  if (!section) throw badRequest('Choose a section for the field');
  if (!afterFieldKey) return { sectionId, afterFieldKey: null };
  const placed = (await getPublishSchemas())[pageType].sections.find(s => s.id === sectionId);
  if (afterFieldKey === ownKey || !placed?.fields.some(f => f.key === afterFieldKey)) throw badRequest('The field to place it after isn\'t in that section');
  return { sectionId, afterFieldKey };
}

async function liveWordPressFields(pageType) {
  const props = await getWordPressAcfProperties(pageType);
  if (!props) throw httpError(503, 'Couldn\'t read the field list from WordPress, so a field can\'t be added right now. Try again in a minute.');
  return props;
}

fieldSettingsRouter.post('/:pageType/custom-fields', requireRole('admin'), asyncRoute(async (req, res) => {
  const { pageType } = req.params;
  assertPageType(pageType);
  const body = req.body || {};
  const fieldKey = typeof body.fieldKey === 'string' ? body.fieldKey.trim() : '';
  if (!fieldKey) throw badRequest('Choose the WordPress field it fills');

  const existing = (await listCustomFields()).filter(c => c.pageType === pageType);
  const already = existing.find(c => c.fieldKey === fieldKey);
  if (already) throw httpError(409, already.archivedAt ? `"${already.label}" was added before and removed - restore it instead` : `"${already.label}" already fills ${fieldKey}`);

  const props = await liveWordPressFields(pageType);
  if (!props[fieldKey]) throw badRequest(`WordPress has no field called ${fieldKey} on ${pageType} pages`);
  const { addable, unsupported } = addableWordPressFields(pageType, props, schemas[pageType].sections.flatMap(s => s.fields), existing.map(c => c.fieldKey));
  const target = addable.find(a => a.key === fieldKey);
  if (!target) {
    const why = unsupported.find(u => u.key === fieldKey);
    throw badRequest(why ? `${fieldKey} is ${why.reason} - the app can't fill that yet` : `${fieldKey} is already filled by a field in the app`);
  }

  let type;
  let subfields = null;
  if (target.kind === 'list') {
    type = 'REPEATER';
    subfields = target.columns.map(key => ({ key, label: humanizeFieldKey(key) }));
  } else {
    type = body.type || 'TEXT_INPUT';
    if (!TEXT_TYPES.includes(type)) throw badRequest('Choose single line, paragraph or formatted text');
  }
  const label = labelFrom(body.label, humanizeFieldKey(fieldKey));
  const placement = await placementFrom(pageType, body.sectionId, body.afterFieldKey);
  const placeholder = placeholderFrom(body.placeholder);
  const field = customFieldToSchemaField({ fieldKey, label, type, subfields });
  const settings = settingsChangesFrom(body.settings || {}, field);

  await insertCustomField({ pageType, fieldKey, label, type, ...placement, placeholder, subfields, userId: req.currentUser.id });
  if (Object.keys(settings).length) await upsertFieldSetting({ pageType, fieldKey, changes: settings, userId: req.currentUser.id });
  res.json(await everything());
}));

async function customFieldOr404(pageType, fieldKey) {
  assertPageType(pageType);
  const cf = (await listCustomFields()).find(c => c.pageType === pageType && c.fieldKey === fieldKey);
  if (!cf) throw httpError(404, 'No such added field');
  return cf;
}

// Name, type (between the text kinds), placeholder and placement.
fieldSettingsRouter.patch('/:pageType/custom-fields/:fieldKey', requireRole('admin'), asyncRoute(async (req, res) => {
  const { pageType, fieldKey } = req.params;
  const cf = await customFieldOr404(pageType, fieldKey);
  const body = req.body || {};
  const changes = {};
  if ('label' in body) changes.label = labelFrom(body.label, cf.label);
  if ('placeholder' in body) changes.placeholder = placeholderFrom(body.placeholder);
  if ('type' in body) {
    if (cf.type === 'REPEATER' || !TEXT_TYPES.includes(body.type)) throw badRequest('A text field can switch between single line, paragraph and formatted text; a list stays a list');
    changes.type = body.type;
  }
  if ('sectionId' in body || 'afterFieldKey' in body) {
    Object.assign(changes, await placementFrom(pageType, body.sectionId ?? cf.sectionId, body.afterFieldKey ?? null, fieldKey));
  }
  if (!Object.keys(changes).length) throw badRequest('Nothing to change');
  await updateCustomField({ pageType, fieldKey, changes, userId: req.currentUser.id });
  res.json(await everything());
}));

// "Remove": leaves every form and stops being sent; what drafts hold in it is kept.
fieldSettingsRouter.post('/:pageType/custom-fields/:fieldKey/archive', requireRole('admin'), asyncRoute(async (req, res) => {
  const { pageType, fieldKey } = req.params;
  await customFieldOr404(pageType, fieldKey);
  await setCustomFieldArchived({ pageType, fieldKey, archived: true, userId: req.currentUser.id });
  res.json(await everything());
}));

fieldSettingsRouter.post('/:pageType/custom-fields/:fieldKey/restore', requireRole('admin'), asyncRoute(async (req, res) => {
  const { pageType, fieldKey } = req.params;
  const cf = await customFieldOr404(pageType, fieldKey);
  // A built-in field may have been mapped to the same WordPress field since it was removed.
  const props = await getWordPressAcfProperties(pageType);
  const builtIn = schemas[pageType].sections.flatMap(s => s.fields);
  const names = props ? Object.keys(props) : null;
  const clash = builtIn.find(f => f.key === fieldKey || wordpressTargetOf(pageType, f, names).wpKeys.includes(fieldKey));
  if (clash) throw httpError(409, `"${clash.label}" fills ${fieldKey} now, so "${cf.label}" can't come back`);
  if (props && props[fieldKey] && cf.type !== 'REPEATER' && classifyWordPressField(props[fieldKey]).kind !== 'text') {
    throw httpError(409, `${fieldKey} on WordPress isn't a text field any more`);
  }
  await setCustomFieldArchived({ pageType, fieldKey, archived: false, userId: req.currentUser.id });
  res.json(await everything());
}));
