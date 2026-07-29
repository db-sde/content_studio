import { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles, RotateCw, Pencil, History as HistoryIcon, X, Loader2, AlertTriangle, Check } from 'lucide-react';
import {
  generateImagesForDraft, getGenerationStatusForDraft, getImageHistoryForDraft,
  regenerateImageForDraft, getCurrentPromptForDraft, patchPromptForDraft,
  generateImagesFromJson, generateImagesFromDocx, getGenerationStatusByRef, getImageHistoryByRef,
  regenerateImageStandalone, getCurrentPromptStandalone, patchPromptStandalone
} from '../services/imagePipelineClient.js';

const ROLE_LABELS = { hero: 'Hero Banner', body1: 'Supporting Image 1', body2: 'Supporting Image 2', body3: 'Supporting Image 3' };
// Canonical order only — how many of these actually apply depends on page type (1 for
// university/course/specialization/category, all 4 for blog). Never assume a fixed count; the
// roles actually rendered are whatever the backend's status response comes back with.
const ALL_ROLES = ['hero', 'body1', 'body2', 'body3'];
const POLL_MS = 2500;

const emptyPrompt = () => ({ subject: '', background: '', composition: '', lighting: '', style: '', negative_prompt: [] });

// Renders identically for all 3 entry points — a draft that's reached Admin review, a raw pasted
// JSON blob, or an uploaded .docx, none of which have a draft behind them — the only difference
// is which API surface each action hits underneath (drafts.js's draft-scoped routes vs. the
// standalone /api/image-pipeline ones), selected once here via `mode` rather than forking the
// whole panel. mode: 'draft' | 'standalone-json' | 'standalone-docx'.
export const ImageGenerationPanel = ({ mode, draftId, pageJson, pageType, file, onClose }) => {
  const [externalRef, setExternalRef] = useState(mode === 'draft' ? draftId : null);
  const [status, setStatus] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [editingRole, setEditingRole] = useState(null);
  const [promptDraft, setPromptDraft] = useState(emptyPrompt());
  const [promptLoading, setPromptLoading] = useState(false);
  const [regeneratingRole, setRegeneratingRole] = useState(null);
  const [historyRole, setHistoryRole] = useState(null);
  const [historyData, setHistoryData] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const pollRef = useRef(null);

  const standaloneApi = {
    status: (ref) => getGenerationStatusByRef(ref),
    history: (ref) => getImageHistoryByRef(ref),
    regenerate: (imageId, promptOverride) => regenerateImageStandalone({ imageId, promptOverride }),
    currentPrompt: (imageId) => getCurrentPromptStandalone(imageId),
    patchPrompt: (imageId, structuredPrompt) => patchPromptStandalone({ imageId, structuredPrompt })
  };

  const api = mode === 'draft'
    ? {
      generate: () => generateImagesForDraft(draftId),
      status: (ref) => getGenerationStatusForDraft(ref),
      history: (ref) => getImageHistoryForDraft(ref),
      regenerate: (imageId, promptOverride) => regenerateImageForDraft(draftId, { imageId, promptOverride }),
      currentPrompt: (imageId) => getCurrentPromptForDraft(draftId, imageId),
      patchPrompt: (imageId, structuredPrompt) => patchPromptForDraft(draftId, { imageId, structuredPrompt })
    }
    : mode === 'standalone-docx'
      ? { generate: () => generateImagesFromDocx({ file, pageType }), ...standaloneApi }
      : { generate: () => generateImagesFromJson({ pageJson, pageType }), ...standaloneApi };

  const refreshStatus = useCallback(async (ref) => {
    try {
      const result = await api.status(ref);
      setStatus(result);
      setLoadError(''); // a later successful poll should clear any earlier transient failure
      return result;
    } catch (e) {
      // A draft that has never had images generated yet 404s — that's a normal "nothing to show
      // yet" state here, not a real error. Other failures (e.g. a dropped DB connection mid-poll)
      // are surfaced but non-fatal — polling keeps retrying and clears this once it recovers.
      if (!/no generation job found/i.test(e.message)) setLoadError(e.message);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, draftId]);

  // Draft mode: on open, check whether images already exist from an earlier session so the
  // panel doesn't look empty when it isn't. Standalone mode has no ref yet, so nothing to load.
  // Fetches inline (rather than via refreshStatus) so state updates happen in a promise callback,
  // not synchronously in the effect body.
  useEffect(() => {
    if (mode !== 'draft') return;
    api.status(draftId).then(setStatus).catch((e) => {
      if (!/no generation job found/i.test(e.message)) setLoadError(e.message);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status?.status === 'processing' && externalRef) {
      pollRef.current = setInterval(() => refreshStatus(externalRef), POLL_MS);
      return () => clearInterval(pollRef.current);
    }
    return undefined;
  }, [status?.status, externalRef, refreshStatus]);

  const handleGenerateAll = async () => {
    setGenerating(true);
    setLoadError('');
    try {
      const result = await api.generate();
      const ref = mode === 'draft' ? draftId : result.externalRef;
      setExternalRef(ref);
      await refreshStatus(ref);
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerate = async (role, promptOverride) => {
    const image = status?.images?.[role];
    if (!image?.image_id) return;
    setRegeneratingRole(role);
    try {
      await api.regenerate(image.image_id, promptOverride ?? null);
      await refreshStatus(externalRef);
      setEditingRole(null);
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setRegeneratingRole(null);
    }
  };

  const openEditPrompt = async (role) => {
    const image = status?.images?.[role];
    if (!image?.image_id) return;
    setEditingRole(role);
    setHistoryRole(null);
    setPromptLoading(true);
    try {
      const result = await api.currentPrompt(image.image_id);
      setPromptDraft(result.structured_prompt || emptyPrompt());
    } catch (e) {
      setLoadError(e.message);
      setPromptDraft(emptyPrompt());
    } finally {
      setPromptLoading(false);
    }
  };

  const applyPromptAndRegenerate = async (role) => {
    const image = status?.images?.[role];
    if (!image?.image_id) return;
    try {
      await api.patchPrompt(image.image_id, promptDraft);
    } catch (e) {
      setLoadError(e.message);
      return;
    }
    await handleRegenerate(role, promptDraft);
  };

  const openHistory = async (role) => {
    const image = status?.images?.[role];
    if (!image?.image_id) return;
    setHistoryRole(role);
    setEditingRole(null);
    setHistoryLoading(true);
    try {
      const all = await api.history(externalRef);
      setHistoryData(all[role] || null);
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setHistoryLoading(false);
    }
  };

  const activeRoles = status ? ALL_ROLES.filter(r => r in (status.images || {})) : [];
  const anyGenerated = activeRoles.some(r => status.images?.[r]);

  const headerLabel = mode === 'draft'
    ? 'Generate Page Images'
    : mode === 'standalone-docx'
      ? 'Generate Images from Document'
      : 'Generate Images from JSON';

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm transition-opacity duration-300" onClick={onClose} />
      <aside className="fixed top-0 right-0 z-50 h-full w-full max-w-[620px] bg-navy-deep text-white flex flex-col shadow-2xl">
        <div className="p-4 bg-black/20 border-b border-white/10 flex justify-between items-center shrink-0">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-300 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-orange"></span>
            {headerLabel}
          </span>
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded text-gray-300 transition-colors" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto styled-scrollbar p-4 space-y-4">
          {mode === 'standalone-json' && (
            <p className="text-xs text-gray-400">
              Generating directly from pasted JSON — {externalRef ? `tracked as ${externalRef}` : 'no linked draft, nothing is saved to a draft record'}.
            </p>
          )}
          {mode === 'standalone-docx' && (
            <p className="text-xs text-gray-400">
              Generating from the uploaded document — {externalRef ? `tracked as ${externalRef}` : 'no linked draft, nothing is saved to a draft record'}.
            </p>
          )}

          {loadError && (
            <div className="flex items-start gap-2 text-xs text-red-300 bg-danger/10 border border-danger/30 rounded p-3">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{loadError}</span>
            </div>
          )}

          <button
            type="button"
            onClick={handleGenerateAll}
            disabled={generating || status?.status === 'processing'}
            className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 bg-orange hover:bg-orange-hover disabled:bg-white/10 disabled:text-gray-400 font-bold text-xs rounded text-white transition-all shadow-md active:scale-95"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {generating || status?.status === 'processing'
              ? 'Generating…'
              : anyGenerated ? 'Generate Again (new set)' : 'Generate Images'}
          </button>

          {status && (
            <div className="grid grid-cols-1 gap-3">
              {activeRoles.map(role => (
                <ImageSlot
                  key={role}
                  role={role}
                  image={status.images?.[role]}
                  editing={editingRole === role}
                  promptDraft={promptDraft}
                  promptLoading={promptLoading}
                  regenerating={regeneratingRole === role}
                  onEditPrompt={() => openEditPrompt(role)}
                  onCancelEdit={() => setEditingRole(null)}
                  onChangePrompt={setPromptDraft}
                  onApplyPrompt={() => applyPromptAndRegenerate(role)}
                  onRegenerate={() => handleRegenerate(role, null)}
                  onOpenHistory={() => openHistory(role)}
                  historyOpen={historyRole === role}
                  historyData={historyRole === role ? historyData : null}
                  historyLoading={historyRole === role && historyLoading}
                  onCloseHistory={() => setHistoryRole(null)}
                />
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
};

const NEGATIVE_DEFAULTS = 'text, logo, watermark, low quality, blur';

const ImageSlot = ({
  role, image, editing, promptDraft, promptLoading, regenerating,
  onEditPrompt, onCancelEdit, onChangePrompt, onApplyPrompt, onRegenerate,
  onOpenHistory, historyOpen, historyData, historyLoading, onCloseHistory
}) => {
  const status = image?.status;

  return (
    <div className="bg-white/5 border border-white/10 rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-black/20 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wide text-gray-300">{ROLE_LABELS[role]}</span>
        {status && <StatusChip status={status} />}
      </div>

      <div className="p-3 space-y-2">
        {!image && <p className="text-[11px] text-gray-500 italic">Not yet generated.</p>}

        {image && status === 'pending' && (
          <div className="flex items-center gap-2 text-[11px] text-gray-400 py-6 justify-center">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…
          </div>
        )}

        {image && status === 'failed' && (
          <div className="text-[11px] text-red-300 bg-danger/10 border border-danger/20 rounded p-2">
            {image.error_message || 'Generation failed.'}
          </div>
        )}

        {image && status === 'succeeded' && image.url && (
          <>
            <img src={image.url} alt={ROLE_LABELS[role]} className="w-full h-auto rounded border border-white/10" />
            <p className="text-[10px] text-gray-500">
              {image.width}×{image.height} · {Math.round((image.size_bytes || 0) / 1024)} KB · {image.format} · {image.provider}
            </p>
          </>
        )}

        {image?.image_id && (
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button" onClick={onRegenerate} disabled={regenerating}
              className="flex items-center gap-1 text-[11px] font-bold text-navy-100 hover:text-white disabled:opacity-50 transition-colors"
            >
              <RotateCw className={`w-3 h-3 ${regenerating ? 'animate-spin' : ''}`} /> Regenerate
            </button>
            <button type="button" onClick={onEditPrompt} className="flex items-center gap-1 text-[11px] font-bold text-navy-100 hover:text-white transition-colors">
              <Pencil className="w-3 h-3" /> Edit Prompt
            </button>
            <button type="button" onClick={onOpenHistory} className="flex items-center gap-1 text-[11px] font-bold text-navy-100 hover:text-white transition-colors">
              <HistoryIcon className="w-3 h-3" /> History
            </button>
          </div>
        )}

        {editing && (
          <div className="mt-2 space-y-2 bg-black/20 rounded p-3 border border-white/10">
            {promptLoading ? (
              <div className="flex items-center gap-2 text-[11px] text-gray-400 py-3 justify-center">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading current prompt…
              </div>
            ) : (
              <>
                {['subject', 'background', 'composition', 'lighting', 'style'].map(field => (
                  <div key={field}>
                    <label className="text-[9px] font-bold uppercase tracking-wide text-gray-400">{field}</label>
                    <textarea
                      rows={2}
                      value={promptDraft[field] || ''}
                      onChange={(e) => onChangePrompt({ ...promptDraft, [field]: e.target.value })}
                      className="w-full mt-0.5 bg-white/5 border border-white/10 rounded px-2 py-1 text-[11px] text-gray-100 outline-none focus:border-orange/50 resize-none"
                    />
                  </div>
                ))}
                <div>
                  <label className="text-[9px] font-bold uppercase tracking-wide text-gray-400">negative_prompt (comma-separated)</label>
                  <input
                    type="text"
                    value={(promptDraft.negative_prompt || []).join(', ')}
                    onChange={(e) => onChangePrompt({ ...promptDraft, negative_prompt: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                    placeholder={NEGATIVE_DEFAULTS}
                    className="w-full mt-0.5 bg-white/5 border border-white/10 rounded px-2 py-1 text-[11px] text-gray-100 outline-none focus:border-orange/50"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" onClick={onCancelEdit} className="text-[11px] font-bold text-gray-400 hover:text-white px-3 py-1.5 rounded transition-colors">
                    Cancel
                  </button>
                  <button
                    type="button" onClick={onApplyPrompt} disabled={regenerating}
                    className="flex items-center gap-1 text-[11px] font-bold bg-orange hover:bg-orange-hover disabled:opacity-50 text-white px-3 py-1.5 rounded transition-colors"
                  >
                    <Check className="w-3 h-3" /> Save &amp; Regenerate
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {historyOpen && (
          <div className="mt-2 bg-black/20 rounded p-3 border border-white/10 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Version History</span>
              <button onClick={onCloseHistory} className="text-gray-400 hover:text-white"><X className="w-3 h-3" /></button>
            </div>
            {historyLoading ? (
              <div className="flex items-center gap-2 text-[11px] text-gray-400 py-3 justify-center">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
              </div>
            ) : (
              <div className="space-y-1.5 max-h-60 overflow-y-auto styled-scrollbar">
                {(historyData?.versions || []).map(v => (
                  <div key={v.version_id} className="flex items-center gap-2 text-[10.5px] text-gray-300">
                    {v.url ? (
                      <img src={v.url} alt={`v${v.version_number}`} className="w-10 h-10 object-cover rounded border border-white/10" />
                    ) : (
                      <div className="w-10 h-10 rounded border border-white/10 bg-white/5" />
                    )}
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold">v{v.version_number}</span>
                        {v.is_current && <span className="text-[9px] bg-green-success/20 text-green-success px-1.5 py-0.5 rounded font-bold">CURRENT</span>}
                        {v.status === 'failed' && <span className="text-[9px] bg-danger/20 text-red-300 px-1.5 py-0.5 rounded font-bold">FAILED</span>}
                      </div>
                      <span className="text-gray-500">{v.provider || '—'} · {v.created_by || 'auto'}</span>
                    </div>
                  </div>
                ))}
                {!(historyData?.versions || []).length && <p className="text-[11px] text-gray-500 italic">No versions yet.</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const StatusChip = ({ status }) => {
  const map = {
    succeeded: { label: 'Ready', cls: 'bg-green-success/20 text-green-success' },
    pending: { label: 'Generating…', cls: 'bg-orange/20 text-orange' },
    failed: { label: 'Failed', cls: 'bg-danger/20 text-red-300' }
  };
  const cfg = map[status] || { label: status, cls: 'bg-white/10 text-gray-300' };
  return <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${cfg.cls}`}>{cfg.label}</span>;
};
