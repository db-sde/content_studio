// POST /api/import/parser-draft — the document parser (micro app) hands a page over.
//
// Not behind the session login: the parser is a server, not a person. Instead every request is
// signed with PARSER_IMPORT_SECRET (HMAC-SHA256 over "<timestamp>.<raw body>", 5-minute window),
// and the route only ever creates a draft in Senior Review — it can't read, change or publish
// anything else. Mounted with its own raw-body parser (the original Word file makes the body
// larger than the app's 1 MB JSON limit, and the signature is checked on the exact bytes).
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { withTransaction } from '../db/pgPool.js';
import { createNotification } from '../repositories/notificationsRepo.js';
import { PARSER_SOURCE, verifySignature, toFormData, handOffRemark } from '../integrations/parserImport.js';

const PARSER_USER_EMAIL = 'document-parser@system.degreebaba';
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export async function importParserDraft(req, res, next) {
  try {
    const secret = config.parserImportSecret;
    if (!secret) throw fail(503, 'Parser import is not configured (PARSER_IMPORT_SECRET).');
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    if (!verifySignature(secret, req.headers, raw)) throw fail(401, 'Invalid or expired signature.');

    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch { throw fail(400, 'Body must be JSON.'); }
    const { pageType, uploadId, filename, payload, flags, relationshipHints, document } = body || {};
    if (!['university', 'course', 'specialization'].includes(pageType)) {
      throw fail(400, 'pageType must be university, course or specialization.');
    }
    if (!uploadId || !/^[\w-]{1,64}$/.test(String(uploadId))) throw fail(400, 'uploadId is required.');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw fail(400, 'payload must be an object.');

    let docBytes = null;
    if (document) {
      docBytes = Buffer.from(String(document), 'base64');
      if (!docBytes.length || docBytes.length > MAX_DOCUMENT_BYTES) throw fail(413, 'The document is empty or too large (8 MB max).');
    }
    const safeName = String(filename || 'document.docx').replace(/[^\w .()&,'-]+/g, '_').slice(0, 200);

    const db = await getDb();
    // Sending the same upload again returns the draft it already made: a senior may have started
    // editing it, and a second copy would only confuse who works on which.
    const existing = await db.query('SELECT id, status FROM drafts WHERE source = $1 AND source_ref = $2',
      [PARSER_SOURCE, String(uploadId)]);
    if (existing.rows[0]) {
      res.json({ draftId: existing.rows[0].id, status: existing.rows[0].status, existed: true });
      return;
    }

    const { rows: users } = await db.query('SELECT id FROM users WHERE email = $1', [PARSER_USER_EMAIL]);
    if (!users[0]) throw fail(500, 'The Document Parser account is missing (migration 013).');
    const parserUserId = users[0].id;

    const { formData, unmapped } = toFormData(pageType, payload, relationshipHints || {});
    const id = `draft_${Date.now()}${Math.floor(Math.random() * 1000)}`;

    await withTransaction(async (client) => {
      await client.query(`
        INSERT INTO drafts (id, page_type, form_data_json, status, created_by_user_id, last_edited_by_user_id,
                            submitted_by_user_id, source, source_ref, source_filename)
        VALUES ($1, $2, $3, 'senior_review', $4, $4, $4, $5, $6, $7)
      `, [id, pageType, JSON.stringify(formData), parserUserId, PARSER_SOURCE, String(uploadId), safeName]);
      if (docBytes) {
        await client.query('INSERT INTO draft_source_documents (draft_id, filename, content) VALUES ($1, $2, $3)',
          [id, safeName, docBytes]);
      }
    });

    await createNotification({
      draftId: id,
      type: 'sent_to_senior',
      message: handOffRemark({ filename: safeName, flags: Array.isArray(flags) ? flags : [], unmapped, hasDocument: !!docBytes }),
      createdByUserId: parserUserId,
      recipientRole: 'senior'
    });

    res.status(201).json({ draftId: id, status: 'senior_review', existed: false, unmapped });
  } catch (err) {
    next(err);
  }
}
