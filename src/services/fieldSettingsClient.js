import { getJSON, putJSON, postJSON, patchJSON, deleteJSON } from './httpClient.js';

// The Admin's Field Settings and added fields (see config/fieldSettings.js). Every call except the
// last two resolves to { overrides, customFields }.
export const getFieldSettings = () => getJSON('/api/field-settings');

const fieldPath = (pageType, fieldKey) => `/api/field-settings/${encodeURIComponent(pageType)}/${encodeURIComponent(fieldKey)}`;
const customPath = (pageType, fieldKey = '') => `/api/field-settings/${encodeURIComponent(pageType)}/custom-fields${fieldKey ? `/${encodeURIComponent(fieldKey)}` : ''}`;

// `changes`: any of visible / required / aiGenerated / internFillable (true/false, or null = default)
// and aiInstructions. Admin only - as is everything below.
export const updateFieldSetting = (pageType, fieldKey, changes) => putJSON(fieldPath(pageType, fieldKey), changes);
export const resetFieldSetting = (pageType, fieldKey) => deleteJSON(fieldPath(pageType, fieldKey));

// `field`: { fieldKey (the WordPress field), label, type, sectionId, afterFieldKey, placeholder, settings }
export const addCustomField = (pageType, field) => postJSON(customPath(pageType), field);
export const editCustomField = (pageType, fieldKey, changes) => patchJSON(customPath(pageType, fieldKey), changes);
export const archiveCustomField = (pageType, fieldKey) => postJSON(`${customPath(pageType, fieldKey)}/archive`, {});
export const restoreCustomField = (pageType, fieldKey) => postJSON(`${customPath(pageType, fieldKey)}/restore`, {});

// { missingByStatus: { intern_editing: 3, ... } } - drafts with nothing in that field.
export const getFieldImpact = (pageType, fieldKey) => getJSON(`${fieldPath(pageType, fieldKey)}/impact`);

// { targets, checkedLive, available: { [pageType]: { addable, unsupported } | null } }
export const getWordPressTargets = () => getJSON('/api/field-settings/wordpress');
