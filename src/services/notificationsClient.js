import { getJSON, postJSON } from './httpClient.js';

export function listNotifications() {
  return getJSON('/api/notifications');
}

export function markNotificationsRead() {
  return postJSON('/api/notifications/mark-read', {});
}

export function listActivity() {
  return getJSON('/api/notifications/activity');
}
