import { getDb } from '../db/index.js';
import { buildEffectiveSchemas, withCustomFields } from '../../src/config/fieldSettings.js';

const COLUMNS = { visible: 'visible', required: 'required', aiGenerated: 'ai_generated', internFillable: 'intern_fillable', aiInstructions: 'ai_instructions' };

// Every override the Admin has set, with who set it - the shape buildEffectiveSchemas takes.
export async function listFieldSettings() {
  const db = await getDb();
  const { rows } = await db.query(`
    SELECT fs.page_type, fs.field_key, fs.visible, fs.required, fs.ai_generated, fs.intern_fillable,
           fs.ai_instructions, fs.updated_at, u.name AS updated_by_name
    FROM field_settings fs LEFT JOIN users u ON u.id = fs.updated_by_user_id
    ORDER BY fs.page_type, fs.field_key
  `);
  return rows.map(r => ({
    pageType: r.page_type,
    fieldKey: r.field_key,
    visible: r.visible,
    required: r.required,
    aiGenerated: r.ai_generated,
    internFillable: r.intern_fillable,
    aiInstructions: r.ai_instructions,
    updatedAt: r.updated_at,
    updatedByName: r.updated_by_name || null
  }));
}

// `changes`: any of visible/required/aiGenerated/internFillable/aiInstructions. Only those given
// change; the rest of the row keeps what it had (NULL = the field's default).
export async function upsertFieldSetting({ pageType, fieldKey, changes, userId }) {
  const db = await getDb();
  const keys = Object.keys(changes).filter(k => COLUMNS[k]);
  if (!keys.length) return;
  const cols = keys.map(k => COLUMNS[k]);
  const placeholders = cols.map((_, i) => '$' + (i + 3));
  await db.query(`
    INSERT INTO field_settings (page_type, field_key, ${cols.join(', ')}, updated_by_user_id, updated_at)
    VALUES ($1, $2, ${placeholders.join(', ')}, $${cols.length + 3}, iso_now())
    ON CONFLICT (page_type, field_key) DO UPDATE SET
      ${cols.map(c => `${c} = EXCLUDED.${c}`).join(', ')},
      updated_by_user_id = EXCLUDED.updated_by_user_id,
      updated_at = iso_now()
  `, [pageType, fieldKey, ...keys.map(k => changes[k]), userId]);
}

export async function deleteFieldSetting(pageType, fieldKey) {
  const db = await getDb();
  await db.query('DELETE FROM field_settings WHERE page_type = $1 AND field_key = $2', [pageType, fieldKey]);
}

// --- Fields an Admin added (see withCustomFields in config/fieldSettings.js) ----------------------
const customFieldFromRow = (r) => ({
  pageType: r.page_type,
  fieldKey: r.field_key,
  label: r.label,
  type: r.field_type,
  sectionId: r.section_id,
  afterFieldKey: r.after_field_key || null,
  placeholder: r.placeholder || '',
  subfields: r.subfields_json ? JSON.parse(r.subfields_json) : null,
  archivedAt: r.archived_at || null,
  createdAt: r.created_at,
  createdByName: r.created_by_name || null
});

// Archived ones included (the Field Settings page lists them for Restore); oldest first, so fields
// placed after the same field keep the order they were added in.
export async function listCustomFields() {
  const db = await getDb();
  const { rows } = await db.query(`
    SELECT cf.*, u.name AS created_by_name
    FROM custom_fields cf LEFT JOIN users u ON u.id = cf.created_by_user_id
    ORDER BY cf.created_at, cf.field_key
  `);
  return rows.map(customFieldFromRow);
}

export async function insertCustomField({ pageType, fieldKey, label, type, sectionId, afterFieldKey, placeholder, subfields, userId }) {
  const db = await getDb();
  await db.query(`
    INSERT INTO custom_fields (page_type, field_key, label, field_type, section_id, after_field_key, placeholder, subfields_json, created_by_user_id, updated_by_user_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
  `, [pageType, fieldKey, label, type, sectionId, afterFieldKey || null, placeholder || null, subfields ? JSON.stringify(subfields) : null, userId]);
}

// `changes`: any of label / type / sectionId / afterFieldKey / placeholder.
export async function updateCustomField({ pageType, fieldKey, changes, userId }) {
  const COLS = { label: 'label', type: 'field_type', sectionId: 'section_id', afterFieldKey: 'after_field_key', placeholder: 'placeholder' };
  const keys = Object.keys(changes).filter(k => COLS[k]);
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${COLS[k]} = $${i + 3}`);
  const db = await getDb();
  await db.query(
    `UPDATE custom_fields SET ${sets.join(', ')}, updated_by_user_id = $${keys.length + 3}, updated_at = iso_now() WHERE page_type = $1 AND field_key = $2`,
    [pageType, fieldKey, ...keys.map(k => changes[k] ?? null), userId]
  );
}

export async function setCustomFieldArchived({ pageType, fieldKey, archived, userId }) {
  const db = await getDb();
  await db.query(
    `UPDATE custom_fields SET archived_at = ${archived ? 'iso_now()' : 'NULL'}, updated_by_user_id = $3, updated_at = iso_now() WHERE page_type = $1 AND field_key = $2`,
    [pageType, fieldKey, userId]
  );
}

// How many drafts of a page type have nothing in a field, by status - shown to the Admin before
// making a field mandatory (those drafts will need it filled before they can move on).
export async function countDraftsMissingField(pageType, fieldKey) {
  const db = await getDb();
  const { rows } = await db.query(`
    SELECT status, count(*)::int AS n FROM drafts
    WHERE page_type = $1
      AND coalesce(btrim((form_data_json::json)->>$2), '') IN ('', '[]', '<p></p>')
    GROUP BY status
  `, [pageType, fieldKey]);
  return Object.fromEntries(rows.map(r => [r.status, Number(r.n)]));
}

// The schemas every check reads: built-in + added fields, with the Admin's settings applied. Two
// small queries, read fresh on each request that needs them, so a change applies at once with no
// cache to go stale.
export async function getEffectiveSchemas() {
  const [overrides, customFields] = await Promise.all([listFieldSettings(), listCustomFields()]);
  return buildEffectiveSchemas(overrides, customFields);
}

// Built-in + active added fields, nothing hidden - what's exported and published.
export async function getPublishSchemas() {
  return withCustomFields(await listCustomFields());
}
