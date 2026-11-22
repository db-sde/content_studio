import { useEffect, useRef, useState } from 'react';
import { X, UploadCloud, FileText, Trash2, CheckCircle2, Circle, Loader2, AlertCircle, RotateCcw, Sparkles } from 'lucide-react';
import * as draftsClient from '../services/draftsClient';

// "Blog / Category Summary": choose the page type, drop in the page's Word file, and the app writes
// the summary and SEO fields and opens the new draft in the normal editor. Same overlay pattern as
// the other panels (InvitePanel, ActivityPanel). Generating happens in this card - no full-page
// spinner - and the button can't be pressed twice; closing the panel mid-way is safe (the server
// finishes and the draft appears in Drafts; uploading the same file again returns that draft).
const MAX_BYTES = 8 * 1024 * 1024;
const PAGE_TYPES = [
  { id: 'blog', label: 'Blog post', hint: 'Summary, SEO title, meta description and reading time.' },
  { id: 'category', label: 'Category page', hint: 'Summary, SEO title and meta description.' }
];
const STEPS = ['Reading the document…', 'Writing the summary…', 'Writing SEO title and description…'];
// When to move the progress line on: the request is one call, so these follow typical timings.
const STEP_AFTER_MS = [1500, 9000];

const formatSize = (bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);

function fileProblem(file) {
  if (!/\.docx$/i.test(file.name)) return `"${file.name}" isn't a Word document. Only .docx files can be summarized - save it as .docx first (in Word: File > Save As > Word Document).`;
  if (file.size > MAX_BYTES) return `"${file.name}" is ${formatSize(file.size)}. The limit is 8 MB - remove large images or split the document.`;
  if (file.size === 0) return `"${file.name}" is empty.`;
  return null;
}

