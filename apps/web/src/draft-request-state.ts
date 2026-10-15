const id = /^[A-Za-z0-9_-]{1,80}$/;
export function readDraftRequest(groupId: string, storage: Storage = sessionStorage): string | null {
  if (!id.test(groupId)) return null;
  const raw = storage.getItem('ke-draft-request:' + groupId);
  return raw && id.test(raw) ? raw : null;
}
export function saveDraftRequest(groupId: string, key: string | null, storage: Storage = sessionStorage) {
  if (!id.test(groupId) || key !== null && !id.test(key)) throw new Error('Invalid draft request reference');
  if (key) storage.setItem('ke-draft-request:' + groupId, key); else storage.removeItem('ke-draft-request:' + groupId);
}
export function draftFailureMessage(status: number, body: unknown): string {
  const value = body && typeof body === 'object' ? body as { draftFailure?: unknown; error?: { code?: unknown } } : null;
  const category = value?.draftFailure;
  if (status === 401) return 'Your session expired. Sign in again to continue.';
  if (status === 403) return 'Only the current approved group organizer can do this. Refresh your access and group.';
  if (category === 'AI_AT_CAPACITY') return 'All AI processing slots are occupied. No new AI call started. Close this unfinished request to return to your saved draft; try again after service recovery.';
  if (category === 'AI_UNAVAILABLE') return 'AI drafting is unavailable on this server. Recover the request before trying again later.';
  if (category === 'INVALID_MODEL_OUTPUT') return 'The AI response did not match the supported decision format. Your earlier saved draft and answers are kept. Check this request below, then close it when available to continue editing.';
  if (category === 'PROVIDER_FAILED') return 'The AI provider could not complete this request. Recover its status before trying again.';
  if (category === 'REQUEST_PENDING') return 'This draft request is still processing. Recover its status; do not start another request.';
  if (category === 'REQUEST_UNKNOWN') return 'The outcome is not confirmed. Recover this same request before starting another.';
  if (status === 404) return value?.error?.code === 'NOT_FOUND'
    ? 'This group or draft is unavailable to your current account. Refresh the group.'
    : 'This draft action is missing on the server. Try again after the server is updated.';
  if (status === 409) return 'The group, draft or request changed. Refresh and review its current state.';
  if (status === 400 || status === 422) return value?.error?.code === 'NEEDS_CLARIFICATION'
    ? 'The draft needs supported public choices or clarification before it can continue.' : 'Enter a supported public objective and review the draft fields.';
  if (status === 507 || status === 429) return 'Drafting is at capacity. Recover the request and try later; repeated clicks will not free space.';
  if (status >= 500) return 'The drafting service is unavailable. Recover the original request before retrying.';
  return 'The action could not be completed. Refresh its current state before trying again.';
}
