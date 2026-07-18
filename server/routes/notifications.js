import { Router } from 'express';
import { asyncRoute } from '../middleware/errorHandler.js';
import { listNotificationsForUser, markNotificationsRead, getNotificationsLastReadAt, listActivityForUser } from '../repositories/notificationsRepo.js';

export const notificationsRouter = Router();

notificationsRouter.get('/', asyncRoute(async (req, res) => {
  res.json({
    notifications: await listNotificationsForUser(req.currentUser),
    lastReadAt: await getNotificationsLastReadAt(req.currentUser.id)
  });
}));

notificationsRouter.get('/activity', asyncRoute(async (req, res) => {
  res.json({ activity: await listActivityForUser(req.currentUser) });
}));

notificationsRouter.post('/mark-read', asyncRoute(async (req, res) => {
  await markNotificationsRead(req.currentUser.id);
  res.json({ ok: true });
}));
