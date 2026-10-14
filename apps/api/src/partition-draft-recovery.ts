import { createHash } from 'node:crypto';
import type { KnownEnough as KE, Groups } from '@deal-table/contracts';
import { KnownEnoughApplicationError, type TrustedPrincipal } from '@deal-table/application';
import type { PartitionFence, PartitionIOContext } from '@deal-table/adapters/partition-request';
import { PartitionDraftFailure } from '@deal-table/adapters/partition-request';
import { createDynamoModelJobStore, createManagedPublicDraftPorts, type DurableJobStore, type JobReference,
  type PublicDraftAtomicItem, type PublicDraftFence, type PublicDraftEffect } from '@deal-table/adapters/durable-model-runtime';
import { stableDeliveryId } from './durable-enqueue.ts';
import { publicDraftId } from './partition-draft-runtime.ts';
export interface DraftRecoveryRequest {
  principal: TrustedPrincipal; groupId: string; key?: string; releaseRevision?: number; io: PartitionIOContext;
  inspect(key?: string): Promise<{ saved: Groups.GroupDraft | null; fence: PartitionFence }>;
}
export interface DraftRequestStatus { state: 'SAVED' | 'NOT_SUBMITTED' | 'PENDING' | 'UNKNOWN' | 'FAILED' | 'CANCELLED';
  canRelease: boolean; revision: number; draft?: Groups.GroupDraft }
const fail = (code: Extract<KE.DecisionCommandResult, { ok: false }>['error']['code']): never => { throw new KnownEnoughApplicationError(code); };
/** Nonces/status only. No model invocation or approval. Release is one owned CAS, never a blind clear. */
export function createDraftRequestRecovery(options: {
  sourceSha: string; now?: () => number;
  store(): DurableJobStore<PublicDraftFence, PublicDraftEffect>;
  releaseStore(native: PartitionFence, io: PartitionIOContext): DurableJobStore<PublicDraftFence, PublicDraftEffect>;
}) {
  return async (request: DraftRecoveryRequest): Promise<{ draftRequest?: DraftRequestStatus; requests?: { key: string }[] }> => {
    if (request.principal.kind !== 'participant') return fail('FORBIDDEN');
    const principal = request.principal; const inspected = await request.inspect(request.key);
    const now = options.now ?? Date.now;
    if (request.io.signal.aborted) throw new PartitionDraftFailure('REQUEST_UNKNOWN');
    const store = options.store();
    if (request.key === undefined) {
      const requests: { key: string }[] = [];
      for (const delivery of await store.deliveries()) {
        const snapshot = await store.read(delivery.jobId), ref = snapshot.job?.reference;
        if (ref?.kind === 'ARCHITECT' && ref.subject === principal.subject && ref.decisionId === request.groupId && ref.sourceSha === options.sourceSha && ref.requestKey) requests.push({ key: ref.requestKey });
      }
      await inspected.fence.assertCurrent(); return { requests };
    }
    if (inspected.saved) { await inspected.fence.assertCurrent(); return { draftRequest: { state: 'SAVED', canRelease: true, revision: 0, draft: inspected.saved } }; }
    const draftId = publicDraftId(request.groupId, principal.subject, request.key);
    const id = stableDeliveryId(options.sourceSha, request.groupId, draftId);
    const actionStore = request.releaseRevision === undefined ? store : options.releaseStore(inspected.fence, request.io);
    const prior = await actionStore.read(id), job = prior.job;
    if (job && (job.reference.kind !== 'ARCHITECT' || job.reference.subject !== principal.subject || job.reference.decisionId !== request.groupId
      || job.reference.reasoningJobId !== draftId || job.reference.requestKey !== request.key || job.reference.sourceSha !== options.sourceSha)) throw new PartitionDraftFailure('REQUEST_UNKNOWN');
    const quiescent = job?.phase === 'DEAD' && job.reason !== 'PROVIDER_UNCONFIRMED';
    const preCall = !job || (['READY', 'LEASED'].includes(job.phase) && job.attempts === 0 && job.reservedTokens === 0);
    const status = (): DraftRequestStatus => ({ state: !job ? 'NOT_SUBMITTED' : quiescent ? job.reason === 'CANCELLED' ? 'CANCELLED' : 'FAILED'
      : job.phase === 'CALLING' && (job.lease?.until ?? 0) <= now() || job.reason === 'PROVIDER_UNCONFIRMED' || job.phase === 'SUCCEEDED' ? 'UNKNOWN' : 'PENDING',
      canRelease: Boolean(preCall || quiescent), revision: job?.revision ?? 0 });
    if (request.releaseRevision === undefined) { await inspected.fence.assertCurrent(); return { draftRequest: status() }; }
    if (request.releaseRevision !== (job?.revision ?? 0)) return fail('STALE_CONTEXT');
    if (quiescent) return { draftRequest: status() };
    if (!preCall) throw new PartitionDraftFailure('REQUEST_UNKNOWN');
    const reference: JobReference = job?.reference ?? { jobId: id, kind: 'ARCHITECT', subject: principal.subject, decisionId: request.groupId,
      reasoningJobId: draftId, sourceSha: options.sourceSha, requestKey: request.key,
      authorityHash: createHash('sha256').update(JSON.stringify(['cancelled-before-submission', request.groupId, principal.subject, request.key])).digest('hex'), expiresAt: now() + 300000 };
    const next = structuredClone(prior); next.control.revision++; next.control.active = next.control.active.filter(value => value !== id);
    next.control.slots = next.control.slots.filter(value => value.jobId !== id);
    next.job = { schemaVersion: 1, revision: (job?.revision ?? 0) + 1, reference, phase: 'DEAD', reason: 'CANCELLED', lease: null,
      attempts: 0, failures: job?.failures ?? 0, availableAt: now(), reservedTokens: 0, reservedCostMicros: 0, usage: null, recoveryProofHash: null };
    const fence: PublicDraftFence = { kind: 'PUBLIC_DRAFT', reference };
    try { await actionStore.commit(prior, next, fence); } catch { /* Reconcile once, never repeat an uncertain release write. */ }
    const observed = await actionStore.read(id);
    if (observed.job?.phase === 'DEAD' && observed.job.reason === 'CANCELLED' && observed.job.reference.requestKey === request.key)
      return { draftRequest: { state: 'CANCELLED', canRelease: true, revision: observed.job.revision } };
    throw new PartitionDraftFailure('REQUEST_UNKNOWN');
  };
}
export function createManagedDraftRequestRecovery(options: { sourceSha: string;
  prepareGroupCommit(mutations: PartitionFence['mutations'], context: PartitionIOContext): Promise<PublicDraftAtomicItem[]> }) {
  const ports = createManagedPublicDraftPorts(options.sourceSha);
  return createDraftRequestRecovery({ sourceSha: options.sourceSha,
    store: () => createDynamoModelJobStore({ verifiedTarget: { account: '092954139775', region: 'us-east-1' }, sourceSha: options.sourceSha,
      publicDraftCommit: async () => { throw new Error('READ_ONLY_DRAFT_LOOKUP'); } }),
    releaseStore: (native, io) => ports.store(async () => ({ items: await options.prepareGroupCommit(native.mutations, io), authority: await ports.authority() })),
  });
}