export function SummaryUploadPanel({ onClose, onCreated, onClosedWhileWorking }) {
  const [pageType, setPageType] = useState('blog');
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | working | error
  const [step, setStep] = useState(0);
  const [failure, setFailure] = useState(null); // { message, retry }
  const inputRef = useRef(null);
  const mounted = useRef(true);
  const timers = useRef([]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; timers.current.forEach(clearTimeout); };
  }, []);

  const working = phase === 'working';

  const choose = (picked) => {
    setFailure(null);
    if (!picked) return;
    const problem = fileProblem(picked);
    setFileError(problem || '');
    setFile(problem ? null : picked);
  };

  const close = () => {
    if (working) onClosedWhileWorking?.();
    onClose();
  };

  const generate = async () => {
    if (!file || working) return;
    setPhase('working');
    setFailure(null);
    setStep(0);
    timers.current = STEP_AFTER_MS.map((ms, i) => setTimeout(() => mounted.current && setStep(i + 1), ms));
    try {
      const result = await draftsClient.uploadSummaryDocument({ file, pageType, uploadKey: `${file.name}|${file.size}|${file.lastModified}` });
      timers.current.forEach(clearTimeout);
      if (!mounted.current) return;
      onCreated(result);
    } catch (e) {
      timers.current.forEach(clearTimeout);
      if (!mounted.current) return;
      const fileLevel = [400, 413, 415, 422].includes(e.status);
      if (fileLevel) {
        setFileError(e.message);
        setFile(null);
        setPhase('idle');
      } else {
        // AI failed, the budget is used up, the server is waking, or the connection dropped.
        setFailure({ message: e.message || 'Something went wrong while writing the summary.', retry: e.status !== 429 });
        setPhase('error');
      }
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (working) return;
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length > 1) { setFileError('Drop one document at a time.'); return; }
    choose(files[0]);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="summary-upload-title">
      <div className="bg-white rounded-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-border">
        <div className="flex justify-between items-start gap-4 px-6 pt-5 pb-4 border-b border-border">
          <div>
            <h3 id="summary-upload-title" className="text-lg font-extrabold text-navy uppercase tracking-wide">Blog / Category Summary</h3>
            <p className="text-xs text-muted mt-1">Upload the page as a Word file. The summary and SEO fields are written from it, and you review them before anything is published.</p>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="p-1.5 text-muted hover:text-navy rounded hover:bg-off transition-colors focus:outline-none focus:ring-2 focus:ring-navy/20">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div>
            <span id="summary-page-type-label" className="block text-xs font-semibold uppercase tracking-wider text-navy mb-1.5">Page type <span className="text-orange">*</span></span>
            <div role="radiogroup" aria-labelledby="summary-page-type-label" className="inline-flex p-1 rounded-lg bg-off border border-border">
              {PAGE_TYPES.map(t => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={pageType === t.id}
                  disabled={working}
                  onClick={() => setPageType(t.id)}
                  className={`px-4 py-1.5 rounded-md text-xs font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-navy/20 disabled:cursor-not-allowed ${
                    pageType === t.id ? 'bg-white text-navy shadow-sm border border-border' : 'text-muted hover:text-navy border border-transparent'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted mt-1.5">{PAGE_TYPES.find(t => t.id === pageType).hint}</p>
          </div>

          <div>
            <span id="summary-file-label" className="block text-xs font-semibold uppercase tracking-wider text-navy mb-1.5">Word document <span className="text-orange">*</span></span>
            <input
              ref={inputRef}
              id="summary-file-input"
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="sr-only"
              tabIndex={-1}
              aria-labelledby="summary-file-label"
              onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }}
            />
            {file ? (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-off px-4 py-3">
                <div className="w-9 h-9 rounded-lg bg-navy-soft flex items-center justify-center shrink-0"><FileText className="w-4 h-4 text-navy" /></div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-navy truncate" title={file.name}>{file.name}</p>
                  <p className="text-xs text-muted">{formatSize(file.size)}</p>
                </div>
                {!working && (
                  <button type="button" onClick={() => { setFile(null); setFailure(null); setPhase('idle'); }} aria-label={`Remove ${file.name}`}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-danger rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-navy/20">
                    <Trash2 className="w-3.5 h-3.5" /> Remove
                  </button>
                )}
              </div>
            ) : (
              <div
                role="button"
                tabIndex={0}
                aria-labelledby="summary-file-label"
                aria-describedby="summary-file-help"
                onClick={() => inputRef.current?.click()}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={`flex flex-col items-center justify-center text-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-navy/20 ${
                  dragging ? 'border-orange bg-orange-soft' : fileError ? 'border-danger/50 bg-danger-soft/40' : 'border-border-strong bg-off hover:border-navy/40'
                }`}
              >
                <UploadCloud className={`w-7 h-7 ${dragging ? 'text-orange' : 'text-navy/60'}`} />
                <p className="text-sm font-semibold text-navy">Drop the .docx here, or <span className="text-orange underline underline-offset-2">browse</span></p>
                <p id="summary-file-help" className="text-xs text-muted">One Word document (.docx), up to 8 MB.</p>
              </div>
            )}
            {fileError && (
              <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-danger" role="alert">
                <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" /> {fileError}
              </p>
            )}
          </div>

          {working && (
            <ol className="space-y-2 rounded-xl border border-border px-4 py-3" aria-live="polite">
              {STEPS.map((label, i) => (
                <li key={label} className="flex items-center gap-2.5 text-sm">
                  {i < step ? <CheckCircle2 className="w-4 h-4 text-green-success shrink-0" />
                    : i === step ? <Loader2 className="w-4 h-4 text-orange animate-spin motion-reduce:animate-none shrink-0" />
                      : <Circle className="w-4 h-4 text-border-strong shrink-0" />}
                  <span className={i === step ? 'text-navy font-semibold' : i < step ? 'text-muted' : 'text-muted/70'}>{label}</span>
                </li>
              ))}
              <li className="text-xs text-muted pt-1">Usually under 30 seconds. You can close this - the draft will appear in Drafts.</li>
            </ol>
          )}

          {phase === 'error' && failure && (
            <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3" role="alert">
              <AlertCircle className="w-4 h-4 text-danger mt-0.5 shrink-0" />
              <p className="text-sm text-navy flex-1">{failure.message}</p>
              {failure.retry && (
                <button type="button" onClick={generate} className="inline-flex items-center gap-1 text-xs font-bold text-navy border border-border bg-white rounded-md px-2.5 py-1.5 hover:bg-off shrink-0 focus:outline-none focus:ring-2 focus:ring-navy/20">
                  <RotateCcw className="w-3.5 h-3.5" /> Retry
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-off/60 rounded-b-2xl">
          <button type="button" onClick={close} className="px-4 py-2 text-xs font-bold text-muted hover:text-navy rounded-lg focus:outline-none focus:ring-2 focus:ring-navy/20">
            {working ? 'Close' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={generate}
            disabled={!file || working}
            className="inline-flex items-center gap-1.5 px-5 py-2 bg-orange hover:bg-orange-hover disabled:bg-border disabled:text-muted disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg shadow-md transition-colors focus:outline-none focus:ring-2 focus:ring-orange/40"
          >
            {working ? <Loader2 className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" /> : <Sparkles className="w-3.5 h-3.5" />}
            {working ? 'Generating…' : 'Generate summary'}
          </button>
        </div>
      </div>
    </div>
  );
}
