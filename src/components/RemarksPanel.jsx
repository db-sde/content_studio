import { useState } from 'react';
import { CornerDownRight, MessageSquare } from 'lucide-react';
import { timeAgo } from '../utils/notificationFormat';

// What each hand-off did, phrased for the page's own history ("Senior S sent it back to the intern").
const REMARK_ACTIONS = {
  reverted_to_intern: 'sent it back to the intern',
  reverted_to_senior: 'sent it back to the senior',
  sent_to_senior: 'sent it for review',
  sent_to_admin: 'sent it for final review'
};

const SHOWN_BY_DEFAULT = 3;

// Every note left on this page at a hand-off, newest first, the same for everyone who opens it.
// It used to show only the latest note addressed to the viewer, so a reviewer's "sent back"
// remarks vanished for them as soon as the intern returned the page - exactly when they needed to
// check those remarks had been dealt with.
export function RemarksPanel({ remarks }) {
  const [showAll, setShowAll] = useState(false);
  if (!remarks?.length) return null;
  const shown = showAll ? remarks : remarks.slice(0, SHOWN_BY_DEFAULT);
  const hidden = remarks.length - shown.length;

  return (
    <div className="bg-info-soft border-b border-info/20 px-6 py-3 text-sm text-navy">
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="flex items-center gap-1.5 font-bold text-info uppercase tracking-wide text-[10px]">
          <MessageSquare className="w-3.5 h-3.5" />
          Remarks on this page ({remarks.length})
        </span>
        {remarks.length > SHOWN_BY_DEFAULT && (
          <button type="button" onClick={() => setShowAll(v => !v)} className="text-[11px] font-bold text-info hover:underline">
            {showAll ? 'Show latest only' : `Show ${hidden} earlier`}
          </button>
        )}
      </div>
      <ul className="space-y-2">
        {shown.map(remark => (
          <li key={remark.id} className="flex gap-3">
            <CornerDownRight className="w-4 h-4 text-info shrink-0 mt-0.5" />
            <div>
              <p className="text-[11px] text-muted">
                <span className="font-bold text-navy">{remark.created_by_name}</span>{' '}
                {REMARK_ACTIONS[remark.type] || 'left a note'} · {timeAgo(remark.created_at)}
              </p>
              <p className="text-xs text-navy/80 mt-0.5 whitespace-pre-wrap">{remark.message}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
