import { getDb } from '../db/index.js';

// The human-readable name of the draft a notification is about, resolved per page type. This used
// to be a single COALESCE(university_name, university_full_name, program_name, spec_name) - but a
// specialization (and a course) draft also carries a university_name, so that list always
// resolved to the UNIVERSITY's name first and a specialization's own spec_name was never shown.
// Now each page type leads with its own title, followed by its university for context:
//   specialization -> "MBA in Marketing Management · UPES"
//   course         -> "MBA in General Management · NMIMS"
//   university     -> "NMIMS"
const draftField = (key) => `NULLIF(btrim((drafts.form_data_json::json)->>'${key}'), '')`;
const DRAFT_LABEL_SQL = `
  CASE drafts.page_type
    WHEN 'specialization' THEN NULLIF(concat_ws(' · ', ${draftField('spec_name')}, ${draftField('university_name')}), '')
    WHEN 'course' THEN NULLIF(concat_ws(' · ', ${draftField('program_name')}, ${draftField('university_name')}), '')
    ELSE COALESCE(${draftField('university_name')}, ${draftField('university_full_name')})
  END
`;

export async function createNotification({ draftId, type, message, createdByUserId, recipientRole, recipientUserId }) {
  const db = await getDb();
  await db.query(`
    INSERT INTO notifications (draft_id, type, message, created_by_user_id, recipient_role, recipient_user_id)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [draftId, type, message || null, createdByUserId, recipientRole || null, recipientUserId || null]);
}

// A notification reaches a user if it's addressed to them directly (a specific revert) or
// broadcast to their role (any Senior, for a newly-submitted draft). Joins in enough of the
// draft/author to render a feed item without a second round-trip per row.
export async function listNotificationsForUser(user) {
  const db = await getDb();

  // Polled by every open tab, and a person's notifications almost never change between polls - yet
  // the full feed (up to 50 rows, with long revert notes: ~35 KB for an Intern) was re-downloaded
  // each time. Notifications are insert-only, so "how many and the newest id" is a complete change
  // detector; the full query only runs when that moves. The TTL exists solely for the draft labels
  // joined into each row, which can change when someone renames a draft - without it a stale label
  // could sit in the cache until the next new notification arrived.
  const cacheKey = `${user.id}:${user.role}`;
  const { rows: stamp } = await db.query(`
    SELECT COUNT(*)::int AS n, COALESCE(MAX(id), 0)::int AS newest
    FROM notifications WHERE recipient_user_id = $1 OR recipient_role = $2
  `, [user.id, user.role]);
  const fingerprint = `${stamp[0].n}:${stamp[0].newest}`;
  const cached = feedCache.get(cacheKey);
  if (cached && cached.fingerprint === fingerprint && Date.now() - cached.at < FEED_CACHE_TTL_MS) return cached.rows;

  const { rows } = await db.query(`
    SELECT
      notifications.id, notifications.draft_id, notifications.type, notifications.message,
      notifications.created_at, notifications.created_by_user_id,
      users.name AS created_by_name,
      drafts.page_type AS draft_page_type,
      ${DRAFT_LABEL_SQL} AS draft_label
    FROM notifications
    JOIN users ON users.id = notifications.created_by_user_id
    JOIN drafts ON drafts.id = notifications.draft_id
    WHERE notifications.recipient_user_id = $1 OR notifications.recipient_role = $2
    ORDER BY notifications.created_at DESC
    LIMIT 50
  `, [user.id, user.role]);
  feedCache.set(cacheKey, { fingerprint, at: Date.now(), rows });
  return rows;
}

const FEED_CACHE_TTL_MS = 10 * 60 * 1000;
const feedCache = new Map();

// Which draft status this notification's action was aiming for — used below to tell whether the
// recipient has since acted on it ("fixed"/actioned) or it's still sitting untouched. Comparing
// against the draft's CURRENT status (rather than storing a boolean at notification-create time)
// means this stays correct even if the draft has since moved through several more stages.
const NOTIFICATION_TARGET_STATUS = {
  sent_to_senior: 'senior_review',
  sent_to_admin: 'admin_review',
  reverted_to_intern: 'intern_editing',
  reverted_to_senior: 'senior_review',
  assigned_to_intern: 'intern_editing'
};

// Powers the Activity tab (distinct from the notification bell): every hand-off a user was either
// the sender or the recipient of, tagged with direction and whether it's since been acted on. The
// bell only ever shows what reached you; this is the full sent+received history in one place.
export async function listActivityForUser(user) {
  const db = await getDb();
  const { rows } = await db.query(`
    SELECT
      notifications.id, notifications.draft_id, notifications.type, notifications.message,
      notifications.created_at, notifications.created_by_user_id,
      notifications.recipient_role, notifications.recipient_user_id,
      creator.name AS created_by_name,
      recipient_user.name AS recipient_user_name,
      drafts.page_type AS draft_page_type,
      drafts.status AS draft_status,
      ${DRAFT_LABEL_SQL} AS draft_label
    FROM notifications
    JOIN users creator ON creator.id = notifications.created_by_user_id
    JOIN drafts ON drafts.id = notifications.draft_id
    LEFT JOIN users recipient_user ON recipient_user.id = notifications.recipient_user_id
    WHERE notifications.created_by_user_id = $1 OR notifications.recipient_user_id = $2 OR notifications.recipient_role = $3
    ORDER BY notifications.created_at DESC
    LIMIT 200
  `, [user.id, user.id, user.role]);

  return rows.map(row => ({
    ...row,
    direction: row.created_by_user_id === user.id ? 'sent' : 'received',
    resolved: row.draft_status !== NOTIFICATION_TARGET_STATUS[row.type]
  }));
}

export async function getNotificationsLastReadAt(userId) {
  const db = await getDb();
  const { rows } = await db.query('SELECT notifications_last_read_at FROM users WHERE id = $1', [userId]);
  return rows[0] ? rows[0].notifications_last_read_at : null;
}

export async function markNotificationsRead(userId) {
  const db = await getDb();
  await db.query(`UPDATE users SET notifications_last_read_at = iso_now() WHERE id = $1`, [userId]);
}
