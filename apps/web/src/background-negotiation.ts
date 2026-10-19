import { KnownEnough as KE } from '@deal-table/contracts';
import { BACKGROUND_NEGOTIATION_PROFILE, RequestNegotiation, NegotiationReceipt } from '@deal-table/contracts/durable-command';
export type BackgroundReceipt = ReturnType<typeof NegotiationReceipt.parse>;
export type BackgroundRequest = ReturnType<typeof RequestNegotiation.parse>;
export type DecisionApi = (path: string, init?: RequestInit) => Promise<Response>;
export function backgroundNegotiationAvailable(response: Pick<Response, 'headers'>): boolean {
  const parts = (response.headers.get('content-type') ?? '').split(';').map(value => value.trim());
  if (parts[0]?.toLowerCase() !== 'application/json') return false;
  const profiles = parts.slice(1).filter(value => /^profile\s*=/i.test(value));
  return profiles.length === 1 && profiles[0]!.replace(/^profile\s*=\s*/i, '').replace(/^"|"$/g, '') === BACKGROUND_NEGOTIATION_PROFILE;
}
export function backgroundRequest(snapshot: KE.PublicDecisionSnapshot, owner: KE.OwnerDecisionSnapshot, requestId: string): BackgroundRequest {
  if (owner.publicSnapshot.contextToken !== snapshot.contextToken || owner.publicSnapshot.semanticVersion !== snapshot.semanticVersion
    || owner.publicSnapshot.frame.decisionId !== snapshot.frame.decisionId) throw new Error('BACKGROUND_CONTEXT_CHANGED');
  return RequestNegotiation.parse({ schemaVersion: 2, type: 'REQUEST_NEGOTIATION', requestId, decisionId: snapshot.frame.decisionId,
    expected: { contextToken: snapshot.contextToken, semanticVersion: snapshot.semanticVersion, controlVersion: owner.controlVersion } });
}
export async function submitBackgroundRequest(api: DecisionApi, command: BackgroundRequest): Promise<BackgroundReceipt> {
  const body = RequestNegotiation.parse(command);
  const response = await api(`/decisions/${body.decisionId}/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error('BACKGROUND_REQUEST_UNCONFIRMED');
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).sort().join('|') !== 'job|ok|requestId'
    || !('ok' in result) || result.ok !== true || !('requestId' in result) || result.requestId !== body.requestId || !('job' in result)) throw new Error('BACKGROUND_REQUEST_UNCONFIRMED');
  return NegotiationReceipt.parse(result.job);
}
export interface BackgroundTarget { decisionId: string; contextToken: string; semanticVersion: number; ownerParticipantId: string; expiresAt: string }
export async function readBackgroundDecision(api: DecisionApi, target: BackgroundTarget, signal: AbortSignal) {
  const response = await api(`/decisions/${target.decisionId}/me`, { signal });
  if (!response.ok) throw new Error('BACKGROUND_READ_UNAVAILABLE');
  const owner = KE.OwnerDecisionSnapshot.parse(await response.json());
  if (signal.aborted) throw new Error('BACKGROUND_CANCELLED');
  // One authorized owner read contains a coherent shared/own result. Comparing
  // two separate reads could reject valid progress occurring between them.
  if (owner.ownerParticipantId !== target.ownerParticipantId || owner.publicSnapshot.frame.decisionId !== target.decisionId
    || owner.publicSnapshot.contextToken !== target.contextToken || owner.publicSnapshot.semanticVersion !== target.semanticVersion)
    throw new Error('BACKGROUND_CONTEXT_CHANGED');
  return { snapshot: owner.publicSnapshot, owner };
}
function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new Error('BACKGROUND_CANCELLED')); return; }
    const abort = () => { clearTimeout(timer); reject(new Error('BACKGROUND_CANCELLED')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 3000);
    signal.addEventListener('abort', abort, { once: true });
  });
}
/** Read-only bounded polling. It never submits another job or invokes a model. */
export async function pollBackgroundDecision(options: { target: BackgroundTarget; api: DecisionApi; signal: AbortSignal;
  accept(value: Awaited<ReturnType<typeof readBackgroundDecision>>): void; now?: () => number; wait?: (signal: AbortSignal) => Promise<void> }) {
  const target = structuredClone(options.target);
  const expiresAt = Date.parse(target.expiresAt); const now = options.now ?? Date.now; const wait = options.wait ?? pause;
  if (!Number.isFinite(expiresAt)) throw new Error('BACKGROUND_DEADLINE_INVALID');
  let failures = 0;
  for (let reads = 0; reads < 60; reads++) {
    if (options.signal.aborted) return 'CANCELLED' as const;
    if (now() >= expiresAt) return 'EXPIRED' as const;
    try { await wait(options.signal); }
    catch { return options.signal.aborted ? 'CANCELLED' as const : 'UNAVAILABLE' as const; }
    if (options.signal.aborted) return 'CANCELLED' as const;
    if (now() >= expiresAt) return 'EXPIRED' as const;
    try {
      const value = await readBackgroundDecision(options.api, target, options.signal);
      if (options.signal.aborted) return 'CANCELLED' as const;
      options.accept(value); failures = 0;
      if (value.snapshot.status !== 'REASONING') return 'SETTLED' as const;
    } catch (error) {
      if (options.signal.aborted) return 'CANCELLED' as const;
      if (error instanceof Error && error.message === 'BACKGROUND_CONTEXT_CHANGED') return 'CONTEXT_CHANGED' as const;
      if (++failures >= 3) return 'UNAVAILABLE' as const;
    }
  }
  return 'EXPIRED' as const;
}
