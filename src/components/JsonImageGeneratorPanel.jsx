import { useState } from 'react';
import { X, ArrowRight } from 'lucide-react';
import { ImageGenerationPanel } from './ImageGenerationPanel';

const PAGE_TYPE_OPTIONS = [
  { value: 'university', label: 'University Page' },
  { value: 'course', label: 'Course Page' },
  { value: 'specialization', label: 'Specialization Page' }
];

// The "just JSON, no draft" entry point into the image pipeline — a small pre-step (paste JSON,
// pick page type) that then hands off to the same ImageGenerationPanel the draft-linked flow
// uses, just in 'standalone' mode.
export const JsonImageGeneratorPanel = ({ onClose }) => {
  const [jsonText, setJsonText] = useState('');
  const [pageType, setPageType] = useState('university');
  const [parseError, setParseError] = useState('');
  const [submitted, setSubmitted] = useState(null);

  const handleContinue = () => {
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      setParseError(`Invalid JSON: ${e.message}`);
      return;
    }
    if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
      setParseError('JSON must be an object, not an array or primitive.');
      return;
    }
    setParseError('');
    setSubmitted({ pageJson: parsed, pageType });
  };

  if (submitted) {
    return <ImageGenerationPanel mode="standalone" pageJson={submitted.pageJson} pageType={submitted.pageType} onClose={onClose} />;
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed top-0 right-0 z-50 h-full w-full max-w-[620px] bg-navy-deep text-white flex flex-col shadow-2xl">
        <div className="p-4 bg-black/20 border-b border-white/10 flex justify-between items-center shrink-0">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-300 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-orange"></span>
            Generate Images from JSON
          </span>
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded text-gray-300 transition-colors" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto styled-scrollbar p-4 space-y-4">
          <p className="text-xs text-gray-400">
            Paste a page&apos;s structured JSON directly — no linked draft required. Useful for
            testing, or for JSON that came from somewhere other than a Content Studio draft.
          </p>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Page Type</label>
            <select
              value={pageType}
              onChange={(e) => setPageType(e.target.value)}
              className="w-full mt-1 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-100 outline-none focus:border-orange/50"
            >
              {PAGE_TYPE_OPTIONS.map(o => (
                <option key={o.value} value={o.value} className="bg-navy-deep">{o.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Page JSON</label>
            <textarea
              rows={16}
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              placeholder='{ "university_name": "NMIMS", "mode_of_learning": "100% Online", ... }'
              spellCheck={false}
              className="w-full mt-1 bg-black/20 border border-white/10 rounded px-2 py-2 text-[11px] font-mono text-gray-100 outline-none focus:border-orange/50 resize-none"
            />
            {parseError && <p className="mt-1 text-[11px] text-red-300 font-semibold">{parseError}</p>}
          </div>

          <button
            type="button"
            onClick={handleContinue}
            disabled={!jsonText.trim()}
            className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 bg-orange hover:bg-orange-hover disabled:bg-white/10 disabled:text-gray-400 font-bold text-xs rounded text-white transition-all shadow-md active:scale-95"
          >
            Continue <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </aside>
    </>
  );
};
