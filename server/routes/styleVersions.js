import { Router } from 'express';
import { asyncRoute } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';
import { getAllStyleVersions, createAndActivateStyleVersion } from '../repositories/styleVersionsRepo.js';
import { clearStyleCache } from '../ai/styleEngine.js';

export const styleVersionsRouter = Router();

// Senior/Admin-only: this is the "closing the loop" half of the Style Evolution workflow described
// in the plan — pending learning_queue entries (see routes/learningQueue.js) are the input a
// Senior or Admin reviews before deciding a new style version is warranted; this is where that
// decision is acted on. Admin has every Senior permission, including this one.
styleVersionsRouter.get('/', requireRole('senior', 'admin'), asyncRoute(async (req, res) => {
  res.json({ versions: await getAllStyleVersions() });
}));

styleVersionsRouter.post('/', requireRole('senior', 'admin'), asyncRoute(async (req, res) => {
  const { styleJson, notes } = req.body || {};
  if (!styleJson || typeof styleJson !== 'object' || Array.isArray(styleJson)) {
    const err = new Error('styleJson is required and must be an object'); err.status = 400; throw err;
  }

  const version = `v${Date.now()}`;
  const activated = await createAndActivateStyleVersion({ version, styleJson, notes: notes || null });
  clearStyleCache();

  res.json({ version: activated });
}));
