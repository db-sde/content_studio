// Shared by NotificationsPanel (the bell dropdown — what reached you, clears once read) and
// ActivityPanel (the persistent full sent+received ledger) since both render the same underlying
// notification rows, just filtered/framed differently.

export const NOTIFICATION_TYPE_VERBS = {
  sent_to_senior: 'sent for review',
  sent_to_admin: 'sent for final review',
  reverted_to_intern: 'sent back for revisions',
  reverted_to_senior: 'sent back for revisions'
};

// The backend's iso_now() (server/db/migrations_pg/001_init.sql) already returns a full
// "YYYY-MM-DDTHH:MM:SSZ" string, directly parseable as UTC with no massaging.
export const timeAgo = (isoLike) => {
  const then = new Date(isoLike).getTime();
  const diffMin = Math.round((Date.now() - then) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.round(diffHr / 24)}d ago`;
};
