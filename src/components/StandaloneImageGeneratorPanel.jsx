import { useState } from 'react';
import { X, ArrowRight, UploadCloud, FileText } from 'lucide-react';
import { ImageGenerationPanel } from './ImageGenerationPanel';

// Each page type maps to how it's grounded: university/course/specialization have a real
// Content Studio facts schema (paste JSON); category/blog have none at all - they're authored as
// a dropped .docx instead (see image_pipeline's DOCX_DRIVEN_PAGE_TYPES).
const PAGE_TYPE_OPTIONS = [
  { value: 'university', label: 'University Page', input: 'json' },
  { value: 'course', label: 'Course Page', input: 'json' },
  { value: 'specialization', label: 'Specialization Page', input: 'json' },
  { value: 'category', label: 'Category Page', input: 'docx' },
  { value: 'blog', label: 'Blog Page', input: 'docx' }
];

// The "no linked draft" entry point into the image pipeline — a small pre-step (pick page type,
// then paste JSON or drop a .docx depending on which) that hands off to the same
// ImageGenerationPanel the draft-linked flow uses, in 'standalone-json' or 'standalone-docx' mode.
export const StandaloneImageGeneratorPanel = ({ onClose }) => {
  const [pageType, setPageType] = useState('university');
  const [jsonText, setJsonText] = useState('');
  const [docxFile, setDocxFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(null);

  const selected = PAGE_TYPE_OPTIONS.find(o => o.value === pageType);
  const inputKind = selected?.input || 'json';

  const handleContinue = () => {
    if (inputKind === 'docx') {
      if (!docxFile) { setError('Drop or choose a .docx file first.'); return; }
      setError('');
      setSubmitted({ kind: 'docx', file: docxFile, pageType });
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      setError(`Invalid JSON: ${e.message}`);
      return;
    }
    if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
      setError('JSON must be an object, not an array or primitive.');
      return;
    }
    setError('');
    setSubmitted({ kind: 'json', pageJson: parsed, pageType });
  };

  const pickDocxFile = (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.docx')) {
      setError('Only .docx files are supported.');
      return;
    }
    setError('');
    setDocxFile(file);
  };

  if (submitted) {
    return submitted.kind === 'docx'
      ? <ImageGenerationPanel mode="standalone-docx" file={submitted.file} pageType={submitted.pageType} onClose={onClose} />
      : <ImageGenerationPanel mode="standalone-json" pageJson={submitted.pageJson} pageType={submitted.pageType} onClose={onClose} />;
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed top-0 right-0 z-50 h-full w-full max-w-[620px] bg-navy-deep text-white flex flex-col shadow-2xl">
        <div className="p-4 bg-black/20 border-b border-white/10 flex justify-between items-center shrink-0">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-300 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-orange"></span>
            Generate Images
          </span>
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded text-gray-300 transition-colors" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto styled-scrollbar p-4 space-y-4">
          <p className="text-xs text-gray-400">
            No linked draft required — useful for testing, or for content that didn&apos;t come
            through a Content Studio draft.
          </p>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Page Type</label>
            <select
              value={pageType}
              onChange={(e) => { setPageType(e.target.value); setError(''); }}
              className="w-full mt-1 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-100 outline-none focus:border-orange/50"
            >
              {PAGE_TYPE_OPTIONS.map(o => (
                <option key={o.value} value={o.value} className="bg-navy-deep">{o.label}</option>
              ))}
            </select>
          </div>

          {inputKind === 'json' ? (
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
            </div>
          ) : (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Document (.docx)</label>
              <label
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); pickDocxFile(e.dataTransfer.files?.[0]); }}
                className={`mt-1 flex flex-col items-center justify-center gap-2 rounded border-2 border-dashed px-4 py-10 text-center cursor-pointer transition-colors ${
                  dragOver ? 'border-orange bg-orange/10' : 'border-white/15 hover:border-white/30'
                }`}
              >
                <input
                  type="file"
                  accept=".docx"
                  className="hidden"
                  onChange={(e) => pickDocxFile(e.target.files?.[0])}
                />
                {docxFile ? (
                  <>
                    <FileText className="w-6 h-6 text-orange" />
                    <span className="text-xs font-semibold text-gray-100">{docxFile.name}</span>
                    <span className="text-[10px] text-gray-500">Click or drop to replace</span>
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-6 h-6 text-gray-400" />
                    <span className="text-xs font-semibold text-gray-300">Drop a .docx file here, or click to choose</span>
                  </>
                )}
              </label>
            </div>
          )}

          {error && <p className="text-[11px] text-red-300 font-semibold">{error}</p>}

          <button
            type="button"
            onClick={handleContinue}
            disabled={inputKind === 'json' ? !jsonText.trim() : !docxFile}
            className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 bg-orange hover:bg-orange-hover disabled:bg-white/10 disabled:text-gray-400 font-bold text-xs rounded text-white transition-all shadow-md active:scale-95"
          >
            Continue <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </aside>
    </>
  );
};
