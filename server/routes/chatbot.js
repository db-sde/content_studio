import { Router } from 'express';
import { asyncRoute } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';
import { chatbotSyncStatus, resendAllToChatbot } from '../integrations/chatbotSync.js';

// The Admin's Chatbot panel: how the sync to the DegreeBaba chatbot is doing, and resending every
// published page after the chatbot restarts (it keeps its catalog only in memory).
export const chatbotRouter = Router();

chatbotRouter.get('/status', requireRole('admin'), asyncRoute(async (req, res) => {
  res.json(await chatbotSyncStatus());
}));

chatbotRouter.post('/resend', requireRole('admin'), asyncRoute(async (req, res) => {
  res.json(await resendAllToChatbot());
}));
