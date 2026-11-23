import { useCallback, useEffect, useState } from 'react';
import { getChatbotStatus, resendAllToChatbot } from '../services/chatbotClient';
import { timeAgo } from '../utils/notificationFormat';
import { useActivePolling } from '../utils/useActivePolling';

const TYPE_LABELS = { university: ['university', 'universities'], course: ['course', 'courses'], specialization: ['specialization', 'specializations'] };
const countOf = (n, type) => `${n} ${TYPE_LABELS[type]?.[n === 1 ? 0 : 1] || type}`;

// Popover off the user badge (Admin only): how the sync to the DegreeBaba chatbot is doing, and a
// button to resend every published page - the chatbot keeps its catalog only in memory, so after it
// restarts it has only its built-in sample until the pages are sent again.
export const ChatbotPanel = ({ onClose }) => {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [resending, setResending] = useState(false);
  const [result, setResult] = useState(null);

  const refresh = useCallback(() => {
    getChatbotStatus().then(s => { setStatus(s); setError(''); }).catch(e => setError(e.message));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // While pages are waiting, check again every few seconds so the counts move as they go out.
  useActivePolling(refresh, 5000, { enabled: !!status?.waiting, immediate: false });

  const resend = async () => {
    setResending(true);
    setError('');
    setResult(null);
    try {
      setResult(await resendAllToChatbot());
      refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setResending(false);
    }
  };

  const total = result ? Object.values(result.queued).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="absolute top-full right-0 mt-2 w-80 bg-white border border-border rounded-xl shadow-premium-hover p-4 text-sm z-50">
      <div className="flex justify-between items-center mb-3">
        <span className="font-bold text-navy">Chatbot sync</span>
        <button type="button" onClick={onClose} className="text-muted hover:text-navy" aria-label="Close">✕</button>
      </div>

      {!status && !error && <p className="text-xs text-muted">Checking…</p>}

      {status && !status.configured && (
        <p className="text-xs text-muted">
          Off. Set CHATBOT_BASE_URL and CHATBOT_CATALOG_WEBHOOK_SECRET on the server to send published pages to the chatbot.
        </p>
      )}

      {status?.configured && (
        <>
          <div className="rounded-lg bg-off px-3 py-2 mb-3">
            {status.chatbot ? (
              <p className="text-xs text-navy">
                The chatbot has <span className="font-semibold">{status.chatbot.pages ?? '?'} pages</span>
                {status.chatbot.lastUpdated && <span className="text-muted"> · updated {timeAgo(status.chatbot.lastUpdated)}</span>}
              </p>
            ) : (
              <p className="text-xs text-muted">The chatbot isn&apos;t answering - it&apos;s probably asleep and wakes on the next send.</p>
            )}
            <p className="text-xs text-muted mt-1">
              Sent {status.sent} · waiting {status.waiting}{status.failed ? ` · failed ${status.failed}` : ''}
              {status.lastSentAt && ` · last sent ${timeAgo(status.lastSentAt)}`}
            </p>
          </div>

          {status.problems?.length > 0 && (
            <ul className="mb-3 space-y-1">
              {status.problems.map(p => (
                <li key={`${p.pageType}-${p.postId}-${p.at}`} className="text-[11px] text-danger">
                  {p.pageType} {p.postId}: {p.error}
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-muted mb-2">
            The chatbot forgets pages when it restarts. If its page count has dropped, send everything again.
          </p>
          <button
            type="button"
            onClick={resend}
            disabled={resending || status.resending}
            className="w-full py-1.5 rounded-lg bg-navy text-white text-xs font-semibold hover:bg-navy/90 disabled:opacity-50 transition-colors"
          >
            {resending || status.resending ? 'Queuing pages…' : 'Resend all published pages'}
          </button>
        </>
      )}

      {result && (
        <p className="text-xs text-navy mt-2">
          Queued {total} pages ({Object.entries(result.queued).map(([type, n]) => countOf(n, type)).join(', ')}). {result.removed > 0 && ` Also told it about ${result.removed} pages no longer live (in Trash or unpublished), so it drops them.`} They reach the chatbot over the next minute or two.
          {result.skipped.length > 0 && <span className="text-muted"> {result.skipped.length} couldn&apos;t be queued (no public address yet).</span>}
        </p>
      )}

      {error && <p className="text-xs font-semibold text-danger mt-2">{error}</p>}
    </div>
  );
};
