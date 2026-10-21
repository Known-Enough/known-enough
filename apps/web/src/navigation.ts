export type CreationStep = 'describe' | 'options';
export type DecisionSection = 'overview' | 'details' | 'outcome';
export type AppView = { kind: 'groups' } | { kind: 'group'; groupId: string }
  | { kind: 'creation'; groupId: string; step: CreationStep }
  | { kind: 'decision'; decisionId: string; groupId?: string; section?: DecisionSection }
  | { kind: 'invalid' };
const id = /^[A-Za-z0-9_-]{1,80}$/;
export function readAppView(search: string): AppView {
  const params = new URLSearchParams(search), group = params.get('group'), decision = params.get('decision');
  const create = params.get('create'), step = params.get('step'), section = params.get('view');
  if (['group', 'decision', 'create', 'step', 'view'].some(key => params.getAll(key).length > 1)
    || (group !== null && !id.test(group)) || (decision !== null && !id.test(decision))
    || (create !== null && (create !== 'decision' || !group || decision !== null || section !== null))
    || (step !== null && (create === null || !['describe', 'options'].includes(step)))
    || (section !== null && (!decision || !['overview', 'details', 'outcome'].includes(section)))) return { kind: 'invalid' };
  if (create) return { kind: 'creation', groupId: group!, step: step === 'options' ? 'options' : 'describe' };
  return decision ? { kind: 'decision', decisionId: decision, ...(group ? { groupId: group } : {}),
    ...(section && section !== 'overview' ? { section: section as DecisionSection } : {}) } : group ? { kind: 'group', groupId: group } : { kind: 'groups' };
}
export function appViewSearch(view: AppView): string {
  const params = new URLSearchParams();
  if (view.kind === 'group' || view.kind === 'creation' || view.kind === 'decision' && view.groupId) params.set('group', view.groupId!);
  if (view.kind === 'creation') { params.set('create', 'decision'); params.set('step', view.step); }
  if (view.kind === 'decision') { params.set('decision', view.decisionId); if (view.section && view.section !== 'overview') params.set('view', view.section); }
  return params.size ? '?' + params.toString() : '';
}
/** Page changes inside one workspace retain its in-memory edits and uncertain requests. */
export function sameAppWorkspace(current: AppView, next: AppView): boolean {
  if (current.kind === 'decision' && next.kind === 'decision') return current.decisionId === next.decisionId && current.groupId === next.groupId;
  if ((current.kind === 'group' || current.kind === 'creation') && (next.kind === 'group' || next.kind === 'creation')) return current.groupId === next.groupId;
  return current.kind === 'groups' && next.kind === 'groups';
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
