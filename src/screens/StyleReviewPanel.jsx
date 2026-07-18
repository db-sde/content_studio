import { useEffect, useState } from 'react';
import { X, Check, AlertCircle } from 'lucide-react';
import { getPendingLearningQueue, markLearningQueueIncorporated, listStyleVersions, createStyleVersion } from '../services/styleClient';

// Closes the "Learn from this" loop: a Senior's "Yes" on a substantially-rewritten field lands in
// learning_queue (see AiFieldToolbar) but nothing ever consumed it until this screen existed.
// Deliberately manual rather than an automatic/algorithmic rewrite of style_json — a Senior reads
// the accumulated examples, hand-edits the style JSON to reflect what they learned, and activates
// it as a new version. Senior/Admin-only, opened from the user badge like InvitePanel.
export const StyleReviewPanel = ({ onClose }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [entries, setEntries] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [activeVersion, setActiveVersion] = useState(null);
  const [versionCount, setVersionCount] = useState(0);
  const [styleJsonText, setStyleJsonText] = useState('');
  const [notes, setNotes] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [activating, setActivating] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [{ entries: pending }, { versions }] = await Promise.all([
        getPendingLearningQueue(),
        listStyleVersions()
      ]);
      setEntries(pending);
      setVersionCount(versions.length);
      const active = versions.find(v => v.status === 'active') || null;
      setActiveVersion(active);
      setStyleJsonText(active ? JSON.stringify(JSON.parse(active.style_json), null, 2) : '{}');
    } catch (e) {
      setError(e.message || 'Failed to load style review data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time data fetch on mount, not a state-sync loop
    load();
  }, []);

  const toggleSelected = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleActivate = async () => {
    setJsonError('');
    setSuccessMsg('');
    let parsed;
    try {
      parsed = JSON.parse(styleJsonText);
    } catch (e) {
      setJsonError(`Invalid JSON: ${e.message}`);
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setJsonError('Invalid JSON: expected an object');
      return;
    }

    setActivating(true);
    try {
      const { version } = await createStyleVersion({ styleJson: parsed, notes });
      if (selectedIds.size) {
        await markLearningQueueIncorporated([...selectedIds]);
      }
      setSuccessMsg(`Activated ${version.version}. Future generations use it immediately — no restart needed.`);
      setSelectedIds(new Set());
      setNotes('');
      await load();
    } catch (e) {
      setJsonError(e.message || 'Failed to activate new version');
    } finally {
      setActivating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-border">
        <div className="flex justify-between items-center px-6 py-4 border-b border-border shrink-0">
          <div>
            <h3 className="text-lg font-extrabold text-navy uppercase tracking-wide">Style Evolution Review</h3>
            {activeVersion && (
              <p className="text-xs text-muted font-medium mt-0.5">
                Active: {activeVersion.version} · {versionCount} version{versionCount === 1 ? '' : 's'} total
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 text-muted hover:text-navy rounded hover:bg-off transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="p-6 text-sm text-muted">Loading…</div>
        ) : error ? (
          <div className="p-6 text-sm text-danger font-medium">{error}</div>
        ) : (
          <div className="flex-1 overflow-y-auto styled-scrollbar p-6 space-y-5">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wide text-navy mb-2">
                Pending examples ({entries.length})
              </h4>
              {entries.length === 0 ? (
                <p className="text-xs text-muted">No Senior rewrites are waiting for review right now.</p>
              ) : (
                <div className="space-y-1 max-h-56 overflow-y-auto styled-scrollbar border border-border rounded-lg p-2">
                  {entries.map(entry => (
                    <label key={entry.id} className="flex items-start gap-2 text-xs cursor-pointer p-1.5 rounded-md hover:bg-navy-soft transition-colors">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(entry.id)}
                        onChange={() => toggleSelected(entry.id)}
                        className="mt-0.5 shrink-0 accent-orange"
                      />
                      <div className="min-w-0">
                        <span className="font-bold text-navy">{entry.page_type} · {entry.field_key}</span>
                        <p className="text-muted mt-0.5 line-clamp-2">{entry.approved_content?.replace(/<[^>]*>/g, ' ').trim()}</p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-muted mt-1.5">
                Check the examples that informed your edit below — they'll be marked as incorporated once you activate.
              </p>
            </div>

            <div>
              <h4 className="text-xs font-bold uppercase tracking-wide text-navy mb-2">Style JSON</h4>
              <textarea
                value={styleJsonText}
                onChange={(e) => setStyleJsonText(e.target.value)}
                spellCheck={false}
                rows={12}
                className="w-full px-3 py-2.5 rounded-lg border border-border bg-off text-navy text-xs font-mono resize-y focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy"
              />
              {jsonError && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-danger font-medium">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {jsonError}
                </p>
              )}
            </div>

            <div>
              <h4 className="text-xs font-bold uppercase tracking-wide text-navy mb-2">Notes (optional)</h4>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What changed and why, for whoever reads this version later"
                className="w-full px-3 py-2 rounded-lg border border-border bg-white text-navy text-xs focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy"
              />
            </div>

            {successMsg && (
              <p className="flex items-center gap-1.5 text-xs text-green-success font-semibold bg-green-soft px-3 py-2 rounded-lg">
                <Check className="w-3.5 h-3.5 shrink-0" />
                {successMsg}
              </p>
            )}
          </div>
        )}

        <div className="px-6 py-4 border-t border-border shrink-0 flex justify-end">
          <button
            type="button"
            onClick={handleActivate}
            disabled={activating || loading}
            className="bg-orange hover:bg-orange-hover disabled:opacity-50 text-white text-xs font-bold px-4 py-2.5 rounded-lg transition-colors"
          >
            {activating ? 'Activating…' : 'Activate New Version'}
          </button>
        </div>
      </div>
    </div>
  );
};
