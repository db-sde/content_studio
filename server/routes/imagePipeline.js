import { Router } from 'express';
import crypto from 'crypto';
import { asyncRoute } from '../middleware/errorHandler.js';
import { generateImages, getGenerationStatus, getImageHistory, regenerateImage, getCurrentPrompt, patchPrompt, deleteImage } from '../integrations/imagePipelineClient.js';

// Standalone entry point into the image pipeline for someone who already has a page's JSON but
// no linked Content Studio draft (e.g. hand-written, or exported from elsewhere) — the
// draft-scoped equivalents live in drafts.js. Same Senior/Admin-only boundary, but no draft
// status to gate on since there's no draft here at all.
export const imagePipelineRouter = Router();

const PAGE_TYPES = new Set(['university', 'course', 'specialization']);

function requireSeniorOrAdmin(req) {
  if (req.currentUser.role !== 'senior' && req.currentUser.role !== 'admin') {
    const err = new Error('Only a Senior Content Writer or Admin can generate images'); err.status = 403; throw err;
  }
}

imagePipelineRouter.post('/generate-images', asyncRoute(async (req, res) => {
  requireSeniorOrAdmin(req);
  const { pageJson, pageType, label } = req.body;
  if (!pageJson || typeof pageJson !== 'object' || Array.isArray(pageJson)) {
    const err = new Error('pageJson is required and must be a JSON object'); err.status = 400; throw err;
  }
  if (!PAGE_TYPES.has(pageType)) {
    const err = new Error(`pageType must be one of: ${[...PAGE_TYPES].join(', ')}`); err.status = 400; throw err;
  }

  // Synthesized rather than reusing any draft id — there may be no draft behind this JSON at all.
  const externalRef = `adhoc_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const result = await generateImages({ pageJson, pageType, externalRef });
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
