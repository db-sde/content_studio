// The "→ WordPress" tag's text and tone for a field (see components/FieldTags.jsx). `target` comes
// from GET /api/field-settings/wordpress ({ kind, wpKeys, missing? } - see wordpressTargetOf).
const listOf = (keys) => (keys.length > 2 ? `${keys.slice(0, 2).join(', ')} +${keys.length - 2}` : keys.join(', '));

export function wordpressTagOf(target, checkedLive) {
  if (!target) return null;
  if (target.kind === 'internal') return { tone: 'muted', text: 'Not sent to WordPress', title: 'Notes for the AI only - never shown on the page' };
  if (target.kind === 'featured_image') return { tone: 'muted', text: 'Not sent to WordPress', title: 'Attach it in WordPress as the page\'s Featured Image' };
  const missing = target.missing || [];
  const present = target.wpKeys.filter(k => !missing.includes(k));
  if (!present.length) {
    return { tone: 'warn', text: `Missing on WordPress: ${listOf(target.wpKeys)}`, title: 'Sent to this ACF field, but the WordPress site has no such field yet - ask the WordPress developer to add it' };
  }
  const suffix = target.kind === 'linked' ? ' (page link)' : '';
  const title = [
    `Sent to the ACF field${present.length > 1 ? 's' : ''} ${present.join(', ')}${suffix}`,
    missing.length ? `Not on WordPress yet: ${missing.join(', ')}` : '',
    checkedLive ? '' : '(not checked against the live site)'
  ].filter(Boolean).join('. ');
  return { tone: missing.length ? 'warn' : 'ok', text: `→ WordPress: ${listOf(present)}${suffix}`, title };
}

