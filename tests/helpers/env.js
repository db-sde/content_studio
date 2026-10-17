// MUST be the first import of every test file (before anything under server/), because the app's
// config is read once, at import time.
//
// Makes the test run safe by construction:
//   - never reads the real .env (it holds live API keys and the production database URL);
//   - AI/image/WordPress credentials are blank, so no code path can make a paid call;
//   - any network request that isn't to this machine throws (and is recorded, so a test can prove
//     none were attempted) - a test that accidentally reaches Anthropic, OpenAI, fal.ai, Cloudinary,
//     Neon or WordPress fails loudly instead of silently costing money.
process.env.NODE_ENV = 'test';
process.env.DOTENV_CONFIG_PATH = '/nonexistent/content-studio-test.env';

const SAFE_ENV = {
  DATABASE_URL: 'postgres://in-memory-test-db/unused',
  ANTHROPIC_API_KEY: '',
  OPENAI_API_KEY: '',
  IMAGE_PIPELINE_API_KEY: 'test-pipeline-key',
  IMAGE_PIPELINE_URL: 'http://127.0.0.1:9',
  WORDPRESS_SITE_URL: '',
  WORDPRESS_APP_USER: '',
  WORDPRESS_APP_PASSWORD: ''
};
for (const [key, value] of Object.entries(SAFE_ENV)) process.env[key] = value;

const realFetch = globalThis.fetch;
globalThis.__blockedRequests = [];
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    globalThis.__blockedRequests.push(url.href);
    return Promise.reject(new Error(`Blocked outbound request in tests: ${url.href}`));
  }
  return realFetch(input, init);
};
