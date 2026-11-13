import { getJSON, putJSON, deleteJSON } from './httpClient.js';

// The Admin's Field Settings (see config/fieldSettings.js). Each call resolves to { overrides }.
export const getFieldSettings = () => getJSON('/api/field-settings');

// `changes`: any of visible / required / aiGenerated / internFillable (true/false, or null = default)
// and aiInstructions. Admin only.
export const updateFieldSetting = (pageType, fieldKey, changes) =>
  putJSON(`/api/field-settings/${encodeURIComponent(pageType)}/${encodeURIComponent(fieldKey)}`, changes);

export const resetFieldSetting = (pageType, fieldKey) =>
  deleteJSON(`/api/field-settings/${encodeURIComponent(pageType)}/${encodeURIComponent(fieldKey)}`);

// { targets: { [pageType]: { [fieldKey]: { kind, wpKeys, missing? } } }, checkedLive: { [pageType]: bool } }
export const getWordPressTargets = () => getJSON('/api/field-settings/wordpress');
