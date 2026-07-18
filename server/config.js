import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 4000),
  // Neon (hosted Postgres) connection string, e.g. postgres://user:pass@ep-xxx.neon.tech/dbname?sslmode=require
  databaseUrl: process.env.DATABASE_URL || '',

  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
  // Used only for short, mechanical fields (SEO title/meta description) — not long-form narrative
  // writing, so a cheaper/faster model is an appropriate quality tradeoff there specifically.
  anthropicCheapModel: process.env.ANTHROPIC_CHEAP_MODEL || 'claude-haiku-4-5',

  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o',

  editorialScoreThreshold: Number(process.env.EDITORIAL_SCORE_THRESHOLD || 7.5),

  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || 24 * 14),
  inviteTtlHours: Number(process.env.INVITE_TTL_HOURS || 48),
  passwordResetTtlHours: Number(process.env.PASSWORD_RESET_TTL_HOURS || 48),

  // Marks the session cookie Secure (HTTPS-only) once actually deployed — local dev serves plain
  // HTTP, where a Secure cookie would just get silently dropped by the browser. Override with
  // COOKIE_SECURE=true/false if the deployment's TLS setup doesn't match NODE_ENV.
  cookieSecure: process.env.COOKIE_SECURE != null
    ? process.env.COOKIE_SECURE === 'true'
    : process.env.NODE_ENV === 'production',

  // Approximate — drifts with the market. Update periodically rather than trusting long-term.
  usdToInrRate: Number(process.env.USD_TO_INR_RATE || 96),

  wordpress: {
    siteUrl: (process.env.WORDPRESS_SITE_URL || '').replace(/\/+$/, ''),
    appUser: process.env.WORDPRESS_APP_USER || '',
    appPassword: process.env.WORDPRESS_APP_PASSWORD || '',
    postTypeSlugs: {
      university: process.env.WORDPRESS_POST_TYPE_UNIVERSITY || 'universities',
      course: process.env.WORDPRESS_POST_TYPE_COURSE || 'courses',
      specialization: process.env.WORDPRESS_POST_TYPE_SPECIALIZATION || 'specializations'
    }
  }
};

// Called at the point an AI provider is actually invoked (not at server boot) so the rest of
// the backend — DB, health check, non-AI routes — stays usable even before keys are configured.
export function assertAnthropicConfigured() {
  if (!config.anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set. Add it to content_studio/.env (see .env.example).');
  }
}

export function assertOpenAiConfigured() {
  if (!config.openaiApiKey) {
    throw new Error('OPENAI_API_KEY is not set. Add it to content_studio/.env (see .env.example).');
  }
}

export function assertWordpressConfigured() {
  const missing = ['siteUrl', 'appUser', 'appPassword'].filter(key => !config.wordpress[key]);
  if (missing.length) {
    const envNames = { siteUrl: 'WORDPRESS_SITE_URL', appUser: 'WORDPRESS_APP_USER', appPassword: 'WORDPRESS_APP_PASSWORD' };
    throw new Error(`WordPress is not configured. Missing: ${missing.map(k => envNames[k]).join(', ')}. Add these to content_studio/.env (see .env.example).`);
  }
}
