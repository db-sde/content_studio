// The Word document a blog / category summary is made from: accepted on upload, read for its text.
import multer from 'multer';
import mammoth from 'mammoth';

export const MAX_SUMMARY_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const UPLOAD_SOURCE = 'upload';

function fail(status, message, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SUMMARY_DOCUMENT_BYTES, files: 1 },
  fileFilter: (req, file, cb) => (/\.docx$/i.test(file.originalname || '')
    ? cb(null, true)
    : cb(fail(415, 'Only Word documents (.docx) can be summarized. Save the file as .docx and upload it again.', 'wrong_type')))
});

// Middleware: one .docx in the "document" field, refused with a clear message when it's the wrong
// type or too large.
export function acceptSummaryDocument(req, res, next) {
  upload.single('document')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(fail(413, 'The file is larger than 8 MB. Remove large images from the document, or split it, and upload it again.', 'too_large'));
    if (!err.status) err.status = 400;
    next(err);
  });
}

// The document's plain text. Refuses files Word can't open and documents with no text in them.
export async function documentText(buffer) {
  let value;
  try {
    ({ value } = await mammoth.extractRawText({ buffer }));
  } catch (e) {
    throw fail(422, "This file couldn't be read as a Word document. Open it in Word or Google Docs, save it as .docx and upload it again.", 'unreadable', { cause: e });
  }
  const text = String(value || '').trim();
  if (!text) throw fail(422, 'No text was found in this document. Check it has the page content (not only images) and upload it again.', 'no_text');
  return text;
}

export const safeFilename = (name) => String(name || 'document.docx').replace(/[^\w .()&,'-]+/g, '_').slice(0, 200);
