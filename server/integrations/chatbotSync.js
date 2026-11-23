// Sends the pages Content Studio publishes to the DegreeBaba chatbot, so its catalog knows them.
//
// The chatbot's receiver (db-sde/chatbot, backend/catalog) was built for the document parser, which is
// being retired; Content Studio now sends the same events, under the same contract (CATALOG_SYNC.md,
// schema_version 1). The events keep the parser's `source` name: the chatbot identifies a page by
// source + type + WordPress post ID, and both apps publish to the same WordPress, so a page the parser
// synced before and the same page published from here stay one catalog entry, and a course still finds
// its university whichever app sent it.
//
// Publishing never waits for the chatbot: the event is saved in chatbot_sync_events (migration 014)
// with its exact body, and sent in the background - right away, and again on a timer with growing
// delays while the chatbot is asleep or down. A retry sends the same bytes, event ID and version.
// Off until CHATBOT_BASE_URL and CHATBOT_CATALOG_WEBHOOK_SECRET are set.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { getDb } from '../db/index.js';

export const CHATBOT_SOURCE = 'degreebaba-parser';
const SYNCED_PAGE_TYPES = ['university', 'course', 'specialization'];
const PATH = '/webhook/catalog';
// After the first try: 1 min, 5 min, 15 min, 1 h, 3 h, 6 h, 12 h, 24 h - then it's marked failed.
const RETRY_DELAYS_MS = [60, 300, 900, 3600, 10800, 21600, 43200, 86400].map(s => s * 1000);

export function chatbotSyncConfigured() {
  return !!config.chatbot.baseUrl && String(config.chatbot.webhookSecret || '').trim().length >= 32;
}

