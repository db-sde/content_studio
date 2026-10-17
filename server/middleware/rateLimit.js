// Minimal in-memory sliding-window limiter — no new dependency, consistent with this codebase's
// hand-rolled-over-a-library philosophy (see the cookie parsing in auth.js, the concurrency pool
// in batchGenerate.js). Single-process only, which is fine for this internal tool's scale.
const buckets = new Map(); // key -> { windowMs, timestamps[] }

// Auto-incrementing tag so every rateLimit(...) call site gets its own namespace within the
// shared `buckets` Map, even if two call sites both key by `req.currentUser.id` — without this,
// two independently-configured limiters (e.g. a max-10 one and a max-40 one) would silently share
// the same counter for the same user, so exhausting the stricter one would also 429 the other.
let nextLimiterId = 0;

export function rateLimit({ windowMs, max, keyFn, message }) {
  const limiterId = nextLimiterId++;

  return (req, res, next) => {
    const key = `${limiterId}:${keyFn(req)}`;
    const now = Date.now();
    const timestamps = (buckets.get(key)?.timestamps || []).filter(t => now - t < windowMs);

    if (timestamps.length >= max) {
      const err = new Error(message || 'Too many requests — please slow down and try again shortly.');
      err.status = 429;
      throw err;
    }

    timestamps.push(now);
    buckets.set(key, { windowMs, timestamps });
    pruneIfLarge(now);
    next();
  };
}

// Keys are per user (and per email for sign-in attempts), so this map only grows with distinct
// callers - but nothing ever removed a key, so drop ones whose whole window has expired once it
// gets large.
function pruneIfLarge(now) {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) {
    if (!bucket.timestamps.some(t => now - t < bucket.windowMs)) buckets.delete(key);
  }
}

// Tests only - a fresh slate between test cases that deliberately exhaust a limit.
export function __resetRateLimitsForTests() {
  buckets.clear();
}
