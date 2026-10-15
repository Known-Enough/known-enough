import { createHash } from 'node:crypto';
import { KnownEnough as KE } from '@deal-table/contracts';
import { KnownEnoughApplication, KnownEnoughApplicationError, OwnerConversationArchitect, OwnerConversationError,
  type Clock, type IdSource, type TrustedPrincipal } from '@deal-table/application';
import { createBedrockModels, type ConverseTransport } from '@deal-table/adapters';
import { TransactWriteItemsCommand, createPartitionDecisionRepository, type PartitionTransport, type PartitionDecisionTransport,
  type PartitionIOContext, partitionIO } from '@deal-table/adapters/partition-request';
import { createManagedPublicDraftPorts, DurableModelJobs, DurableJobError,
  type PublicDraftAtomicItem, type PublicDraftCommit, type PublicDraftFence, type PublicDraftEffect,
  type DurableJobStore, type JobReference, type JobPin } from '@deal-table/adapters/durable-model-runtime';
import { stableDeliveryId } from './durable-enqueue.ts';

export class PartitionOwnerFailure extends KnownEnoughApplicationError {
  constructor(readonly category: 'AI_UNAVAILABLE' | 'AI_AT_CAPACITY' | 'INVALID_MODEL_OUTPUT' | 'REQUEST_PENDING' | 'REQUEST_UNKNOWN' | 'FRAME_NOT_CONFIRMED' | 'PROCESSING_NOT_READY') {
    super(category === 'FRAME_NOT_CONFIRMED' || category === 'INVALID_MODEL_OUTPUT' ? 'NEEDS_CLARIFICATION' : 'RETRYABLE_SERVER_ERROR');
  }
}
export type OwnerInterpretationStatus = { state: 'SAVED'; draft: KE.AIConstraintDraft }
  | { state: 'NOT_SUBMITTED' | 'FAILED' | 'PENDING' | 'UNKNOWN'; canRelease?: boolean; revision?: number };
export type OwnerInterpretation = (input: { principal: TrustedPrincipal; decisionId: string; requestId: string;
  messages?: unknown; acceptedSynthetic?: boolean; closeRevision?: number; io: PartitionIOContext }) => Promise<OwnerInterpretationStatus>;

/** Owner-only transient conversation, nonce-only durable journal, atomic native draft/result commit.
 * A status check never dispatches a model. Unknown dispatches cannot be replayed or retired here.
 */
