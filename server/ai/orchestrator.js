import { config } from '../config.js';
import * as writer from './writer.js';
import * as editor from './editor.js';
import { getActiveStyle } from './styleEngine.js';
import { insertGenerationLog } from '../repositories/generationLogsRepo.js';
import { insertEvaluationLog } from '../repositories/evaluationLogsRepo.js';
import { computeCostUsd, usdToInr } from './pricing.js';

// Hard-capped flow, per the approved plan:
//   Claude generate -> GPT evaluate -> (if below threshold) Claude improve -> GPT evaluate -> return
// Absolute max 2 generate calls + 2 evaluate calls, ever, per invocation. No loops.
export async function generateAndEvaluateField(params) {
  const { draftId, pageType, fieldKey, fieldLabel, fieldInstructions, outputFormat, facts, mode, existingContent } = params;
  const style = await getActiveStyle();

  const attempt1 = await writer.generateField({
    fieldKey,
    fieldLabel,
    fieldInstructions,
    facts,
    styleProfile: style.style_json,
    outputFormat,
    existingContent: mode === 'regenerate' ? existingContent : null
  });
  const log1Id = await insertGenerationLog({
    draftId, pageType, fieldKey, attemptNumber: 1,
    model: attempt1.model, prompt: attempt1.prompt,
    factsJson: JSON.stringify(facts), styleVersion: style.version, output: attempt1.output,
    inputTokens: attempt1.usage?.inputTokens, outputTokens: attempt1.usage?.outputTokens
  });

  const eval1 = await editor.evaluateField({
    content: attempt1.output, facts, styleProfile: style.style_json, fieldLabel, outputFormat
  });
  const evalLog1Id = await insertEvaluationLog({
    generationLogId: log1Id, model: config.openaiModel,
    scoresJson: JSON.stringify(eval1.scores), feedback: eval1.feedback,
    overallScore: eval1.overall || 0, status: eval1.status,
    inputTokens: eval1.usage?.inputTokens, outputTokens: eval1.usage?.outputTokens
  });

  // Cost of just this generate+evaluate call (not a running total) — shown on the field's own
  // toolbar card right after a generate/regenerate, so the person who just spent the money sees
  // it immediately next to the Editorial Score rather than only in the draft-wide total.
  const costUsd1 = computeCostUsd({ model: attempt1.model, inputTokens: attempt1.usage?.inputTokens, outputTokens: attempt1.usage?.outputTokens })
    + computeCostUsd({ model: config.openaiModel, inputTokens: eval1.usage?.inputTokens, outputTokens: eval1.usage?.outputTokens });

  if (eval1.status === 'errored') {
    // Evaluator unavailable — don't block the user, return Claude's draft ungated with a flag.
    return {
      content: attempt1.output, evaluation: eval1, attemptsUsed: 1, styleVersion: style.version,
      generationLogIds: [log1Id], evaluationLogIds: [evalLog1Id], evaluationUnavailable: true,
      costUsd: costUsd1, costInr: usdToInr(costUsd1)
    };
  }

  if (eval1.overall >= config.editorialScoreThreshold) {
    return {
      content: attempt1.output, evaluation: eval1, attemptsUsed: 1, styleVersion: style.version,
      generationLogIds: [log1Id], evaluationLogIds: [evalLog1Id],
      costUsd: costUsd1, costInr: usdToInr(costUsd1)
    };
  }

  // Improve pass — one attempt only.
  const attempt2 = await writer.generateField({
    fieldKey, fieldLabel, fieldInstructions, facts, styleProfile: style.style_json, outputFormat,
    existingContent: attempt1.output, evaluatorFeedback: eval1.feedback
  });
  const log2Id = await insertGenerationLog({
    draftId, pageType, fieldKey, attemptNumber: 2,
    model: attempt2.model, prompt: attempt2.prompt,
    factsJson: JSON.stringify(facts), styleVersion: style.version, output: attempt2.output,
    inputTokens: attempt2.usage?.inputTokens, outputTokens: attempt2.usage?.outputTokens
  });

  const eval2 = await editor.evaluateField({
    content: attempt2.output, facts, styleProfile: style.style_json, fieldLabel, outputFormat
  });
  const evalLog2Id = await insertEvaluationLog({
    generationLogId: log2Id, model: config.openaiModel,
    scoresJson: JSON.stringify(eval2.scores), feedback: eval2.feedback,
    overallScore: eval2.overall || 0, status: eval2.status,
    inputTokens: eval2.usage?.inputTokens, outputTokens: eval2.usage?.outputTokens
  });

  const winner = (eval2.status === 'ok' && eval2.overall > eval1.overall)
    ? { content: attempt2.output, evaluation: eval2 }
    : { content: attempt1.output, evaluation: eval1 };

  const costUsd2 = costUsd1
    + computeCostUsd({ model: attempt2.model, inputTokens: attempt2.usage?.inputTokens, outputTokens: attempt2.usage?.outputTokens })
    + computeCostUsd({ model: config.openaiModel, inputTokens: eval2.usage?.inputTokens, outputTokens: eval2.usage?.outputTokens });

  return {
    ...winner,
    attemptsUsed: 2,
    styleVersion: style.version,
    generationLogIds: [log1Id, log2Id],
    evaluationLogIds: [evalLog1Id, evalLog2Id],
    costUsd: costUsd2, costInr: usdToInr(costUsd2)
  };
}
