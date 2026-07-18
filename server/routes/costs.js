import { Router } from 'express';
import { asyncRoute } from '../middleware/errorHandler.js';
import { getAllGenerationLogs } from '../repositories/generationLogsRepo.js';
import { getAllEvaluationLogs } from '../repositories/evaluationLogsRepo.js';
import { computeCostUsd, usdToInr } from '../ai/pricing.js';

export const costsRouter = Router();

// Global running total across every draft, ever — the per-draft equivalent lives at
// GET /api/drafts/:id/cost-summary. Both roles can see this; there's nothing sensitive in a
// token-cost aggregate.
costsRouter.get('/summary', asyncRoute(async (req, res) => {
  const generationLogs = await getAllGenerationLogs();
  const evaluationLogs = await getAllEvaluationLogs();

  const totalUsd = [...generationLogs, ...evaluationLogs].reduce((sum, row) => (
    sum + computeCostUsd({ model: row.model, inputTokens: row.input_tokens, outputTokens: row.output_tokens })
  ), 0);

  const draftIds = new Set(generationLogs.map(row => row.draft_id));

  res.json({
    totalUsd,
    totalInr: usdToInr(totalUsd),
    generateCalls: generationLogs.length,
    evaluateCalls: evaluationLogs.length,
    draftsTouched: draftIds.size
  });
}));
