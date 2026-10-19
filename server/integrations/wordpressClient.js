import http from 'node:http';
import https from 'node:https';
import { config, assertWordpressConfigured } from '../config.js';
import { mapToWordPress, conformToSchema, pickLinkedPost, LINKED_FIELDS } from './wordpressAcf.js';

// The only file that talks to WordPress directly. Authenticates with an Application Password
// (WP Admin > Users > profile > Application Passwords) via HTTP Basic auth — this is WordPress's
// own supported mechanism for this exact use case (a script publishing on a user's behalf) and
// needs no plugin beyond WordPress core (5.6+).
function authHeader() {
  const token = Buffer.from(`${config.wordpress.appUser}:${config.wordpress.appPassword}`).toString('base64');
  return `Basic ${token}`;
}

function postTypeSlug(pageType) {
  const slug = config.wordpress.postTypeSlugs[pageType];
  if (!slug) throw new Error(`No WordPress post type configured for page type "${pageType}"`);
  return slug;
}

// WordPress's own messages ("You are not currently logged in.") don't say what to fix, and the
// fix is almost never in this app - so name the actual cause and where it gets fixed. WordPress
// always answers its REST API with JSON carrying a `code`; a refusal without one came from
// something in front of it (Cloudflare, a server firewall), and the WordPress user's role has
// nothing to do with it.
export function explainWordPressError(status, body, slug, via = {}) {
  const code = body?.code;
  if (!code && (status === 401 || status === 403 || status === 429 || status === 503)) {
    const ray = via.cfRay ? ` Cloudflare ray ID: ${via.cfRay}.` : '';
    return `The request was blocked before it reached WordPress (${status}${via.cfMitigated ? `, Cloudflare ${via.cfMitigated}` : ''}) - ` +
      `${via.server === 'cloudflare' ? 'by Cloudflare' : 'by a firewall on the site\'s server'}, not by WordPress, so the user's role isn't the problem. ` +
      'Whoever manages the site needs to let the Content Studio server through: a Cloudflare WAF "Skip" rule (or allowlist of ' +
      'the Render server\'s outbound IPs) for requests to /wp-json/. Its requests identify themselves as "DegreeBaba-Content-Studio".' +
      `${ray} Nothing was published.`;
  }
  // What WordPress says whenever it ends up treating the request as logged out. On the DegreeBaba
  // site that includes a wrong application password (it doesn't say "incorrect password"), so
  // the credentials are the first thing to check, the Authorization header the second.
  if (code === 'rest_not_logged_in' || (status === 401 && code === 'rest_cannot_create')) {
    return 'WordPress did not accept the login. Most often WORDPRESS_APP_USER / WORDPRESS_APP_PASSWORD on the server ' +
      "don't match: the user must be the WordPress login username, and the password an Application Password created for " +
      'that same user (WP Admin > Users > Profile > Application Passwords). If they do match, the site\'s server may be ' +
      'dropping the "Authorization" header (WP Admin > Tools > Site Health shows whether it arrives). Nothing was published.';
  }
  if (code === 'invalid_username' || code === 'incorrect_password' || code === 'application_passwords_disabled') {
    return `WordPress refused the login (${code}). Check WORDPRESS_APP_USER and WORDPRESS_APP_PASSWORD on the server - ` +
      'the password must be an Application Password from WP Admin > Users > Profile, not the normal login password. Nothing was published.';
  }
  if (code === 'rest_cannot_create' || code === 'rest_cannot_edit' || code === 'rest_cannot_publish') {
    return `WordPress logged in as WORDPRESS_APP_USER but won't let that user publish "${slug}" pages (${code}). ` +
      "Check the user's role, and that this post type's capabilities allow it. Nothing was published.";
  }
  if (code === 'rest_invalid_param') {
    // WordPress's top-level message is just "Invalid parameter(s): acf"; which field and why is in
    // data.params / data.details.
    const params = body?.data?.params || {};
    const details = Object.entries(body?.data?.details || {}).map(([k, v]) => `${k}: ${v?.message || v?.code || ''}`);
    const reasons = [...Object.entries(params).map(([k, v]) => `${k}: ${v}`), ...details].join('; ');
    return `WordPress rejected some field values${reasons ? ` - ${reasons}` : ''}. Nothing was made live.`;
  }
  if (code === 'rest_no_route' || (status === 404 && !code)) {
    return `WordPress has no "${slug}" post type in its REST API. Set the WORDPRESS_POST_TYPE_* variables to the site's own names ` +
      '(listed under "rest_base" at <site>/wp-json/wp/v2/types). Nothing was published.';
  }
  return body?.message || `WordPress REST API request failed (${status})`;
}

