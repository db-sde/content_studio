import { Router } from 'express';
import { asyncRoute } from '../middleware/errorHandler.js';
import { getGenerationUsageTotals } from '../repositories/generationLogsRepo.js';
import { getEvaluationUsageTotals } from '../repositories/evaluationLogsRepo.js';
import { computeCostUsdForUsage, usdToInr } from '../ai/pricing.js';

export const costsRouter = Router();

// Global running total across every draft, ever — the per-draft equivalent lives at
// GET /api/drafts/:id/cost-summary. Both roles can see this; there's nothing sensitive in a
// token-cost aggregate.
costsRouter.get('/summary', asyncRoute(async (req, res) => {
  // Summed in the database (one row per model) rather than downloading every log row - see
  // getGenerationUsageTotals. Same numbers, a few rows instead of thousands.
  const { byModel: generation, draftsTouched } = await getGenerationUsageTotals();
  const evaluation = await getEvaluationUsageTotals();

  const totalUsd = computeCostUsdForUsage([...generation, ...evaluation]);

  res.json({
    totalUsd,
    totalInr: usdToInr(totalUsd),
    generateCalls: generation.reduce((n, r) => n + r.calls, 0),
    evaluateCalls: evaluation.reduce((n, r) => n + r.calls, 0),
    draftsTouched
  });
}));
