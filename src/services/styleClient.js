import { getJSON, postJSON } from './httpClient.js';

// Style Evolution workflow — Senior-only routes for reviewing accumulated learning_queue entries
// (approved AI content a Senior substantially rewrote) and activating a new style version from them.
export function getPendingLearningQueue() {
  return getJSON('/api/learning-queue');
}

export function markLearningQueueIncorporated(ids) {
  return postJSON('/api/learning-queue/incorporate', { ids });
}

export function listStyleVersions() {
  return getJSON('/api/style-versions');
}

export function createStyleVersion({ styleJson, notes }) {
  return postJSON('/api/style-versions', { styleJson, notes });
}
