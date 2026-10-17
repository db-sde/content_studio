# Tests and safety limits

Two production incidents shaped this suite. The Anthropic balance ran out mid-work with nothing
warning anyone. Later the Neon database hit its monthly data-transfer quota, almost entirely from
endpoints that every open tab polls. The tests check app logic, and also that nothing quietly brings
either problem back.

```bash
npm test             # Node: app logic, usage budgets, limits, guards (in-memory Postgres, ~1-2 min)
npm run test:python  # image_pipeline: image counts, paid-call shape, retries, file size
npm run check        # lint + Node tests + production build: run before pushing
```

CI (`.github/workflows/ci.yml`) runs all of this on every push to `main` and every pull request.

## Safe by construction

- **No real database.** The real app (routes, auth, migration runner) runs against
  [PGlite](https://pglite.dev), which is real Postgres compiled to WebAssembly and created fresh
  for each test file. Neon is never touched.
- **No real keys.** `tests/helpers/env.js` stops the real `.env` from loading and blanks every
  API key.
- **No network.** Any request that isn't to `127.0.0.1` throws and is recorded, and each suite
  asserts that none happened. A test can't accidentally call Anthropic, OpenAI, fal.ai,
  Cloudinary or WordPress. The Python suite blocks `httpx` the same way and uses the free mock
  provider.

## What each file protects

| File | Protects |
|---|---|
| `api.workflow.test.js` | Who may edit, send, delete and assign; the review chain; authorship; duplicate detection; which notifications go to whom |
| `api.usage.test.js` | Database-transfer budgets for polled endpoints (query count and bytes); caches never go stale; no-op saves don't write; cost totals stay a few rows |
| `limits.test.js` | Each limit really blocks: daily AI budget, image generations per hour, requests per user, failed sign-ins, outbound timeouts |
| `static-guards.test.js` | Scans the code. Fails if a new AI route skips the budget or rate limit, a paid image route skips the limiter, a route group skips the request limiter, a new `setInterval` bypasses the idle-aware poller, an outbound `fetch` has no timeout, the pool loses its statement timeout, or the image service starts requesting more than 1 image per call |
| `migrations.test.js` | The full migration chain builds from nothing, re-running it is a no-op, and the notification types in the database match the UI |
| `frontend.test.js` | Heading, semester and bullet formatting that ends up in the published JSON; permission rules; minimum polling intervals |
| `config.test.js` | Limits fall back to safe defaults when an env var is missing or mistyped |
| `image_pipeline/tests/` | Images per page type (university 0, blog 4, others 1); exactly 1 image per FLUX call on the dev model with a timeout; retry ceiling; stored file ≤ 100 KB; overlay text correctness |

Each guard was checked by breaking the code on purpose (removing the budget check, the image
limiter, a timeout or the list cache, adding a stray poll, requesting 2 images per call) and
confirming the right test failed.

## Limits (server environment variables)

All have safe defaults in `server/config.js` (`config.limits`). Set them on the Render
service to change them without a code change.

| Variable | Default | What it caps |
|---|---|---|
| `AI_DAILY_BUDGET_USD` | `15` | Total Claude and GPT spend per UTC day. `<= 0` disables the cap. Today's spend shows next to the total AI cost on the home screen. |
| `IMAGE_GENERATIONS_PER_HOUR` | `30` | Image generate and regenerate requests per user per hour, across all image routes |
| `API_REQUESTS_PER_5_MIN` | `600` | Any signed-in request per user (normal use is well under 100) |
| `LOGIN_FAILURES_PER_15_MIN` | `10` | Failed sign-ins per email before that account is paused |
| `DB_STATEMENT_TIMEOUT_MS` | `15000` | Longest any single database query may run |
| `DB_CONNECT_TIMEOUT_MS` | `10000` | How long to wait for a database connection |
| `IMAGE_PIPELINE_TIMEOUT_MS` | `60000` | Calls to the image service |
| `WORDPRESS_TIMEOUT_MS` | `30000` | Publish calls to WordPress |

These are in-memory, per-process limits, which suits a single Render instance. The image service's
own Claude calls (writing image prompts) are not in `generation_logs`, so the image-per-hour
limit covers them rather than the daily AI budget.

## Adding to the app

- **A new route that calls Claude or GPT** needs `requireAiBudget` and a `rateLimit(...)`. The
  static guards fail otherwise.
- **A new route that starts image generation** needs `imageGenerationLimiter`.
- **New polling** goes through `useActivePolling` (`src/utils/useActivePolling.js`), not
  `setInterval`. If it hits the database, add a budget test to `api.usage.test.js`.
- **A new outbound call** needs `signal: AbortSignal.timeout(...)`.
