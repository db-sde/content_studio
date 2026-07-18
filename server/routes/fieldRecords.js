import { Router } from 'express';
import { asyncRoute } from '../middleware/errorHandler.js';
import { upsertFieldRecord } from '../repositories/fieldRecordsRepo.js';

export const fieldRecordsRouter = Router();

const DRAFT_ID_RE = /^draft_\d+$/;

fieldRecordsRouter.post('/sync', asyncRoute(async (req, res) => {
  const { draftId, pageType, fieldKey, generatedContent, approvedContent, source, status, generationLogId, onlyIfMissing } = req.body || {};

  if (!draftId || !DRAFT_ID_RE.test(draftId)) {
    const err = new Error('Invalid or missing draftId'); err.status = 400; throw err;
  }
  if (!pageType || !fieldKey || !source || !status) {
    const err = new Error('pageType, fieldKey, source, and status are required'); err.status = 400; throw err;
  }

  const id = await upsertFieldRecord({
    draftId, pageType, fieldKey,
    generatedContent: generatedContent || null,
    approvedContent: approvedContent || null,
    source, status,
    generationLogId: generationLogId || null,
    onlyIfMissing: !!onlyIfMissing
  });

  res.json({ id });
}));
