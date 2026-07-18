// Minimal in-memory sliding-window limiter — no new dependency, consistent with this codebase's
// hand-rolled-over-a-library philosophy (see the cookie parsing in auth.js, the concurrency pool
// in batchGenerate.js). Single-process only, which is fine for this internal tool's scale.
const buckets = new Map(); // key -> timestamps[]

// Auto-incrementing tag so every rateLimit(...) call site gets its own namespace within the
// shared `buckets` Map, even if two call sites both key by `req.currentUser.id` — without this,
// two independently-configured limiters (e.g. a max-10 one and a max-40 one) would silently share
// the same counter for the same user, so exhausting the stricter one would also 429 the other.
let nextLimiterId = 0;

export function rateLimit({ windowMs, max, keyFn }) {
  const limiterId = nextLimiterId++;

  return (req, res, next) => {
    const key = `${limiterId}:${keyFn(req)}`;
    const now = Date.now();
    const timestamps = (buckets.get(key) || []).filter(t => now - t < windowMs);

    if (timestamps.length >= max) {
      const err = new Error('Too many requests — please slow down and try again shortly.');
      err.status = 429;
      throw err;
    }

    timestamps.push(now);
    buckets.set(key, timestamps);
    next();
  };
}
