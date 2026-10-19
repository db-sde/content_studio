import http from 'node:http';
import https from 'node:https';
import { config, assertWordpressConfigured } from '../config.js';

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

// ACF fields ride under the "acf" key on the standard post-object response/request shape — this
// is WordPress's own convention once a field group has "Show in REST API" enabled, not something
// specific to this app. `existingPostId` makes this an update (PUT) instead of a new post (POST),
// so re-publishing an already-live draft edits the same WordPress post rather than duplicating it.
export async function publishDraftToWordPress({ pageType, title, acfFields, existingPostId }) {
  assertWordpressConfigured();

  const slug = postTypeSlug(pageType);
  const base = `${config.wordpress.siteUrl}/wp-json/wp/v2/${slug}`;
  const url = existingPostId ? `${base}/${existingPostId}` : base;

  const payload = JSON.stringify({
    title,
    status: 'publish',
    acf: acfFields
  });

  let res;
  try {
    res = await sendRequest(url, {
      method: existingPostId ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: '*/*',
        Authorization: authHeader(),
        // Named, so the site's firewall/Cloudflare rules can recognise and allow it.
        'User-Agent': USER_AGENT,
        // Set explicitly so the body goes as one sized message, not chunked.
        'Content-Length': Buffer.byteLength(payload)
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
  try { body = JSON.parse(text); } catch { /* not JSON: didn't come from WordPress (see below) */ }

  if (res.status < 200 || res.status > 299) {
    const via = { server: res.headers.server || null, cfRay: res.headers['cf-ray'] || null, cfMitigated: res.headers['cf-mitigated'] || null };
    // Everything the site's host needs to find the block in their own logs.
    console.error(`[wordpress] ${res.status} from ${url}: code=${body?.code || '-'} server=${via.server || '-'} cf-ray=${via.cfRay || '-'} cf-mitigated=${via.cfMitigated || '-'} body=${text.replace(/\s+/g, ' ').slice(0, 300)}`);
    throw new Error(explainWordPressError(res.status, body, slug, via));
  }

  return { id: body.id, link: body.link, status: body.status };
}
