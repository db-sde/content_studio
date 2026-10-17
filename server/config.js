import 'dotenv/config';

// Reads a numeric env var, falling back to `fallback` when it's unset or not a number - a typo in
// an env var must never silently turn a limit into NaN (which would disable every comparison).
function numberFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: Number(process.env.PORT || 4000),
  // Neon (hosted Postgres) connection string, e.g. postgres://user:pass@ep-xxx.neon.tech/dbname?sslmode=require
  databaseUrl: process.env.DATABASE_URL || '',

  // Deployed frontend origin (e.g. https://your-app.vercel.app) — used only for the CORS
  // allowlist below. Unset in local dev on purpose: the Vite proxy already makes frontend/backend
  // requests same-origin from the browser's point of view, so CORS never actually applies there.
  frontendUrl: process.env.FRONTEND_URL || '',

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
  },

  // Hard ceilings on everything that costs money or database capacity, each overridable by env var
  // without a code change. These exist because both real outages so far were "nothing stopped it":
  // the Anthropic balance ran dry, then the database's monthly data-transfer quota ran out.
  // tests/limits.test.js and tests/static-guards.test.js fail if any of these protections is
  // removed or bypassed.
  limits: {
    // Total Claude + GPT spend allowed per UTC day across the whole app (from generation_logs +
    // evaluation_logs). New AI requests are refused with a clear message once reached. <= 0 = no cap.
    aiDailyBudgetUsd: numberFromEnv('AI_DAILY_BUDGET_USD', 15),
    // Image generation/regeneration requests per user per hour (each one is a paid FLUX + Claude
    // call in image_pipeline/, and a blog page is 4 images).
    imageGenerationsPerHour: numberFromEnv('IMAGE_GENERATIONS_PER_HOUR', 30),
    // Any authenticated API request, per user per 5 minutes - normal use (polls, autosave, edits)
    // is well under 100; this only exists to stop a runaway browser tab or script from hammering
    // the database.
    apiRequestsPer5Min: numberFromEnv('API_REQUESTS_PER_5_MIN', 600),
    // Failed sign-in attempts per email address per 15 minutes before that account is paused.
    loginFailuresPer15Min: numberFromEnv('LOGIN_FAILURES_PER_15_MIN', 10),
    // Postgres kills any single statement running longer than this (protects billed compute from
    // a runaway query), and gives up connecting after connectTimeout instead of hanging forever.
    dbStatementTimeoutMs: numberFromEnv('DB_STATEMENT_TIMEOUT_MS', 15000),
    dbConnectTimeoutMs: numberFromEnv('DB_CONNECT_TIMEOUT_MS', 10000),
    // Outbound calls to services we don't control. The image pipeline gets longer because a
    // freshly woken Render instance can take ~30-50s to answer its first request.
    imagePipelineTimeoutMs: numberFromEnv('IMAGE_PIPELINE_TIMEOUT_MS', 60000),
    wordpressTimeoutMs: numberFromEnv('WORDPRESS_TIMEOUT_MS', 30000)
  },

  // The separate Python/FastAPI image-generation service (image_pipeline/) — see
  // server/integrations/imagePipelineClient.js. The shared key travels server-side only, same
  // convention as the WordPress app password above; the browser never sees it.
  imagePipeline: {
    baseUrl: (process.env.IMAGE_PIPELINE_URL || 'http://localhost:8001').replace(/\/+$/, ''),
    apiKey: process.env.IMAGE_PIPELINE_API_KEY || ''
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

export function assertImagePipelineConfigured() {
  if (!config.imagePipeline.apiKey) {
    throw new Error('IMAGE_PIPELINE_API_KEY is not set. Add it to content_studio/.env (see .env.example) — image_pipeline/ reads this same file.');
  }
}