const isoAfter = (ms) => new Date(Date.now() + ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

// X-Catalog-Signature: HMAC-SHA256 over "<timestamp>.<METHOD>.<path>." + body (the receiver's rule).
export function signCatalogRequest(secret, method, path, body, timestamp = Math.floor(Date.now() / 1000)) {
  const mac = crypto.createHmac('sha256', secret).update(`${timestamp}.${method}.${path}.`).update(body).digest('hex');
  return { 'X-Catalog-Timestamp': String(timestamp), 'X-Catalog-Signature': `sha256=${mac}` };
}

// The event for one published page, or { skip: reason } when the chatbot couldn't take it.
export function buildCatalogEvent({ pageType, postId, link, acf, linkedIds = {}, version, eventId = crypto.randomUUID() }) {
  let url;
  try { url = new URL(String(link || '')); } catch { url = null; }
  if (!url || url.protocol !== 'https:' || url.search || url.hash) {
    return { skip: 'the page has no public https address yet' };
  }
  const event = {
    schema_version: 1,
    event_id: eventId,
    source: CHATBOT_SOURCE,
    entity_type: pageType,
    source_id: String(postId),
    version,
    publication_status: 'publish',
    source_url: url.toString(),
    data: acf
  };
  const id = (v) => (Array.isArray(v) ? v[0] : v);
  if (pageType !== 'university') {
    if (!id(linkedIds.linked_university)) return { skip: 'its university page isn\'t linked on WordPress' };
    event.university_source_id = String(id(linkedIds.linked_university));
  }
  if (pageType === 'specialization') {
    if (!id(linkedIds.linked_course)) return { skip: 'its course page isn\'t linked on WordPress' };
    event.course_source_id = String(id(linkedIds.linked_course));
  }
  return { event };
}

// Queues a page just published to WordPress. Returns { status: 'queued' | 'skipped' | 'off', reason? }.
// Never throws - the publish already succeeded and must stay a success.
export async function queueChatbotSync({ draftId, pageType, published }) {
  if (!SYNCED_PAGE_TYPES.includes(pageType)) return { status: 'skipped', reason: 'the chatbot only takes university, course and specialization pages' };
  if (!chatbotSyncConfigured()) return { status: 'off' };
  try {
    const db = await getDb();
    const site = config.wordpress.siteUrl;
    const postId = String(published.id);
    // Versions only ever go up for a page: the time, or one past the last one sent.
    const { rows } = await db.query('SELECT MAX(version) AS v FROM chatbot_sync_events WHERE wp_site = $1 AND page_type = $2 AND wp_post_id = $3', [site, pageType, postId]);
    const version = Math.max(Date.now(), Number(rows[0]?.v || 0) + 1);
    const built = buildCatalogEvent({ pageType, postId, link: published.link, acf: published.acf, linkedIds: published.linkedIds, version });
    if (built.skip) return { status: 'skipped', reason: built.skip };
    const body = JSON.stringify(built.event);
    await db.query(`
      INSERT INTO chatbot_sync_events (event_id, draft_id, page_type, wp_site, wp_post_id, version, body)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [built.event.event_id, draftId, pageType, site, postId, version, body]);
    drainChatbotQueue().catch(e => console.warn('[chatbot] send failed:', e.message));
    return { status: 'queued' };
  } catch (e) {
    console.error('[chatbot] couldn\'t queue the page:', e.message);
    return { status: 'skipped', reason: 'it couldn\'t be queued - see the server log' };
  }
}

async function send(row) {
  const headers = { 'Content-Type': 'application/json', ...signCatalogRequest(config.chatbot.webhookSecret.trim(), 'POST', PATH, row.body) };
  const res = await fetch(`${config.chatbot.baseUrl.replace(/\/+$/, '')}${PATH}`, {
    method: 'POST', headers, body: row.body, signal: AbortSignal.timeout(config.limits.chatbotTimeoutMs)
  });
  let detail = '';
  try { detail = (await res.json())?.detail || ''; } catch { /* not JSON */ }
  return { status: res.status, detail };
}

// The chatbot refuses these for good (bad data, a clashing version): retrying would only repeat it.
const PERMANENT = new Set([400, 409, 413, 422]);

let draining = null;
// Sends every event that's due, oldest first (so a university goes before the courses under it).
export function drainChatbotQueue() {
  if (!chatbotSyncConfigured()) return Promise.resolve();
  if (draining) return draining;
  draining = (async () => {
    const db = await getDb();
    const { rows } = await db.query(
      "SELECT * FROM chatbot_sync_events WHERE status = 'queued' AND next_attempt_at <= $1 ORDER BY id LIMIT 25",
      [isoAfter(0)]
    );
    for (const row of rows) {
      let outcome;
      try {
        outcome = await send(row);
      } catch (e) {
        outcome = { status: 0, detail: e.name === 'TimeoutError' ? 'no answer in time' : e.message };
      }
      const attempts = row.attempts + 1;
      if (outcome.status === 200 || outcome.status === 202) {
        await db.query("UPDATE chatbot_sync_events SET status = 'sent', attempts = $2, last_error = NULL, updated_at = iso_now() WHERE id = $1", [row.id, attempts]);
        continue;
      }
      const error = `${outcome.status || 'no response'}${outcome.detail ? `: ${String(outcome.detail).slice(0, 300)}` : ''}`;
      const giveUp = PERMANENT.has(outcome.status) || attempts > RETRY_DELAYS_MS.length;
      await db.query(
        `UPDATE chatbot_sync_events SET status = $2, attempts = $3, last_error = $4, next_attempt_at = $5, updated_at = iso_now() WHERE id = $1`,
        [row.id, giveUp ? 'failed' : 'queued', attempts, error, isoAfter(giveUp ? 0 : RETRY_DELAYS_MS[attempts - 1])]
      );
      if (giveUp) console.error(`[chatbot] gave up on ${row.page_type} ${row.wp_post_id} (event ${row.event_id}): ${error}`);
    }
  })().finally(() => { draining = null; });
  return draining;
}

// Checks the queue every minute while the server runs. Started from server/index.js.
export function startChatbotSyncLoop(intervalMs = 60000) {
  if (!chatbotSyncConfigured()) return null;
  const timer = setInterval(() => drainChatbotQueue().catch(e => console.warn('[chatbot] send failed:', e.message)), intervalMs);
  timer.unref?.();
  drainChatbotQueue().catch(() => {});
  return timer;
}

// Recent events for one draft, newest first - what the admin sees about it.
export async function chatbotSyncForDraft(draftId) {
  const db = await getDb();
  const { rows } = await db.query(
    'SELECT event_id, status, attempts, last_error, created_at, updated_at FROM chatbot_sync_events WHERE draft_id = $1 ORDER BY id DESC LIMIT 5', [draftId]);
  return rows;
}