export function createPartitionOwnerRuntime(options: {
  sourceSha: string; groups: PartitionTransport; decisions: PartitionDecisionTransport;
  decisionArn: string; partitionArn: string; clock: Clock; ids: IdSource;
  prepareDecisionCommit(command: TransactWriteItemsCommand, io: PartitionIOContext): Promise<PublicDraftAtomicItem[]>;
  assertRetained(principal: TrustedPrincipal): Promise<unknown>;
  acknowledgeSyntheticProcessing(principal: TrustedPrincipal): Promise<void>;
  retentionConditions(principal: TrustedPrincipal): Promise<PublicDraftAtomicItem[]>;
  transport: ConverseTransport; store(commit: PublicDraftCommit): DurableJobStore<PublicDraftFence, PublicDraftEffect>;
  authority(): Promise<JobPin>;
}): OwnerInterpretation {
  if (!/^[a-f0-9]{40}$/.test(options.sourceSha)) throw new Error('OWNER_RUNTIME_INVALID');
  return async ({ principal, decisionId, requestId, messages, acceptedSynthetic, closeRevision, io }) => {
    if (principal.kind !== 'participant') throw new KnownEnoughApplicationError('FORBIDDEN');
    if (messages !== undefined && acceptedSynthetic !== true) throw new KnownEnoughApplicationError('INVALID_COMMAND');
    const now = () => Date.parse(options.clock.now());
    const draftId = 'owner-' + createHash('sha256').update(JSON.stringify([principal.subject, decisionId, requestId])).digest('hex').slice(0, 40);
    const jobId = stableDeliveryId(options.sourceSha, decisionId, draftId);
    const repositories = createPartitionDecisionRepository({ ...options, transport: options.decisions });
    const application = new KnownEnoughApplication({ repository: repositories.forParticipant(principal, io), clock: options.clock, ids: options.ids });
    const current = await application.getOwnerSnapshot(principal, decisionId);
    const retained = () => { if (io.signal.aborted) throw new PartitionOwnerFailure('REQUEST_UNKNOWN'); };
    retained();
    let metadataOnly = false;
    const captures = new WeakMap<PublicDraftFence, PublicDraftAtomicItem[]>();
    const store = options.store(async (fence, effect) => {
      const selected = effect?.fence ?? fence;
      const items = captures.get(selected);
      if (!items || selected.reference.jobId !== jobId || selected.kind !== 'OWNER_DRAFT') throw new DurableJobError('INVALID');
      return { items: [...items, ...(metadataOnly ? [] : await options.retentionConditions(principal))], authority: await options.authority() };
    });
    const before = await store.read(jobId);
    const ref = before.job?.reference;
    if (ref && (ref.kind !== 'OWNER' || ref.subject !== principal.subject || ref.decisionId !== decisionId
      || ref.reasoningJobId !== draftId || ref.requestKey !== requestId || ref.sourceSha !== options.sourceSha)) throw new KnownEnoughApplicationError('FORBIDDEN');
    const disposition = (job: typeof before.job): OwnerInterpretationStatus => {
      if (!job) return current.draft?.draftId === draftId ? { state: 'SAVED', draft: current.draft } : { state: 'NOT_SUBMITTED', canRelease: true, revision: 0 };
      if (job.phase === 'SUCCEEDED') {
        if (current.draft?.draftId !== draftId) throw new KnownEnoughApplicationError('STALE_CONTEXT');
        return { state: 'SAVED', draft: current.draft };
      }
      if (job.phase === 'DEAD') return { state: job.reason === 'PROVIDER_UNCONFIRMED' ? 'UNKNOWN' : 'FAILED', revision: job.revision, canRelease: job.reason !== 'PROVIDER_UNCONFIRMED' };
      return { state: job.phase === 'CALLING' && (job.lease?.until ?? 0) <= now() || job.reference.expiresAt <= now() && job.attempts > 0 ? 'UNKNOWN' : 'PENDING',
        revision: job.revision, canRelease: job.attempts === 0 && job.reservedTokens === 0 && ['READY', 'LEASED'].includes(job.phase) };
    };
    const bodyHash = messages === undefined ? undefined : createHash('sha256').update(JSON.stringify([decisionId, principal.subject, messages])).digest('hex');
    if (ref && bodyHash !== undefined && ref.authorityHash !== bodyHash) throw new KnownEnoughApplicationError('STALE_CONTEXT');
    const reference: JobReference = ref ?? { jobId, kind: 'OWNER', subject: principal.subject, decisionId, reasoningJobId: draftId,
      authorityHash: bodyHash ?? createHash('sha256').update(JSON.stringify(['cancelled-before-submission', principal.subject, decisionId, requestId])).digest('hex'), sourceSha: options.sourceSha, expiresAt: now() + 300000, requestKey: requestId };
    if (closeRevision !== undefined) {
      const status = disposition(before.job);
      if (status.state === 'SAVED' || status.state === 'FAILED') return status;
      if (!('canRelease' in status) || !status.canRelease) throw new PartitionOwnerFailure('REQUEST_UNKNOWN');
      if (closeRevision !== (before.job?.revision ?? 0)) throw new KnownEnoughApplicationError('STALE_CONTEXT');
      metadataOnly = true;
      const fence = await capture(app => app.getOwnerSnapshot(principal, decisionId));
      const next = structuredClone(before); next.control.revision++;
      next.control.active = next.control.active.filter(id => id !== jobId); next.control.slots = next.control.slots.filter(slot => slot.jobId !== jobId);
      next.job = { schemaVersion: 1, revision: (before.job?.revision ?? 0) + 1, reference, phase: 'DEAD', reason: 'CANCELLED', lease: null,
        attempts: 0, failures: before.job?.failures ?? 0, availableAt: now(), reservedTokens: 0, reservedCostMicros: 0, usage: null, recoveryProofHash: null };
      try { await store.commit(before, next, fence); } catch { /* Resolve once; never repeat an ambiguous cancellation. */ }
      const observed = await store.read(jobId);
      if (observed.job?.phase === 'DEAD' && observed.job.reason === 'CANCELLED' && observed.job.reference.requestKey === requestId) return { state: 'FAILED', canRelease: true, revision: observed.job.revision };
      throw new PartitionOwnerFailure('REQUEST_UNKNOWN');
    }
    if (messages === undefined || before.job) return disposition(before.job);
    if (!before.control.enabled || before.control.sourceSha !== options.sourceSha) throw new PartitionOwnerFailure('AI_UNAVAILABLE');
    if (before.control.slots.length >= 2) throw new PartitionOwnerFailure('AI_AT_CAPACITY');
    if (!current.publicSnapshot.frame.requiredParticipantIds.every(id => current.publicSnapshot.frameConfirmations.some(item => item.participantId === id))
      || !current.publicSnapshot.frameConfirmations.some(item => item.participantId === current.ownerParticipantId)) throw new PartitionOwnerFailure('FRAME_NOT_CONFIRMED');
    try {
      if (messages !== undefined) await options.acknowledgeSyntheticProcessing(principal);
      await options.assertRetained(principal);
    } catch { throw new PartitionOwnerFailure('PROCESSING_NOT_READY'); }
    let usage: { inputTokens: number; outputTokens: number } | null = null;
    let dispatched = false, acknowledged = false;
    async function capture(work: (application: KnownEnoughApplication) => Promise<unknown>): Promise<PublicDraftFence> {
      if (!metadataOnly) await options.assertRetained(principal); retained();
      // Each of the three fixed phases has its own 64-request bound; all share the outer deadline.
      const phase = partitionIO({ timeoutMs: 27000 }); const phaseIO = { ...phase, signal: AbortSignal.any([phase.signal, io.signal]) };
      let captured: PublicDraftAtomicItem[] | undefined;
      const transport: PartitionDecisionTransport = { send: async (command, context) => {
        if (!(command instanceof TransactWriteItemsCommand)) return options.decisions.send(command, context);
        captured = await options.prepareDecisionCommit(command, context); return {};
      } };
      const repository = createPartitionDecisionRepository({ ...options, transport }).forParticipant(principal, phaseIO);
      await work(new KnownEnoughApplication({ repository, clock: options.clock, ids: options.ids }));
      if (!captured) throw new DurableJobError('INVALID');
      const fence: PublicDraftFence = { kind: 'OWNER_DRAFT', reference };
      captures.set(fence, captured); return fence;
    }
    const engine = new DurableModelJobs({ kind: 'OWNER', store, now, bounds: { leaseMs: 25000, timeoutMs: 18000 }, execution: {
      reload: async () => ({ context: messages, fence: await capture(app => app.getOwnerSnapshot(principal, decisionId).then(owner => {
        if (owner.controlVersion !== current.controlVersion || owner.ownerVersion !== current.ownerVersion
          || owner.publicSnapshot.contextToken !== current.publicSnapshot.contextToken) throw new DurableJobError('STALE');
      })) }),
      invoke: async (input, signal) => {
        const models = createBedrockModels({ transport: { send: async (command, bounded) => {
          dispatched = true; const response = await options.transport.send(command, bounded); acknowledged = true;
          const { inputTokens, outputTokens } = response.usage ?? {};
          if ([inputTokens, outputTokens].every(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1000000)) usage = { inputTokens: inputTokens!, outputTokens: outputTokens! };
          return response;
        } }, enabled: () => !signal.aborted && !io.signal.aborted,
        diagnostic: value => { if (value.kind === 'OWNER' && value.stage.startsWith('PROVIDER_')) acknowledged = true; },
        jobs: { run: async (kind, invocation, task) => {
          if (kind !== 'OWNER') throw new DurableJobError('INVALID');
          await invocation.assertCurrent(); return task(AbortSignal.any([signal, io.signal]));
        } } });
        let interpretation: unknown;
        const ownerModel = models.owner;
        try {
          // Extraction validates the same owner-only context and interpretation, without an independent write.
          const phase = partitionIO({ timeoutMs: 27000 }); const phaseIO = { ...phase, signal: AbortSignal.any([phase.signal, io.signal, signal]) };
          const app = new KnownEnoughApplication({ repository: repositories.forParticipant(principal, phaseIO), clock: options.clock, ids: options.ids });
          const architect = new OwnerConversationArchitect({ application: app, clock: options.clock, ids: { next: () => draftId }, isEnabled: () => !signal.aborted && !io.signal.aborted, model: ownerModel });
          interpretation = (await architect.prepare(principal, { decisionId, messages: input })).draft;
        } catch (error) {
          if (!usage) { if (!dispatched || acknowledged) throw new DurableJobError('PROVIDER_REJECTED'); throw error; }
          interpretation = null;
        }
        if (!usage) throw new DurableJobError('INVALID_OUTPUT');
        return { output: interpretation, usage };
      },
      prepare: async (_ref, input, output): Promise<PublicDraftEffect> => {
        if (!output) throw new DurableJobError('INVALID_OUTPUT');
        try {
          const fence = await capture(async app => {
            const owner = await app.getOwnerSnapshot(principal, decisionId);
            if (owner.controlVersion !== current.controlVersion || owner.ownerVersion !== current.ownerVersion
              || owner.publicSnapshot.contextToken !== current.publicSnapshot.contextToken) throw new DurableJobError('STALE');
            const draft = KE.AIConstraintDraft.parse(output);
            if (draft.draftId !== draftId || draft.decisionId !== decisionId || draft.ownerParticipantId !== owner.ownerParticipantId
              || draft.ownerVersion !== owner.ownerVersion || draft.contextToken !== owner.publicSnapshot.contextToken
              || draft.semanticVersion !== owner.publicSnapshot.semanticVersion || draft.draftVersion !== (owner.draftVersion ?? 0) + 1) throw new DurableJobError('STALE');
            await app.storeConstraintDraft({ kind: 'service', subject: 'owner-conversation-interpreter', roomIds: [decisionId] }, draft,
              { principal, controlVersion: current.controlVersion, expiresAt: reference.expiresAt, isEnabled: () => !io.signal.aborted });
          });
          return { kind: 'OWNER_DRAFT', fence };
        } catch (error) { if (error instanceof OwnerConversationError) throw new DurableJobError('INVALID_OUTPUT'); throw error; }
      },
    } });
    try { await engine.enqueue(reference); await engine.process({ jobId }); } catch { /* Reconcile once, never replay dispatch. */ }
    const after = await store.read(jobId);
    if (after.job?.phase === 'SUCCEEDED') {
      const owner = await application.getOwnerSnapshot(principal, decisionId);
      if (owner.draft?.draftId === draftId) return { state: 'SAVED', draft: owner.draft };
      throw new KnownEnoughApplicationError('STALE_CONTEXT');
    }
    return disposition(after.job);
  };
}

export function createManagedPartitionOwnerRuntime(options: Omit<Parameters<typeof createPartitionOwnerRuntime>[0], 'transport' | 'store' | 'authority'>) {
  return createPartitionOwnerRuntime({ ...options, ...createManagedPublicDraftPorts(options.sourceSha) });
}
