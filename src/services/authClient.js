import { getJSON, postJSON } from './httpClient.js';

export function getCurrentUser() {
  return getJSON('/api/auth/me');
}

export function getBootstrapStatus() {
  return getJSON('/api/auth/bootstrap-status');
}

export function bootstrap(payload) {
  return postJSON('/api/auth/bootstrap', payload);
}

export function login(payload) {
  return postJSON('/api/auth/login', payload);
}

export function logout() {
  return postJSON('/api/auth/logout', {});
}

export function createInvite(role) {
  return postJSON('/api/auth/invites', { role });
}

export function getInvite(token) {
  return getJSON(`/api/auth/invites/${token}`);
}

export function acceptInvite(token, payload) {
  return postJSON(`/api/auth/invites/${token}/accept`, payload);
}

export function requestPasswordReset(email) {
  return postJSON('/api/auth/password-resets', { email });
}

export function getPasswordReset(token) {
  return getJSON(`/api/auth/password-resets/${token}`);
}

export function submitPasswordReset(token, password) {
  return postJSON(`/api/auth/password-resets/${token}/use`, { password });
}
