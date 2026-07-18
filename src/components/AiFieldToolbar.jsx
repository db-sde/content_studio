import { useState, useEffect } from 'react';
import { Sparkles, RotateCw, Check, X, Loader2 } from 'lucide-react';
import { generateField, syncFieldRecord, submitToLearningQueue } from '../services/aiClient';

const isFilled = (val) => !!val && String(val).trim() !== '' && val !== '<p></p>';

// AI-assist toolbar rendered under any field with schema-level `aiAssist` metadata. Owns its
// own generate/review/accept/reject/learn cycle; the actual field value always lives in the
// parent's formData via `onChange` — this component never holds the "real" content, only UI state.
export const AiFieldToolbar = ({ pageType, draftId, fieldKey, fieldLabel, fieldInstructions, outputFormat, value, onChange, facts, currentUserRole, onGenerated }) => {
  const [status, setStatus] = useState('idle'); // idle | loading | reviewing | error | learn-prompt
  const [evaluation, setEvaluation] = useState(null);
  const [previousValue, setPreviousValue] = useState('');
  const [lastGenerated, setLastGenerated] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [generationLogId, setGenerationLogId] = useState(null);
  const [styleVersion, setStyleVersion] = useState(null);
  const [learnContext, setLearnContext] = useState(null);
  // Set only by handleReject, holding exactly the AI content that was just rejected. Watched by
  // the effect below so a rejection followed by the Senior/Admin hand-writing a replacement still
  // reaches learning_queue — that correction happens entirely outside the generate/accept cycle
  // (once rejected, this toolbar drops to 'idle' and the field is just a plain editable input from
  // then on), so without this nothing would ever notice or record it.
  const [rejectedContent, setRejectedContent] = useState(null);

  // Fires once, the first time the field's value changes to something other than the pre-generation
  // original and the just-rejected AI content — i.e. the moment a hand-written replacement actually
  // appears. Clears rejectedContent immediately so it doesn't refire on every subsequent keystroke.
  useEffect(() => {
    if (!rejectedContent || !isFilled(value) || value === previousValue || value === rejectedContent) return;

    (async () => {
      setRejectedContent(null);
      const synced = await syncFieldRecord({
        draftId, pageType, fieldKey,
        generatedContent: rejectedContent,
        approvedContent: value,
        source: 'edited',
        status: 'accepted'
      });
      setLearnContext({ approvedContent: value, source: 'edited', fieldRecordId: synced?.id || null });
      setStatus('learn-prompt');
    })();
  }, [value, rejectedContent, previousValue, draftId, pageType, fieldKey]);

  const runGenerate = async (mode) => {
    setPreviousValue(value || '');
    setRejectedContent(null);
    setStatus('loading');
    setErrorMsg('');

    try {
      const result = await generateField({
        draftId, pageType, fieldKey, fieldLabel, fieldInstructions, outputFormat, facts,
        mode, existingContent: value || ''
      });

      const logId = result.generationLogIds?.[result.generationLogIds.length - 1] || null;

      onChange(result.content);
      setLastGenerated(result.content);
      setEvaluation(result.evaluation);
      setGenerationLogId(logId);
      setStyleVersion(result.styleVersion);
      setStatus('reviewing');

      syncFieldRecord({
        draftId, pageType, fieldKey,
        generatedContent: result.content,
        approvedContent: null,
        source: 'ai',
        status: 'pending',
        generationLogId: logId
      });

      onGenerated?.();
    } catch (e) {
      setErrorMsg(e.message || 'Generation failed');
      setStatus('error');
    }
  };

  const handleAccept = async () => {
    const source = value === lastGenerated ? 'ai' : 'edited';
    const synced = await syncFieldRecord({
      draftId, pageType, fieldKey,
      generatedContent: lastGenerated,
      approvedContent: value,
      source,
      status: 'accepted',
      generationLogId
    });

    setEvaluation(null);

    // The learn-prompt only makes sense when a Senior or Admin substantially rewrote the AI's
    // output — an unchanged accept, or an Intern's accept, has nothing new to teach future
    // generations.
    if ((currentUserRole === 'senior' || currentUserRole === 'admin') && source === 'edited') {
      setLearnContext({ approvedContent: value, source, fieldRecordId: synced?.id || null });
      setStatus('learn-prompt');
    } else {
      setStatus('idle');
    }
  };

  const handleLearnYes = () => {
    submitToLearningQueue({
      pageType, fieldKey, facts,
      generatedContent: lastGenerated,
      approvedContent: learnContext.approvedContent,
      source: learnContext.source,
      styleVersion,
      generationLogId,
      fieldRecordId: learnContext.fieldRecordId
    });
    setStatus('idle');
  };

  const handleLearnNo = () => {
    setStatus('idle');
  };

  const handleReject = () => {
    onChange(previousValue);
    syncFieldRecord({
      draftId, pageType, fieldKey,
      generatedContent: lastGenerated,
      approvedContent: null,
      source: 'ai',
      status: 'rejected'
    });
    setRejectedContent(lastGenerated);
    setStatus('idle');
    setEvaluation(null);
  };

  return (
    <div className="flex items-center gap-3 mt-2 px-2.5 py-2 rounded-lg bg-orange-soft/50 border border-orange/10 flex-wrap">
      {status === 'idle' && (
        <button
          type="button"
          onClick={() => runGenerate(isFilled(value) ? 'regenerate' : 'generate')}
          className="flex items-center gap-1.5 text-[11px] font-bold text-orange hover:text-orange-hover transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5" />
          {isFilled(value) ? 'Regenerate with AI' : 'Generate with AI'}
        </button>
      )}

      {status === 'loading' && (
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-muted">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-orange" />
          Writing…
        </span>
      )}

      {status === 'error' && (
        <span className="flex items-center gap-2 text-[11px] font-semibold text-danger">
          {errorMsg}
          <button type="button" onClick={() => setStatus('idle')} className="underline">
            Dismiss
          </button>
        </span>
      )}

      {status === 'reviewing' && (
        <div className="flex items-center gap-3 flex-wrap">
          {evaluation?.overall != null && (
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-navy text-white"
              title={evaluation.feedback || ''}
            >
              Editorial Score {evaluation.overall.toFixed(1)}/10
            </span>
          )}
          <button
            type="button"
            onClick={() => runGenerate('regenerate')}
            className="flex items-center gap-1 text-[11px] font-bold text-navy hover:text-navy-hover transition-colors"
          >
            <RotateCw className="w-3 h-3" />
            Regenerate
          </button>
          <button
            type="button"
            onClick={handleAccept}
            className="flex items-center gap-1 text-[11px] font-bold text-green-success hover:opacity-80 transition-opacity"
          >
            <Check className="w-3.5 h-3.5" />
            Accept
          </button>
          <button
            type="button"
            onClick={handleReject}
            className="flex items-center gap-1 text-[11px] font-bold text-danger hover:opacity-80 transition-opacity"
          >
            <X className="w-3.5 h-3.5" />
            Reject
          </button>
        </div>
      )}

      {status === 'learn-prompt' && (
        <div className="flex items-center gap-2 flex-wrap text-[11px] font-semibold text-navy">
          <Check className="w-3.5 h-3.5 text-green-success shrink-0" />
          <span>Use this approved content to improve future generations?</span>
          <button
            type="button"
            onClick={handleLearnYes}
            className="font-bold text-green-success hover:opacity-80 transition-opacity"
          >
            Yes
          </button>
          <button
            type="button"
            onClick={handleLearnNo}
            className="font-bold text-muted hover:text-navy transition-colors"
          >
            No
          </button>
        </div>
      )}
    </div>
  );
};
