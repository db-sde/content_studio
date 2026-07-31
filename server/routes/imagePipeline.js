import { Router } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { asyncRoute } from '../middleware/errorHandler.js';
import { generateImages, generateImagesFromDocx, getGenerationStatus, getImageHistory, regenerateImage, getCurrentPrompt, patchPrompt, deleteImage } from '../integrations/imagePipelineClient.js';

// Standalone entry point into the image pipeline for someone who already has a page's JSON but
// no linked Content Studio draft (e.g. hand-written, or exported from elsewhere) — the
// draft-scoped equivalents live in drafts.js. Same Senior/Admin-only boundary, but no draft
// status to gate on since there's no draft here at all.
export const imagePipelineRouter = Router();

// JSON-driven page types (a real Content Studio schema exists) get pasted-JSON generation;
// docx-driven ones (no facts schema at all) get the .docx dropzone below instead. University is
// absent from both — it does not generate images at all.
const JSON_PAGE_TYPES = new Set(['course', 'specialization']);
const DOCX_PAGE_TYPES = new Set(['category', 'blog']);

// Memory storage, not disk — the file only needs to survive the single forward-to-Python-service
// request below, never touches Content Studio's own filesystem or DB.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function requireSeniorOrAdmin(req) {
  if (req.currentUser.role !== 'senior' && req.currentUser.role !== 'admin') {
    const err = new Error('Only a Senior Content Writer or Admin can generate images'); err.status = 403; throw err;
  }
}

function newExternalRef() {
  // Synthesized rather than reusing any draft id — there may be no draft behind this at all.
  return `adhoc_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

imagePipelineRouter.post('/generate-images', asyncRoute(async (req, res) => {
  requireSeniorOrAdmin(req);
  const { pageJson, pageType, label } = req.body;
  if (!pageJson || typeof pageJson !== 'object' || Array.isArray(pageJson)) {
    const err = new Error('pageJson is required and must be a JSON object'); err.status = 400; throw err;
  }
  if (!JSON_PAGE_TYPES.has(pageType)) {
    const err = new Error(`pageType must be one of: ${[...JSON_PAGE_TYPES].join(', ')}`); err.status = 400; throw err;
  }

  const externalRef = newExternalRef();
  const result = await generateImages({ pageJson, pageType, externalRef });
  res.status(202).json({ ...result, externalRef, label: label || null });
}));

imagePipelineRouter.post('/generate-images-from-docx', upload.single('file'), asyncRoute(async (req, res) => {
  requireSeniorOrAdmin(req);
  const { pageType, label } = req.body;
  if (!req.file) {
    const err = new Error('A .docx file is required'); err.status = 400; throw err;
  }
  if (!DOCX_PAGE_TYPES.has(pageType)) {
    const err = new Error(`pageType must be one of: ${[...DOCX_PAGE_TYPES].join(', ')}`); err.status = 400; throw err;
  }

  const externalRef = newExternalRef();
  const result = await generateImagesFromDocx({
    fileBuffer: req.file.buffer, fileName: req.file.originalname, pageType, externalRef
  });
  res.status(202).json({ ...result, externalRef, label: label || null });
}));

imagePipelineRouter.get('/generation-status/:ref', asyncRoute(async (req, res) => {
  requireSeniorOrAdmin(req);
  res.json(await getGenerationStatus(req.params.ref));
}));

imagePipelineRouter.get('/image-history/:ref', asyncRoute(async (req, res) => {
  requireSeniorOrAdmin(req);
  res.json(await getImageHistory(req.params.ref));
}));

imagePipelineRouter.post('/regenerate-image', asyncRoute(async (req, res) => {
  requireSeniorOrAdmin(req);
  const { imageId, promptOverride } = req.body;
  res.json(await regenerateImage({ imageId, promptOverride, createdBy: req.currentUser.name }));
}));

imagePipelineRouter.get('/image-prompt/:imageId', asyncRoute(async (req, res) => {
  requireSeniorOrAdmin(req);
  res.json(await getCurrentPrompt(req.params.imageId));
}));

imagePipelineRouter.patch('/prompt', asyncRoute(async (req, res) => {
  requireSeniorOrAdmin(req);
  const { imageId, structuredPrompt } = req.body;
  res.json(await patchPrompt({ imageId, structuredPrompt }));
}));

imagePipelineRouter.delete('/image/:imageId', asyncRoute(async (req, res) => {
  requireSeniorOrAdmin(req);
  res.json(await deleteImage(req.params.imageId));
}));
