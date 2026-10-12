export type AppView = { kind: 'groups' } | { kind: 'group'; groupId: string } | { kind: 'decision'; decisionId: string; groupId?: string } | { kind: 'invalid' };
const id = /^[A-Za-z0-9_-]{1,80}$/;
export function readAppView(search: string): AppView {
  const params = new URLSearchParams(search), group = params.get('group'), decision = params.get('decision');
  if (params.getAll('group').length > 1 || params.getAll('decision').length > 1 || (group !== null && !id.test(group)) || (decision !== null && !id.test(decision))) return { kind: 'invalid' };
  return decision ? { kind: 'decision', decisionId: decision, ...(group ? { groupId: group } : {}) } : group ? { kind: 'group', groupId: group } : { kind: 'groups' };
}
export function appViewSearch(view: AppView): string {
  const params = new URLSearchParams();
  if (view.kind === 'group' || view.kind === 'decision' && view.groupId) params.set('group', view.groupId!);
  if (view.kind === 'decision') params.set('decision', view.decisionId);
  return params.size ? '?' + params.toString() : '';
}
export function saveIntendedView(view: AppView, storage: Storage = sessionStorage) {
  if (view.kind !== 'invalid') storage.setItem('ke-intended-view', JSON.stringify({ search: appViewSearch(view), at: Date.now() }));
}
export function takeIntendedView(storage: Storage = sessionStorage): AppView | null {
  const bytes = storage.getItem('ke-intended-view'); storage.removeItem('ke-intended-view');
  try { const value = JSON.parse(bytes ?? 'null');
    if (!value || typeof value.search !== 'string' || !Number.isFinite(value.at) || value.at > Date.now() || Date.now() - value.at > 3600000) return null;
    const view = readAppView(value.search); return view.kind === 'invalid' ? null : view;
  } catch { return null; }
}
