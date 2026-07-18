import { Send, CornerDownRight } from 'lucide-react';
import { NOTIFICATION_TYPE_VERBS, timeAgo } from '../utils/notificationFormat';

const TYPE_ICON = {
  sent_to_senior: Send,
  sent_to_admin: Send,
  reverted_to_intern: CornerDownRight,
  reverted_to_senior: CornerDownRight
};

// Neither role has any way to know the other has acted other than through this app — this panel
// is that channel: "your draft was sent back with notes" / "a draft is waiting on you to review."
export const NotificationsPanel = ({ notifications, onClose, onOpenDraft }) => {
  return (
    <div className="absolute top-full right-0 mt-2 w-80 bg-white border border-border rounded-xl shadow-premium-hover text-sm z-50 overflow-hidden">
      <div className="flex justify-between items-center px-4 py-3 border-b border-border">
        <span className="font-bold text-navy">Notifications</span>
        <button type="button" onClick={onClose} className="text-muted hover:text-navy">✕</button>
      </div>

      <div className="max-h-96 overflow-y-auto styled-scrollbar">
        {notifications.length === 0 ? (
          <p className="text-xs text-muted p-4">Nothing yet — you'll see it here when a draft is sent your way.</p>
        ) : (
          notifications.map(n => {
            const Icon = TYPE_ICON[n.type] || Send;
            const verb = NOTIFICATION_TYPE_VERBS[n.type] || 'updated';
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => { onOpenDraft(n.draft_id); onClose(); }}
                className="w-full text-left px-4 py-3 border-b border-border last:border-b-0 hover:bg-navy-soft transition-colors flex gap-2.5"
              >
                <span className="w-7 h-7 rounded-full bg-orange-soft text-orange flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-3.5 h-3.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs text-navy">
                    <span className="font-bold">{n.created_by_name}</span> {verb} <span className="font-semibold">{n.draft_label || 'a draft'}</span>
                  </p>
                  {n.message && (
                    <p className="text-xs text-muted mt-1 bg-off rounded-md px-2 py-1.5 italic line-clamp-3">"{n.message}"</p>
                  )}
                  <p className="text-[10px] text-muted/70 font-medium mt-1">{timeAgo(n.created_at)}</p>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
