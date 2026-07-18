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

// ACF fields ride under the "acf" key on the standard post-object response/request shape — this
// is WordPress's own convention once a field group has "Show in REST API" enabled, not something
// specific to this app. `existingPostId` makes this an update (PUT) instead of a new post (POST),
// so re-publishing an already-live draft edits the same WordPress post rather than duplicating it.
export async function publishDraftToWordPress({ pageType, title, acfFields, existingPostId }) {
  assertWordpressConfigured();

  const slug = postTypeSlug(pageType);
  const base = `${config.wordpress.siteUrl}/wp-json/wp/v2/${slug}`;
  const url = existingPostId ? `${base}/${existingPostId}` : base;

  const res = await fetch(url, {
    method: existingPostId ? 'PUT' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader()
    },
    body: JSON.stringify({
      title,
      status: 'publish',
      acf: acfFields
    })
  });

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const message = body?.message || `WordPress REST API request failed (${res.status})`;
    throw new Error(message);
  }

  return { id: body.id, link: body.link, status: body.status };
}
