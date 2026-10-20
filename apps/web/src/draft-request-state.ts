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
  if (status === 403) return 'Only this group’s organizer can do this. Refresh the group to check your access.';
  if (category === 'AI_AT_CAPACITY') return 'The assistant is busy. Close this attempt to return to your draft, then try again later.';
  if (category === 'AI_UNAVAILABLE') return 'AI suggestions are unavailable right now. Check this attempt before asking again. You can still add your own options.';
  if (category === 'INVALID_MODEL_OUTPUT') return 'The assistant couldn’t finish a usable draft. Your saved draft is unchanged. Check this attempt, then close it to edit or try again.';
  if (category === 'PROVIDER_FAILED') return 'The assistant couldn’t finish this attempt. Check its result before trying again.';
  if (category === 'REQUEST_PENDING') return 'The assistant is still working. Check progress before asking again.';
  if (category === 'REQUEST_UNKNOWN') return 'We couldn’t confirm the result. Check this attempt before asking again.';
  if (status === 404) return value?.error?.code === 'NOT_FOUND'
    ? 'You can’t open this group or draft right now. Refresh the group to check your access.'
    : 'This drafting feature is unavailable right now. Try again later.';
  if (status === 409) return 'This draft changed. Refresh to see the latest version.';
  if (status === 400 || status === 422) return value?.error?.code === 'NEEDS_CLARIFICATION'
    ? 'Add the missing details or edit the listed options to continue.' : 'Describe what your group needs to decide and check the options.';
  if (status === 507 || status === 429) return 'The drafting service is busy. Check this attempt and try again later.';
  if (status >= 500) return 'Drafting is temporarily unavailable. Check this attempt before trying again.';
  return 'We couldn’t complete this action. Refresh to check the result before trying again.';
}