const USER_AGENT = 'DegreeBaba-Content-Studio (+publishing via the WordPress REST API)';

// Node's built-in http(s) client rather than global fetch: fetch adds browser-style headers on its
// own (sec-fetch-mode: cors, accept-language: *), which next to a non-browser User-Agent can trip
// Cloudflare's bot scoring. This sends only the headers given, plus Host and Connection, which Node
// adds for transport. http: is only for the local stand-in WordPress the tests run against.
// Resolves with { status, headers, text }. If `signal` fires, it rejects with the signal's reason
// (a TimeoutError for AbortSignal.timeout), even when the response had already started arriving.
function sendRequest(url, { method, headers, body, signal }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'http:' ? http : https;
    const fail = (e) => reject(signal?.aborted ? signal.reason : e);
    const req = transport.request(target, { method, headers, signal }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', fail);
    });
    req.on('error', fail);
    req.end(body);
  });
}

// One call to the site's REST API. Throws a WordPressError for a non-2xx answer, after logging
// everything the site's host needs to find it (Cloudflare ray ID etc.). Its `status` - what our own
// API answers with - is 502: WordPress's own code stays in `wpStatus`, since passing e.g. its 401
// through would look to the browser like the user's own session had expired.
class WordPressError extends Error {
  constructor(message, { status, code, body }) {
    super(message);
    this.status = 502;
    this.wpStatus = status;
    this.code = code;
    this.body = body;
  }
}

async function wpRequest(method, path, { json, slug } = {}) {
  const url = `${config.wordpress.siteUrl}/wp-json/wp/v2/${path}`;
  const payload = json === undefined ? undefined : JSON.stringify(json);
  let res;
  try {
    res = await sendRequest(url, {
      method,
      headers: {
        ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
        Accept: '*/*',
        Authorization: authHeader(),
        // Named, so the site's firewall/Cloudflare rules can recognise and allow it.
        'User-Agent': USER_AGENT,
        // Set explicitly so a body goes as one sized message, not chunked.
        ...(payload === undefined ? {} : { 'Content-Length': Buffer.byteLength(payload) })
      },
      body: payload,
      // A slow or unreachable WordPress host must not hold the request open forever.
      signal: AbortSignal.timeout(config.limits.wordpressTimeoutMs)
    });
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      const err = new Error(`WordPress didn't respond within ${Math.max(1, Math.round(config.limits.wordpressTimeoutMs / 1000))}s - nothing was published; try again.`);
      err.status = 504;
      throw err;
    }
    throw e;
  }

  const { text } = res;
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON: didn't come from WordPress (see explainWordPressError) */ }

  if (res.status < 200 || res.status > 299) {
    const via = { server: res.headers.server || null, cfRay: res.headers['cf-ray'] || null, cfMitigated: res.headers['cf-mitigated'] || null };
    // Everything the site's host needs to find the block in their own logs.
    console.error(`[wordpress] ${res.status} from ${method} ${url}: code=${body?.code || '-'} server=${via.server || '-'} cf-ray=${via.cfRay || '-'} cf-mitigated=${via.cfMitigated || '-'} body=${text.replace(/\s+/g, ' ').slice(0, 300)}`);
    throw new WordPressError(explainWordPressError(res.status, body, slug || path.split('/')[0], via), { status: res.status, code: body?.code, body });
  }
  return body;
}

// The post type's live ACF schema (field names, types, repeater columns), cached briefly: the site's
// field groups change from time to time, and publishing against a stale list is what breaks.
const SCHEMA_TTL_MS = 10 * 60 * 1000;
const schemaCache = new Map();

