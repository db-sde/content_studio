import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth.js';
import { aiRouter } from './routes/ai.js';
import { fieldRecordsRouter } from './routes/fieldRecords.js';
import { learningQueueRouter } from './routes/learningQueue.js';
import { styleVersionsRouter } from './routes/styleVersions.js';
import { draftsRouter } from './routes/drafts.js';
import { notificationsRouter } from './routes/notifications.js';
import { costsRouter } from './routes/costs.js';
import { directoryRouter } from './routes/directory.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requireAuth } from './middleware/auth.js';
import { config } from './config.js';

// Express app factory (kept separate from index.js/boot sequence so it's importable in tests
// without opening a real port or DB connection).
export function createApp() {
  const app = express();

  // credentials: true is required for the session cookie to cross an actual origin boundary
  // (frontend on Vercel, backend on Render) — without it the browser drops Set-Cookie/Cookie on
  // any cross-origin request regardless of `credentials: 'include'` in the frontend's fetch calls.
  // Reflecting the request origin (rather than a bare `cors()`, which sends a literal `*` that
  // browsers refuse to pair with credentials) when FRONTEND_URL isn't set keeps local dev working
  // zero-config — set FRONTEND_URL in production to lock this down to the real deployed frontend.
  app.use(cors({ origin: config.frontendUrl || true, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', authRouter);
  // Every route beyond /api/auth talks to AI providers, the drafts table, or the audit trail
  // that feeds them — none of it should ever be reachable without a valid session.
  app.use('/api/ai', requireAuth, aiRouter);
  app.use('/api/field-records', requireAuth, fieldRecordsRouter);
  app.use('/api/learning-queue', requireAuth, learningQueueRouter);
  app.use('/api/style-versions', requireAuth, styleVersionsRouter);
  app.use('/api/drafts', requireAuth, draftsRouter);
  app.use('/api/notifications', requireAuth, notificationsRouter);
  app.use('/api/costs', requireAuth, costsRouter);
  app.use('/api/directory', requireAuth, directoryRouter);

  app.use(errorHandler);

  return app;
}
