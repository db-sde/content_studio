import { Router } from 'express';
import { asyncRoute } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';
import { schemas } from '../../src/config/schemas.js';
import { isLockedField, canBeAiGenerated, findSchemaField } from '../../src/config/fieldSettings.js';
import { listFieldSettings, upsertFieldSetting, deleteFieldSetting } from '../repositories/fieldSettingsRepo.js';
import { wordpressTargetOf } from '../integrations/wordpressAcf.js';
import { getWordPressFieldNames } from '../integrations/wordpressClient.js';

// The Admin's Field Settings page. Everyone signed in reads the settings (every form is built from
// them); only an Admin changes them.
export const fieldSettingsRouter = Router();

const BOOLEAN_SETTINGS = ['visible', 'required', 'aiGenerated', 'internFillable'];
const MAX_INSTRUCTIONS = 2000;

fieldSettingsRouter.get('/', asyncRoute(async (req, res) => {
  res.json({ overrides: await listFieldSettings() });
}));

// Where every field goes on WordPress, checked against the live site's field list when it answers
// (cached there for 10 minutes) - backs the "→ WordPress" tags under each field.
fieldSettingsRouter.get('/wordpress', asyncRoute(async (req, res) => {
  const pageTypes = Object.keys(schemas);
  const liveNames = await Promise.all(pageTypes.map(getWordPressFieldNames));
  const targets = {};
  const checkedLive = {};
  pageTypes.forEach((pageType, i) => {
    checkedLive[pageType] = !!liveNames[i];
    targets[pageType] = {};
    for (const section of schemas[pageType].sections) {
      for (const field of section.fields) targets[pageType][field.key] = wordpressTargetOf(pageType, field, liveNames[i]);
    }
  });
  res.json({ targets, checkedLive });
}));

function badRequest(message) {
  const err = new Error(message); err.status = 400; return err;
}

function fieldOr400(pageType, fieldKey) {
  if (!schemas[pageType]) throw badRequest('Unknown page type');
  const field = findSchemaField(schemas[pageType], fieldKey);
  if (!field) throw badRequest('Unknown field');
  if (isLockedField(pageType, fieldKey)) throw badRequest(`"${field.label}" is needed for every page to work, so it can't be changed`);
  return field;
}

// Body: any of visible / required / aiGenerated / internFillable (true, false, or null = back to
// the default) and aiInstructions (text, or null).
fieldSettingsRouter.put('/:pageType/:fieldKey', requireRole('admin'), asyncRoute(async (req, res) => {
  const { pageType, fieldKey } = req.params;
  const field = fieldOr400(pageType, fieldKey);
  const body = req.body || {};
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
  if (!Object.keys(changes).length) throw badRequest('Nothing to change');
  if (changes.aiGenerated === true && !canBeAiGenerated(field)) throw badRequest(`"${field.label}" is a list or a dropdown - the AI can only write text fields`);

  await upsertFieldSetting({ pageType, fieldKey, changes, userId: req.currentUser.id });
  res.json({ overrides: await listFieldSettings() });
}));

// "Reset to default".
fieldSettingsRouter.delete('/:pageType/:fieldKey', requireRole('admin'), asyncRoute(async (req, res) => {
  const { pageType, fieldKey } = req.params;
  fieldOr400(pageType, fieldKey);
  await deleteFieldSetting(pageType, fieldKey);
  res.json({ overrides: await listFieldSettings() });
}));
