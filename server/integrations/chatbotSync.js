// Sends the pages Content Studio publishes to the DegreeBaba chatbot (db-sde/chat_bot, deployed at
// chat-bot-id1n.onrender.com), so its catalog knows them as soon as they're live.
//
// The contract is the chatbot's own (docs/DegreeBaba-Chatbot-Catalog-Sync-Dev-Spec.md, §2-§3): one page
// per POST to /api/catalog/sync, the shared secret in the X-Webhook-Secret header, and a body of
// post_id, post_type, status, slug, permalink, modified and the page's full ACF fields - with
// linked_university / linked_course as WordPress post IDs. The chatbot upserts by post ID, so sending
// a page again is harmless; a parent that isn't in its catalog yet is stored and linked later.
//
// Publishing never waits for the chatbot: the page is saved in chatbot_sync_events (migrations 014,
// 015) with its exact body and sent in the background - right away, and again on a timer with growing
// delays while the chatbot is asleep or down. Because the chatbot keeps whatever arrives last, a newer
// publish of the same page cancels ("supersedes") any older send still waiting.
// Off until CHATBOT_BASE_URL and CHATBOT_CATALOG_WEBHOOK_SECRET are set.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { getDb } from '../db/index.js';

const SYNCED_PAGE_TYPES = ['university', 'course', 'specialization'];
const PATH = '/api/catalog/sync';
// After the first try: 1 min, 5 min, 15 min, 1 h, 3 h, 6 h, 12 h, 24 h - then it's marked failed.
const RETRY_DELAYS_MS = [60, 300, 900, 3600, 10800, 21600, 43200, 86400].map(s => s * 1000);

export function chatbotSyncConfigured() {
  return !!config.chatbot.baseUrl && !!String(config.chatbot.webhookSecret || '').trim();
}

