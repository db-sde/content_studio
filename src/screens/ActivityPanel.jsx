import { useEffect, useState } from 'react';
import { X, ArrowUpRight, ArrowDownLeft, CheckCircle, Clock } from 'lucide-react';
import { listActivity } from '../services/notificationsClient';
import { NOTIFICATION_TYPE_VERBS, timeAgo } from '../utils/notificationFormat';

const ROLE_LABEL = { intern: 'the Intern team', senior: 'the Senior team', admin: 'the Admin team' };

const counterpartName = (item) => {
  if (item.direction === 'sent') {
    return item.recipient_user_name || ROLE_LABEL[item.recipient_role] || 'someone';
  }
  return item.created_by_name;
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'sent', label: 'Sent by me' },
  { key: 'received', label: 'Sent to me' }
];

// The dedicated, persistent counterpart to the notification bell — the bell only ever shows what
// reached you and clears once read; this is the full sent+received history for every draft
// hand-off, with each item's note and whether the recipient has since acted on it ("Fixed" vs
// "Pending"). Same full-screen overlay pattern as StyleReviewPanel/InvitePanel, opened from the
// user badge and available to all three roles equally.
export const ActivityPanel = ({ onClose, onOpenDraft }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activity, setActivity] = useState([]);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    listActivity()
      .then(({ activity }) => setActivity(activity))
      .catch((e) => setError(e.message || 'Failed to load activity'))
      .finally(() => setLoading(false));
  }, []);

  const visible = filter === 'all' ? activity : activity.filter(a => a.direction === filter);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[80vh] flex flex-col shadow-2xl border border-border">
        <div className="flex justify-between items-center px-6 py-4 border-b border-border shrink-0">
          <h3 className="text-lg font-extrabold text-navy uppercase tracking-wide">Activity</h3>
          <button onClick={onClose} className="p-1.5 text-muted hover:text-navy rounded hover:bg-off transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex gap-1.5 px-6 pt-4 shrink-0">
          {FILTERS.map(f => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                filter === f.key ? 'bg-navy text-white' : 'bg-off text-muted hover:text-navy'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto styled-scrollbar px-6 py-4">
          {loading ? (
            <p className="text-xs text-muted">Loading…</p>
          ) : error ? (
            <p className="text-xs text-danger">{error}</p>
          ) : visible.length === 0 ? (
            <p className="text-xs text-muted py-8 text-center">Nothing here yet — hand-offs you send or receive will show up in this list.</p>
          ) : (
            <div className="space-y-2">
              {visible.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => { onOpenDraft(item.draft_id); onClose(); }}
                  className="w-full text-left border border-border rounded-xl px-4 py-3 hover:bg-off transition-colors flex gap-3"
                >
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                    item.direction === 'sent' ? 'bg-navy-soft text-navy' : 'bg-orange-soft text-orange'
                  }`}>
                    {item.direction === 'sent' ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownLeft className="w-3.5 h-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-navy">
                        {item.direction === 'sent' ? (
                          <>You {NOTIFICATION_TYPE_VERBS[item.type]} to <span className="font-bold">{counterpartName(item)}</span></>
                        ) : (
                          <><span className="font-bold">{counterpartName(item)}</span> {NOTIFICATION_TYPE_VERBS[item.type]} to you</>
                        )}
                      </p>
                      <span className={`shrink-0 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                        item.resolved ? 'bg-green-soft text-green-success' : 'bg-orange-soft text-orange'
                      }`}>
                        {item.resolved ? <CheckCircle className="w-2.5 h-2.5" /> : <Clock className="w-2.5 h-2.5" />}
                        {item.resolved ? 'Fixed' : 'Pending'}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-muted mt-0.5">{item.draft_label || 'a draft'}</p>
                    {item.message && (
                      <p className="text-xs text-muted mt-1.5 bg-off rounded-md px-2 py-1.5 italic line-clamp-2">"{item.message}"</p>
                    )}
                    <p className="text-[10px] text-muted/70 font-medium mt-1.5">{timeAgo(item.created_at)}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
