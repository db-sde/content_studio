import { Router } from 'express';
import { asyncRoute } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';
import { insertLearningQueueEntry, getPendingLearningQueueEntries, markLearningQueueIncorporated } from '../repositories/learningQueueRepo.js';

export const learningQueueRouter = Router();

learningQueueRouter.post('/', asyncRoute(async (req, res) => {
  const { pageType, fieldKey, facts, generatedContent, approvedContent, source, styleVersion, generationLogId, fieldRecordId } = req.body || {};

  if (!pageType || !fieldKey || !approvedContent || !source || !styleVersion) {
    const err = new Error('pageType, fieldKey, approvedContent, source, and styleVersion are required');
    err.status = 400;
    throw err;
  }

  const id = await insertLearningQueueEntry({
    pageType,
    fieldKey,
    factsJson: JSON.stringify(facts || {}),
    generatedContent: generatedContent || null,
    approvedContent,
    source,
    styleVersion,
    generationLogId: generationLogId || null,
    fieldRecordId: fieldRecordId || null
  });

  res.json({ id });
}));

// Style Evolution review surface — Senior/Admin-only, since this is the input to deciding whether
// a new style version is warranted (see routes/styleVersions.js for where that decision gets
// acted on). Admin has every Senior permission, including this one.
learningQueueRouter.get('/', requireRole('senior', 'admin'), asyncRoute(async (req, res) => {
  res.json({ entries: await getPendingLearningQueueEntries() });
}));

learningQueueRouter.post('/incorporate', requireRole('senior', 'admin'), asyncRoute(async (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) {
    const err = new Error('ids must be a non-empty array'); err.status = 400; throw err;
  }
  await markLearningQueueIncorporated(ids);
  res.json({ ok: true });
}));
