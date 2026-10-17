import { rateLimit } from './rateLimit.js';
import { config } from '../config.js';

// Shared limiter INSTANCES (not just shared settings): every route that triggers a paid image
// generation uses this same object, so one user's budget is counted across all of them - drafts.js
// and routes/imagePipeline.js together - rather than each route allowing its own 30/hour.
export const imageGenerationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: config.limits.imageGenerationsPerHour,
  keyFn: (req) => req.currentUser.id,
  message: `Image generation limit reached (${config.limits.imageGenerationsPerHour} per hour). Each one is a paid image-model call - please wait a bit before generating more.`
});

// Catch-all for every authenticated route (mounted in app.js). Normal use is far below this; it
// exists so a buggy client loop can't run up database usage for everyone.
export const apiRequestLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: config.limits.apiRequestsPer5Min,
  keyFn: (req) => req.currentUser.id,
  message: 'Too many requests from this account in a short time - please wait a minute and try again.'
});
