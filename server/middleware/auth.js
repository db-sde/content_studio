import { getSessionUser } from '../repositories/sessionsRepo.js';
import { config } from '../config.js';
import { asyncRoute } from './errorHandler.js';

const COOKIE_NAME = 'sid';

// Hand-rolled cookie parsing (no `cookie-parser` dependency) — this app only ever needs to read
// one cookie, so a full cookie-parsing library is unwarranted.
function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

// A cross-origin deployment (frontend on Vercel, backend on Render) means the browser sees every
// API call as cross-site — SameSite=Lax cookies are never sent on cross-site fetch/XHR (only on
// top-level navigations), so the session cookie would silently stop working the moment frontend
// and backend live on different domains. SameSite=None is required for that, which browsers only
// honor alongside Secure — tying both to config.cookieSecure keeps local HTTP dev on the current
// Lax/no-Secure behavior (an HTTPS-only Secure cookie would just get dropped over plain HTTP).
function cookieAttributes() {
  const secure = config.cookieSecure ? '; Secure' : '';
  const sameSite = config.cookieSecure ? 'None' : 'Lax';
  return { secure, sameSite };
}

export function setSessionCookie(res, token) {
  const maxAgeMs = config.sessionTtlHours * 60 * 60 * 1000;
  const { secure, sameSite } = cookieAttributes();
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=${sameSite}; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`);
}

export function clearSessionCookie(res) {
  const { secure, sameSite } = cookieAttributes();
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=${sameSite}; Max-Age=0${secure}`);
}

export function getSessionTokenFromRequest(req) {
  return getCookie(req, COOKIE_NAME);
}

// Populates req.currentUser or 401s. A deactivated account's session is treated as invalid even
// if the row hasn't expired yet, rather than requiring every route to check deactivated_at itself.
// Wrapped in asyncRoute right at the export so every call site (app.js's app.use, and the several
// per-route uses inside routes/auth.js) automatically gets a rejected-promise-reaches-errorHandler
// wrapper without each one needing to remember to add it — getSessionUser is now a Postgres query.
export const requireAuth = asyncRoute(async (req, res, next) => {
  const token = getSessionTokenFromRequest(req);
  const user = token ? await getSessionUser(token) : null;

  if (!user || user.deactivated_at) {
    const err = new Error('Not authenticated'); err.status = 401; throw err;
  }

  req.currentUser = user;
  next();
});

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.currentUser || !roles.includes(req.currentUser.role)) {
      const err = new Error('Not permitted for this role'); err.status = 403; throw err;
    }
    next();
  };
}
