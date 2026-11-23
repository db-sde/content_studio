import { getJSON, postJSON } from './httpClient.js';

// The Admin's Chatbot panel (server/routes/chatbot.js). Admin only.
// { configured, chatbotUrl, waiting, sent, failed, lastSentAt, problems, resending, chatbot: { status, pages, lastUpdated } | null }
export const getChatbotStatus = () => getJSON('/api/chatbot/status');
// Queues every published university, course and specialization page: { queued: { university, course, specialization }, skipped }
export const resendAllToChatbot = () => postJSON('/api/chatbot/resend', {});