const isoNow = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const isoAfter = (ms) => new Date(Date.now() + ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

const plain = (html) => String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// Two fields WordPress holds in a shape the chatbot's catalog models refuse - and a refused field
// refuses the whole page (422): nirf_rank must be a whole number ("#25" -> 25), and eligibility_content
// is plain text (the chatbot shows it on a card), where WordPress has title/description rows.
export function chatbotFields(acf = {}) {
  const fields = { ...acf };
  if ('nirf_rank' in fields && typeof fields.nirf_rank !== 'number') {
    const digits = /\d+/.exec(String(fields.nirf_rank ?? ''));
    fields.nirf_rank = digits ? Number(digits[0]) : null;
  }
  if (Array.isArray(fields.eligibility_content)) {
    const text = fields.eligibility_content
      .map(row => {
        const title = plain(row?.eligibility_title);
        let desc = plain(row?.eligibility_description);
        if (desc && !/[.!?]$/.test(desc)) desc += '.';
        return title && desc ? `${title}: ${desc}` : title || desc;
      })
      .filter(Boolean)
      .join(' ');
    fields.eligibility_content = text || null;
  }
  return fields;
}

// The chatbot's payload (§3) for one published page, or { skip: reason }.
export function buildSyncPayload({ pageType, postId, link, acf, linkedIds = {}, modified = isoNow() }) {
  let url;
  try { url = new URL(String(link || '')); } catch { url = null; }
  const path = url ? url.pathname.replace(/\/+$/, '') : '';
  const slug = path.split('/').filter(Boolean).pop();
  if (!url || !slug || url.search) return { skip: 'the page has no public address yet' };
  const one = (v) => (Array.isArray(v) ? v[0] : v);
  const fields = chatbotFields(acf);
  for (const key of ['linked_university', 'linked_course']) {
    if (one(linkedIds[key])) fields[key] = Number(one(linkedIds[key]));
  }
  return {
    payload: {
      post_id: Number(postId),
      post_type: pageType,
      status: 'publish',
      slug,
      permalink: `${path}/`,
      modified,
      acf: fields
    }
  };
}

// Queues a page just published to WordPress. Returns { status: 'queued' | 'skipped' | 'off', reason? }.
// Never throws - the publish already succeeded and must stay a success.
export async function queueChatbotSync({ draftId, pageType, published }) {
  if (!SYNCED_PAGE_TYPES.includes(pageType)) return { status: 'skipped', reason: 'the chatbot only takes university, course and specialization pages' };
  if (!chatbotSyncConfigured()) return { status: 'off' };
  try {
    const built = buildSyncPayload({ pageType, postId: published.id, link: published.link, acf: published.acf, linkedIds: published.linkedIds });
    if (built.skip) return { status: 'skipped', reason: built.skip };
    const db = await getDb();
    const site = config.wordpress.siteUrl;
    const postId = String(published.id);
    // This publish replaces anything still waiting for the same page.
    await db.query(
      "UPDATE chatbot_sync_events SET status = 'superseded', updated_at = iso_now() WHERE wp_site = $1 AND page_type = $2 AND wp_post_id = $3 AND status = 'queued'",
      [site, pageType, postId]
    );
    const { rows } = await db.query('SELECT MAX(version) AS v FROM chatbot_sync_events WHERE wp_site = $1 AND page_type = $2 AND wp_post_id = $3', [site, pageType, postId]);
    const version = Math.max(Date.now(), Number(rows[0]?.v || 0) + 1);
    await db.query(`
      INSERT INTO chatbot_sync_events (event_id, draft_id, page_type, wp_site, wp_post_id, version, body)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [crypto.randomUUID(), draftId, pageType, site, postId, version, JSON.stringify(built.payload)]);
    drainChatbotQueue().catch(e => console.warn('[chatbot] send failed:', e.message));
    return { status: 'queued' };
  } catch (e) {
    console.error('[chatbot] couldn\'t queue the page:', e.message);
    return { status: 'skipped', reason: 'it couldn\'t be queued - see the server log' };
  }
}

async function send(row) {
  const res = await fetch(`${config.chatbot.baseUrl.replace(/\/+$/, '')}${PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': config.chatbot.webhookSecret.trim() },
    body: row.body,
    signal: AbortSignal.timeout(config.limits.chatbotTimeoutMs)
  });
  let detail = '';
  try { detail = (await res.json())?.detail || ''; } catch { /* not JSON */ }
  return { status: res.status, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) };
}

// The chatbot refuses these for good (a payload it can't use): retrying would only repeat it. A wrong
// secret (401) or a chatbot not set up yet (503) is retried - those get fixed in its settings.
const PERMANENT = new Set([400, 413, 422]);

let draining = null;
// Sends every page that's due, oldest first (so a university goes before the courses under it).
export function drainChatbotQueue() {
  if (!chatbotSyncConfigured()) return Promise.resolve();
  if (draining) return draining;
  draining = (async () => {
    const db = await getDb();
    const { rows } = await db.query(
      "SELECT * FROM chatbot_sync_events WHERE status = 'queued' AND next_attempt_at <= $1 ORDER BY id LIMIT 25",
      [isoNow()]
    );
    for (const row of rows) {
      let outcome;
      try {
        outcome = await send(row);
      } catch (e) {
        outcome = { status: 0, detail: e.name === 'TimeoutError' ? 'no answer in time' : e.message };
      }
      const attempts = row.attempts + 1;
      if (outcome.status >= 200 && outcome.status < 300) {
        await db.query("UPDATE chatbot_sync_events SET status = 'sent', attempts = $2, last_error = NULL, updated_at = iso_now() WHERE id = $1 AND status = 'queued'", [row.id, attempts]);
        continue;
      }
      const error = `${outcome.status || 'no response'}${outcome.detail ? `: ${String(outcome.detail).slice(0, 300)}` : ''}`;
      const giveUp = PERMANENT.has(outcome.status) || attempts > RETRY_DELAYS_MS.length;
      await db.query(
        "UPDATE chatbot_sync_events SET status = $2, attempts = $3, last_error = $4, next_attempt_at = $5, updated_at = iso_now() WHERE id = $1 AND status = 'queued'",
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
