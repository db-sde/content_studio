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
  // Also what an unauthenticated create looks like (401 rest_cannot_create): the login never arrived.
  if (code === 'rest_not_logged_in' || (status === 401 && code === 'rest_cannot_create')) {
    return 'WordPress did not receive the login. The WordPress server is dropping the "Authorization" header before ' +
      'it reaches WordPress (common on Apache/LiteSpeed hosting). Whoever hosts the site needs to pass it through, e.g. add ' +
      '"SetEnvIf Authorization (.*) HTTP_AUTHORIZATION=$1" to its .htaccess. Nothing was published.';
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

// ACF fields ride under the "acf" key on the standard post-object response/request shape — this
// is WordPress's own convention once a field group has "Show in REST API" enabled, not something
// specific to this app. `existingPostId` makes this an update (PUT) instead of a new post (POST),
// so re-publishing an already-live draft edits the same WordPress post rather than duplicating it.
export async function publishDraftToWordPress({ pageType, title, acfFields, existingPostId }) {
  assertWordpressConfigured();

  const slug = postTypeSlug(pageType);
  const base = `${config.wordpress.siteUrl}/wp-json/wp/v2/${slug}`;
  const url = existingPostId ? `${base}/${existingPostId}` : base;

  let res;
  try {
    res = await fetch(url, {
      method: existingPostId ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader(),
        // Named, so the site's firewall/Cloudflare rules can recognise and allow it.
        'User-Agent': 'DegreeBaba-Content-Studio (+publishing via the WordPress REST API)'
      },
      body: JSON.stringify({
        title,
        status: 'publish',
        acf: acfFields
      }),
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

  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON: didn't come from WordPress (see below) */ }

  if (!res.ok) {
    const via = { server: res.headers.get('server'), cfRay: res.headers.get('cf-ray'), cfMitigated: res.headers.get('cf-mitigated') };
    // Everything the site's host needs to find the block in their own logs.
    console.error(`[wordpress] ${res.status} from ${url}: code=${body?.code || '-'} server=${via.server || '-'} cf-ray=${via.cfRay || '-'} cf-mitigated=${via.cfMitigated || '-'} body=${text.replace(/\s+/g, ' ').slice(0, 300)}`);
    throw new Error(explainWordPressError(res.status, body, slug, via));
  }

  return { id: body.id, link: body.link, status: body.status };
}
