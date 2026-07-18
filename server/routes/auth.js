import { Router } from 'express';
import { asyncRoute } from '../middleware/errorHandler.js';
import { requireAuth, setSessionCookie, clearSessionCookie, getSessionTokenFromRequest } from '../middleware/auth.js';
import { hashPassword, verifyPassword } from '../utils/passwords.js';
import { generateToken } from '../utils/tokens.js';
import { countUsers, createUser, getUserByEmail, getUserById, updatePassword } from '../repositories/usersRepo.js';
import { createSession, deleteSession } from '../repositories/sessionsRepo.js';
import { createInvite, getOpenInvite, markInviteUsed } from '../repositories/invitesRepo.js';
import { createPasswordReset, getOpenPasswordReset, markPasswordResetUsed } from '../repositories/passwordResetsRepo.js';

export const authRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// This app is internal to DegreeBaba — no self-signup exists (invite-only already), but the
// invite link itself doesn't restrict who can redeem it with what email, so this is the actual
// gate. Checked on every account-creation path and again on login (the latter as a backstop in
// case any non-degreebaba account ever ends up in the table some other way).
const ALLOWED_EMAIL_DOMAIN = 'degreebaba.com';

function isAllowedEmailDomain(email) {
  return typeof email === 'string' && email.trim().toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
}

function badRequest(message) {
  const err = new Error(message); err.status = 400; return err;
}

async function logIn(res, user) {
  const token = generateToken();
  await createSession(token, user.id);
  setSessionCookie(res, token);
}

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.currentUser });
});

// Public — lets the frontend tell "no accounts exist yet, show the setup screen" apart from
// "accounts exist, this visitor just isn't logged in, show the login screen" before either the
// bootstrap or login form has been attempted.
authRouter.get('/bootstrap-status', asyncRoute(async (req, res) => {
  res.json({ needsBootstrap: (await countUsers()) === 0 });
}));

// Only succeeds while the users table is empty — the very first account, always Admin, since
// Admin sits at the top of the invite chain (can invite Senior or Intern; Senior can invite
// Intern or another Senior; Intern can only invite Intern) and that chain needs one account to
// start it.
authRouter.post('/bootstrap', asyncRoute(async (req, res) => {
  if ((await countUsers()) > 0) {
    const err = new Error('Setup has already been completed'); err.status = 403; throw err;
  }

  const { name, email, password } = req.body || {};
  if (!name || !email || !EMAIL_RE.test(email) || !password || password.length < 8) {
    throw badRequest('name, a valid email, and a password of at least 8 characters are required');
  }
  if (!isAllowedEmailDomain(email)) {
    throw badRequest(`Only @${ALLOWED_EMAIL_DOMAIN} email addresses can create an account here`);
  }

  const user = await createUser({ name, email, passwordHash: hashPassword(password), role: 'admin' });
  await logIn(res, user);
  res.json({ user });
}));

authRouter.post('/login', asyncRoute(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) throw badRequest('email and password are required');

  // Checked before touching the DB at all — an account whose email somehow isn't
  // @degreebaba.com (a stale row, a manual DB edit) should never be able to log in, regardless
  // of whether the password would otherwise be correct.
  if (!isAllowedEmailDomain(email)) {
    const err = new Error('Invalid email or password'); err.status = 401; throw err;
  }

  const row = await getUserByEmail(email);
  if (!row || row.deactivated_at || !verifyPassword(password, row.password_hash)) {
    const err = new Error('Invalid email or password'); err.status = 401; throw err;
  }

  const user = await getUserById(row.id);
  await logIn(res, user);
  res.json({ user });
}));

authRouter.post('/logout', requireAuth, asyncRoute(async (req, res) => {
  const token = getSessionTokenFromRequest(req);
  if (token) await deleteSession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
}));

// Any Intern may invite a new Intern; any Senior may invite a new Intern or Senior; any Admin
// may invite any of the three roles. An Intern must never be able to mint an Admin (or Senior)
// invite themselves — enforced here, not just hidden in the UI.
const INVITE_PERMISSIONS = {
  intern: ['intern'],
  senior: ['intern', 'senior'],
  admin: ['intern', 'senior', 'admin']
};

authRouter.post('/invites', requireAuth, asyncRoute(async (req, res) => {
  const { role } = req.body || {};
  if (!['intern', 'senior', 'admin'].includes(role)) throw badRequest('role must be "intern", "senior", or "admin"');
  if (!INVITE_PERMISSIONS[req.currentUser.role].includes(role)) {
    const err = new Error(`A ${req.currentUser.role} may not invite a ${role}`); err.status = 403; throw err;
  }

  const token = generateToken();
  await createInvite(token, { role, invitedByUserId: req.currentUser.id });
  res.json({ token });
}));

// Public — the invite-accept screen needs to show which role this link grants before the
// visitor has any account of their own.
authRouter.get('/invites/:token', asyncRoute(async (req, res) => {
  const invite = await getOpenInvite(req.params.token);
  if (!invite) {
    const err = new Error('This invite link is invalid or has expired'); err.status = 404; throw err;
  }
  res.json({ role: invite.role });
}));

authRouter.post('/invites/:token/accept', asyncRoute(async (req, res) => {
  const invite = await getOpenInvite(req.params.token);
  if (!invite) {
    const err = new Error('This invite link is invalid or has expired'); err.status = 404; throw err;
  }

  const { name, email, password } = req.body || {};
  if (!name || !email || !EMAIL_RE.test(email) || !password || password.length < 8) {
    throw badRequest('name, a valid email, and a password of at least 8 characters are required');
  }
  if (!isAllowedEmailDomain(email)) {
    throw badRequest(`Only @${ALLOWED_EMAIL_DOMAIN} email addresses can create an account here`);
  }
  if (await getUserByEmail(email)) throw badRequest('An account with this email already exists');

  const user = await createUser({ name, email, passwordHash: hashPassword(password), role: invite.role });
  await markInviteUsed(req.params.token, user.id);
  await logIn(res, user);
  res.json({ user });
}));

// Reset-permission matrix (TBD confirmed default, per plan): Senior can reset anyone's password;
// Intern can only reset another Intern's.
authRouter.post('/password-resets', requireAuth, asyncRoute(async (req, res) => {
  const { email } = req.body || {};
  if (!email) throw badRequest('email is required');

  const target = await getUserByEmail(email);
  if (!target) {
    const err = new Error('No account with this email'); err.status = 404; throw err;
  }
  if (req.currentUser.role === 'intern' && target.role !== 'intern') {
    const err = new Error('Interns may only reset another Intern\'s password'); err.status = 403; throw err;
  }

  const token = generateToken();
  await createPasswordReset(token, target.id);
  res.json({ token });
}));

authRouter.get('/password-resets/:token', asyncRoute(async (req, res) => {
  const reset = await getOpenPasswordReset(req.params.token);
  if (!reset) {
    const err = new Error('This reset link is invalid or has expired'); err.status = 404; throw err;
  }
  res.json({ ok: true });
}));

authRouter.post('/password-resets/:token/use', asyncRoute(async (req, res) => {
  const reset = await getOpenPasswordReset(req.params.token);
  if (!reset) {
    const err = new Error('This reset link is invalid or has expired'); err.status = 404; throw err;
  }

  const { password } = req.body || {};
  if (!password || password.length < 8) throw badRequest('password must be at least 8 characters');

  await updatePassword(reset.user_id, hashPassword(password));
  await markPasswordResetUsed(req.params.token);
  res.json({ ok: true });
}));
