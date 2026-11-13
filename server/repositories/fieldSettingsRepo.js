import { getDb } from '../db/index.js';
import { buildEffectiveSchemas } from '../../src/config/fieldSettings.js';

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

// The schemas every check reads, with the Admin's settings applied. One small query, read fresh on
// each request that needs it, so a change applies at once with no cache to go stale.
export async function getEffectiveSchemas() {
  return buildEffectiveSchemas(await listFieldSettings());
}