async function getAcfSchema(slug) {
  const cached = schemaCache.get(slug);
  if (cached && Date.now() - cached.at < SCHEMA_TTL_MS) return cached.schema;
  const body = await wpRequest('OPTIONS', slug, { slug });
  const schema = body?.schema?.properties?.acf || null;
  schemaCache.set(slug, { schema, at: Date.now() });
  return schema;
}

export function __clearWordPressCachesForTests() {
  schemaCache.clear();
}

// Linked University / Linked Course: the name chosen in Content Studio -> the ID of that page on the
// site. Not found (not published to WordPress yet) or ambiguous -> left out, with a note; never
// sent as a blank, which would wipe a link set by hand in WordPress.
async function findLinkedPostIds(pageType, linkedNames) {
  const ids = {};
  const notes = [];
  // Resolve the university first: it narrows a course name shared by several universities.
  const keys = Object.keys(linkedNames).sort((a, b) => (a === 'linked_university' ? -1 : b === 'linked_university' ? 1 : 0));
  for (const key of keys) {
    const name = linkedNames[key];
    const targetType = LINKED_FIELDS[pageType][key];
    const slug = postTypeSlug(targetType);
    try {
      const posts = await wpRequest('GET', `${slug}?search=${encodeURIComponent(name)}&per_page=20&status=publish&_fields=id,title,acf`, { slug });
      const id = pickLinkedPost(posts, name, ids.linked_university);
      if (id) ids[key] = id;
      else notes.push(`${key} ("${name}" isn't a ${targetType} page on WordPress yet - publish it first, or link it in WordPress)`);
    } catch (e) {
      notes.push(`${key} (couldn't look up "${name}": ${e.message})`);
    }
  }
  return { ids, notes };
}

// Publishes one approved draft. `acfFields` is the draft's export (transformToACF, plus generated
// image URLs); it is mapped onto the site's own fields here (see wordpressAcf.js). Returns
// { id, link, status, skipped } - `skipped` lists what had nowhere to go on WordPress.
//
// New pages are created first and filled in a second request: on this site "acf" sent together with
// the create is silently dropped (the page is created with every field empty - found by the Micro
// Parser). The page is created as a draft and only made live by the request that fills it, so a
// failure in between never leaves a blank live page; that draft's ID is attached to the error
// (err.wordpressPostId) so the next attempt updates it instead of creating a duplicate.
export async function publishDraftToWordPress({ pageType, title, acfFields, existingPostId }) {
  assertWordpressConfigured();
  const slug = postTypeSlug(pageType);

  const mapped = mapToWordPress(acfFields, pageType);
  let schema = null;
  const skipped = [...mapped.skipped];
  try {
    schema = await getAcfSchema(slug);
  } catch (e) {
    console.warn(`[wordpress] couldn't read the ${slug} field list (${e.message}); publishing without the schema check`);
  }
  const conformed = conformToSchema(mapped.fields, schema);
  skipped.push(...conformed.skipped);
  const linked = await findLinkedPostIds(pageType, mapped.linkedNames);
  skipped.push(...linked.notes);
  const acf = { ...conformed.fields, ...linked.ids };

  const fill = (postId) => wpRequest('PUT', `${slug}/${postId}`, { slug, json: { title, status: 'publish', acf } });

  let post;
  if (existingPostId) {
    try {
      post = await fill(existingPostId);
    } catch (e) {
      // The page was deleted in WordPress since the last publish: start a new one below.
      if (e.code !== 'rest_post_invalid_id') throw e;
    }
  }
  if (!post) {
    const created = await wpRequest('POST', slug, { slug, json: { title, status: 'draft' } });
    try {
      post = await fill(created.id);
    } catch (e) {
      e.wordpressPostId = created.id;
      e.message = `${e.message} (A draft page was created in WordPress, ID ${created.id}, but not made live; publishing again updates it.)`;
      throw e;
    }
  }

  if (skipped.length) console.warn(`[wordpress] published ${slug} ${post.id}; not sent: ${skipped.join('; ')}`);
  return { id: post.id, link: post.link, status: post.status, skipped };
}
