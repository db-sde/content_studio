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
| `ai.pipeline.test.js` | The cost shape of AI generation, through the real routes with fake Claude/GPT clients: one prompt-cache warm-up per page, every field reading the same cached prefix (nothing per-field inside it), no GPT call for the SEO title/meta, at most 2 writes + 2 evaluations per field, empty or cut-off drafts rewritten once and never saved blank, and cached tokens priced correctly in every cost total |
| `api.usage.test.js` | Database-transfer budgets for polled endpoints (query count and bytes); caches never go stale; no-op saves don't write; cost totals stay a few rows |
| `limits.test.js` | Each limit really blocks: daily AI budget, image generations per hour, requests per user, failed sign-ins, outbound timeouts |
| `static-guards.test.js` | Scans the code. Fails if a new AI route skips the budget or rate limit, a paid image route skips the limiter, a route group skips the request limiter, a new `setInterval` bypasses the idle-aware poller, an outbound `fetch` has no timeout, the pool loses its statement timeout, or the image service starts requesting more than 1 image per call |
| `migrations.test.js` | The full migration chain builds from nothing, re-running it is a no-op, and the notification types in the database match the UI |
| `frontend.test.js` | Heading, semester and bullet formatting that ends up in the published JSON; permission rules; minimum polling intervals |
| `config.test.js` | Limits fall back to safe defaults when an env var is missing or mistyped |
| `image_pipeline/tests/` | Images per page type (university 0, blog 4, others 1); exactly 1 image per FLUX call on the dev model with a timeout; retry ceiling; stored file ≤ 100 KB; overlay text correctness |

## What an AI page costs, and why

A page's fields are written by Claude Sonnet 5 and the narrative ones scored by GPT-4o. Most of each
call is the same for every field on the page: the style profile and the page's facts. So:

- **Prompt caching.** That shared part is sent as a cached prefix (`anthropicProvider.complete`),
  billed at a tenth of the input price after the first call. One warm-up call (`max_tokens: 0`)
  writes it before the fields start in parallel. Anything per-field goes after it, and nothing
  that changes per request may go inside it, or every call pays full price again with no error.
  The GPT prompt puts the facts first for the same reason: OpenAI caches long shared prefixes at
  half price automatically.
- **SEO title and meta description** are checked by rules (`server/ai/seoChecks.js`): length,
  names the page, one clean line. They don't go to GPT. The writer gives 3 versions and the
  longest that passes is used.
- **Thinking.** Sonnet 5 thinks before writing, billed as output, and how long varies a lot from
  call to call. A draft that comes back empty or cut off is rewritten once, then the field is
  reported as failed. It is never saved blank or half-finished.

Measured on real pages (Oct 2026): about ₹5 of Claude per specialization page, down from ₹8-9.
GPT was out of credits during the check, so its saving is estimated (about ₹4, down from ₹7.5-8.7).
`input_tokens` in the logs is the uncached part only; `cache_read_tokens`/`cache_write_tokens`
hold the rest.

Each guard was checked by breaking the code on purpose (removing the budget check, the image
limiter, a timeout or the list cache, adding a stray poll, requesting 2 images per call, removing
the cache warm-up or a cache breakpoint, putting the field name in the cached prefix, sending SEO
fields to GPT, saving cut-off text) and confirming the right test failed.

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
