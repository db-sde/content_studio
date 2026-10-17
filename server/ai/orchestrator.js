import { config } from '../config.js';
import * as writer from './writer.js';
import * as editor from './editor.js';
import * as seoChecks from './seoChecks.js';
import { getActiveStyle } from './styleEngine.js';
import { insertGenerationLog } from '../repositories/generationLogsRepo.js';
import { insertEvaluationLog } from '../repositories/evaluationLogsRepo.js';
import { computeCostUsdForCall, usdToInr } from './pricing.js';

// The SEO title and meta description are checked by rules (ai/seoChecks.js) - free, and precise
// about what to fix. Every other field is scored by the GPT editor. An empty draft isn't scored at
// all. Either way the result says whether the draft is good enough (`passed`) and what to change
// if not (`feedback`); for the SEO fields it also carries the version picked (`content`).
async function evaluateAttempt({ fieldKey, ...params }) {
  if (!params.content.trim()) return seoChecks.emptyOutputEvaluation();
  if (seoChecks.isRuleCheckedField(fieldKey)) return seoChecks.checkSeoCandidates({ fieldKey, ...params });
  const result = await editor.evaluateField(params);
  return {
    ...result,
    method: 'editor',
    model: config.openaiModel,
    passed: result.status === 'ok' && result.overall >= config.editorialScoreThreshold
  };
}

// Token columns for the logs - cached input is stored separately because it is billed differently.
const tokenColumns = (usage) => ({
  inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens,
  cacheReadTokens: usage?.cacheReadTokens, cacheWriteTokens: usage?.cacheWriteTokens
});

// Hard-capped flow, per the approved plan:
//   Claude generate -> evaluate -> (if it didn't pass) Claude improve -> evaluate -> return
// Absolute max 2 generate calls + 2 evaluate calls, ever, per invocation. No loops.
export async function generateAndEvaluateField(params) {
  const { draftId, pageType, fieldKey, fieldLabel, fieldInstructions, outputFormat, facts, mode, existingContent } = params;
  const style = await getActiveStyle();
  const alternatives = seoChecks.isRuleCheckedField(fieldKey) ? seoChecks.CANDIDATES_PER_CALL : null;

  const attempt1 = await writer.generateField({
    fieldKey,
    fieldLabel,
    fieldInstructions,
    facts,
    styleProfile: style.style_json,
    outputFormat,
    existingContent: mode === 'regenerate' ? existingContent : null,
    alternatives
  });
  const log1Id = await insertGenerationLog({
    draftId, pageType, fieldKey, attemptNumber: 1,
    model: attempt1.model, prompt: attempt1.prompt,
    factsJson: JSON.stringify(facts), styleVersion: style.version, output: attempt1.output,
    ...tokenColumns(attempt1.usage)
  });

  const eval1 = await evaluateAttempt({
    fieldKey, content: attempt1.output, facts, styleProfile: style.style_json, fieldLabel, fieldInstructions, outputFormat
  });
  const evalLog1Id = await insertEvaluationLog({
    generationLogId: log1Id, model: eval1.model,
    scoresJson: JSON.stringify(eval1.scores), feedback: eval1.feedback,
    overallScore: eval1.overall || 0, status: eval1.status,
    ...tokenColumns(eval1.usage)
  });

  // Cost of just this generate+evaluate call (not a running total) — shown on the field's own
  // toolbar card right after a generate/regenerate, so the person who just spent the money sees
  // it immediately next to the Editorial Score rather than only in the draft-wide total.
  const costUsd1 = computeCostUsdForCall(attempt1.model, attempt1.usage) + computeCostUsdForCall(eval1.model, eval1.usage);
  const content1 = eval1.content ?? attempt1.output;

  if (eval1.status === 'errored') {
    // Evaluator unavailable — don't block the user, return Claude's draft ungated with a flag.
    return {
      content: content1, evaluation: eval1, attemptsUsed: 1, styleVersion: style.version,
      generationLogIds: [log1Id], evaluationLogIds: [evalLog1Id], evaluationUnavailable: true,
      costUsd: costUsd1, costInr: usdToInr(costUsd1)
    };
  }

  if (eval1.passed) {
    return {
      content: content1, evaluation: eval1, attemptsUsed: 1, styleVersion: style.version,
      generationLogIds: [log1Id], evaluationLogIds: [evalLog1Id],
      costUsd: costUsd1, costInr: usdToInr(costUsd1)
    };
  }

  // Improve pass — one attempt only.
  const attempt2 = await writer.generateField({
    fieldKey, fieldLabel, fieldInstructions, facts, styleProfile: style.style_json, outputFormat,
    existingContent: attempt1.output || null, evaluatorFeedback: eval1.feedback, alternatives
  });
  const log2Id = await insertGenerationLog({
    draftId, pageType, fieldKey, attemptNumber: 2,
    model: attempt2.model, prompt: attempt2.prompt,
    factsJson: JSON.stringify(facts), styleVersion: style.version, output: attempt2.output,
    ...tokenColumns(attempt2.usage)
  });

  const eval2 = await evaluateAttempt({
    fieldKey, content: attempt2.output, facts, styleProfile: style.style_json, fieldLabel, fieldInstructions, outputFormat
  });
  const evalLog2Id = await insertEvaluationLog({
    generationLogId: log2Id, model: eval2.model,
    scoresJson: JSON.stringify(eval2.scores), feedback: eval2.feedback,
    overallScore: eval2.overall || 0, status: eval2.status,
    ...tokenColumns(eval2.usage)
  });

  // An empty first attempt always loses, even when the editor couldn't score the second.
  const useAttempt2 = !content1.trim() || (eval2.status === 'ok' && eval2.overall > eval1.overall);
  const winner = useAttempt2
    ? { content: eval2.content ?? attempt2.output, evaluation: eval2 }
    : { content: content1, evaluation: eval1 };

  // Both attempts came back empty: fail the field (it stays empty and can be generated again)
  // rather than saving a blank one. Both calls are already logged, so their cost still counts.
  if (!winner.content.trim()) {
    throw new Error(`Claude returned no text for "${fieldLabel}" twice (it used its whole output allowance thinking). Please try again.`);
  }

  const costUsd2 = costUsd1 + computeCostUsdForCall(attempt2.model, attempt2.usage) + computeCostUsdForCall(eval2.model, eval2.usage);

  return {
    ...winner,
    attemptsUsed: 2,
    styleVersion: style.version,
    generationLogIds: [log1Id, log2Id],
    evaluationLogIds: [evalLog1Id, evalLog2Id],
    costUsd: costUsd2, costInr: usdToInr(costUsd2)
  };
}
