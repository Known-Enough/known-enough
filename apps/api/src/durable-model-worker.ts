import { modelJobAuthorityHash, DurableModelJobs, DurableJobError, type JobReference, type DurableExecution, type DurableJobStore } from '@deal-table/adapters/durable-model-runtime';
import { checkedJobFence, type JobFence, type JobEffect } from '@deal-table/adapters/durable-model-runtime';
import type { TrustedPrincipal } from '@deal-table/application';

type ReconciliationVerifier = (reference: JobReference, evidence: unknown) => Promise<{ providerStopped: true; proofHash: string; usage: { inputTokens: number; outputTokens: number } | null }>;
export interface CurrentJobAuthority<Context> {
  principal: TrustedPrincipal | null; admissionEnabled: boolean; consentCurrent: boolean;
  retainedUntil: number; enabled: boolean; sourceSha: string;
  controlVersion: number; epoch: number; contextToken: string; semanticVersion: number; consentRevision: number;
  context: Context; fence: JobFence;
}
/** Opaque reference hash binds versions, never grants authority by itself. No public/HTTP job constructor. */
export { modelJobAuthorityHash };
/** Inactive composition; verified server session/application/kernel ports are supplied at installation. */
export function createDurableModelWorker<Context>(options: { now: () => number; store: DurableJobStore<JobFence, JobEffect>;
  reload: (reference: JobReference) => Promise<CurrentJobAuthority<Context>>;
  reconcile?: ReconciliationVerifier; bounds?: Partial<{ leaseMs: number; timeoutMs: number; maxTokens: number; maxCostMicros: number }>; invoke: DurableExecution<Context, JobFence, JobEffect>['invoke']; cancel?: NonNullable<DurableExecution<Context, JobFence, JobEffect>['cancel']>; prepare: DurableExecution<Context, JobFence, JobEffect>['prepare'] }) {
  return new DurableModelJobs({ store: options.store, now: options.now, ...(options.reconcile ? { reconcile: options.reconcile } : {}), ...(options.bounds ? { bounds: options.bounds } : {}), execution: {
    async reload(reference) {
      const value = await options.reload(structuredClone(reference));
      if (value.principal?.kind !== 'participant' || value.principal.subject !== reference.subject
        || !value.admissionEnabled || !value.consentCurrent || !value.enabled || !Number.isSafeInteger(value.retainedUntil)
        || value.retainedUntil <= options.now() || value.sourceSha !== reference.sourceSha
        || modelJobAuthorityHash(value) !== reference.authorityHash) throw new DurableJobError('STALE');
      const fence = checkedJobFence(value.fence);
      if (JSON.stringify(fence.reference) !== JSON.stringify(reference)) throw new DurableJobError('STALE');
      return { context: value.context, fence };
    }, invoke: options.invoke, prepare: options.prepare, ...(options.cancel ? { cancel: options.cancel } : {}),
  } });
}

import { randomUUID } from 'node:crypto';
import { KnownEnoughApplication, type KnownEnoughRecord, type KnownEnoughRepository, type DecisionNegotiationContext, type DecisionNegotiationModel } from '@deal-table/application';
import { KnownEnough as KE, Groups } from '@deal-table/contracts';
import { decodeDecisionStateItem, encodeDecisionStateItem, validateDecisionStateGuard } from '@deal-table/adapters/durable-model-runtime';
import { JOB_TARGET } from '@deal-table/adapters/durable-model-runtime';
import { RetentionPolicy, RetentionStamp, retentionDeadline } from '@deal-table/adapters/durable-model-runtime';
interface NegotiationContext { record: KnownEnoughRecord; context: DecisionNegotiationContext }
function localApplication(record: KnownEnoughRecord, now: () => number) {
  let current = structuredClone(record);
  const repository: KnownEnoughRepository = {
    async createDecision() { throw new DurableJobError('INVALID'); },
    async transactionDecision<T>(decisionId: string, work: (decision: KnownEnoughRecord | null) => T | Promise<T>): Promise<T> {
      if (decisionId !== current.decisionId) throw new DurableJobError('STALE');
      const next = structuredClone(current); const result = await work(next); current = next; return result;
    },
  };
  return { application: new KnownEnoughApplication({ repository, clock: { now: () => new Date(now()).toISOString() }, ids: { next: randomUUID } }), result: () => current };
}
/** Reconstructs structured negotiation input and runs the real application/kernel in a transient sandbox.
 * Only its checked STATE bytes are returned to the joined durable/Dynamo output transaction. */
export function createDurableNegotiationWorker(options: { now: () => number; store: DurableJobStore<JobFence, JobEffect>;
  reconcile?: ReconciliationVerifier; bounds?: Partial<{ leaseMs: number; timeoutMs: number; maxTokens: number; maxCostMicros: number }>;
  load: (reference: JobReference) => Promise<{ principal: TrustedPrincipal | null; fence: JobFence; enabled: boolean }>;
  model: (input: Parameters<DecisionNegotiationModel>[0]) => Promise<{ output: unknown; usage: { inputTokens: number; outputTokens: number } }>; publicCandidates: (frame: KE.PublicDecisionFrame) => readonly KE.CandidateProposal['values'][];
}) {
  return createDurableModelWorker<NegotiationContext>({ now: options.now, store: options.store, ...(options.reconcile ? { reconcile: options.reconcile } : {}), ...(options.bounds ? { bounds: options.bounds } : {}),
    async reload(reference) {
      const loaded = await options.load(reference); const fence = checkedJobFence(loaded.fence);
      const state = fence.pins.find(pin => pin.table === JOB_TARGET.decisions)!;
      let record: KnownEnoughRecord;
      try { const wire = JSON.parse(state.payload); record = { ...decodeDecisionStateItem({ PK: { S: state.key.PK }, SK: { S: state.key.SK },
        payload: { S: state.payload }, schemaVersion: { N: String(wire.schemaVersion) } }, reference.decisionId), replays: [] }; validateDecisionStateGuard(record, fence.guard); }
      catch { throw new DurableJobError('STALE'); }
      if (!record.job || record.job.id !== reference.reasoningJobId || record.job.epoch !== record.solveEpoch
        || record.job.contextToken !== record.definition.contextToken || record.job.semanticVersion !== record.definition.semanticVersion
        || record.status !== 'REASONING') throw new DurableJobError('STALE');
      const required = record.definition.requiredParticipantIds;
      const consentCurrent = required.every(id => record.frameConfirmations.some(value => value.participantId === id
        && value.contextToken === record.definition.contextToken && value.semanticVersion === record.definition.semanticVersion && value.frameVersion === record.definition.frameVersion)
        && record.owners.some(owner => owner.participantId === id && owner.readiness === 'READY'));
      const members = record.memberships.filter(member => member.active);
      const admissionEnabled = members.every(member => {
        const pin = fence.pins.find(pin => pin.table === JOB_TARGET.partitions && pin.key.PK === `ACCOUNT#${member.subject}` && pin.key.SK === 'STATE');
        if (!pin) return false;
        try { const value = JSON.parse(pin.payload); return value.kind === 'ACCOUNT' && Groups.Account.parse(value.value).status === 'APPROVED'
          && value.value.subject === member.subject; } catch { return false; }
      });
      const policyPin = fence.pins.find(pin => pin.table === JOB_TARGET.journal && pin.key.PK === 'OPERATIONS#RETENTION')!;
      let retainedUntil: number; try { const policy = RetentionPolicy.parse(JSON.parse(policyPin.payload));
        retainedUntil = Math.min(...members.map(member => { const stampPin = fence.pins.find(pin => pin.table === JOB_TARGET.journal && pin.key.PK === `RETENTION#${member.subject}` && pin.key.SK === 'STAMP');
          if (!stampPin) throw new DurableJobError('STALE'); const stamp = RetentionStamp.parse(JSON.parse(stampPin.payload));
          if (Date.parse(stamp.lastActivityAt) > options.now()) throw new DurableJobError('STALE'); return retentionDeadline(policy, stamp); })); }
      catch { throw new DurableJobError('STALE'); }
      const app = localApplication(record, options.now).application;
      await app.getOwnerSnapshot(loaded.principal, reference.decisionId);
      const context = await app.getReasoningContext({ kind: 'service', subject: 'durable-negotiator', roomIds: [reference.decisionId] }, reference.decisionId, reference.reasoningJobId);
      return { principal: loaded.principal, admissionEnabled, consentCurrent, retainedUntil, enabled: loaded.enabled,
        sourceSha: reference.sourceSha, controlVersion: record.controlVersion, epoch: record.solveEpoch,
        contextToken: record.definition.contextToken, semanticVersion: record.definition.semanticVersion, consentRevision: record.controlVersion,
        context: { record, context }, fence };
    },
    async invoke(value, signal) {
      const catalog = options.publicCandidates(structuredClone(value.context.publicSnapshot.frame));
      if (!catalog.length || catalog.length > 64 || Buffer.byteLength(JSON.stringify(catalog)) > 256 * 1024) throw new DurableJobError('INVALID');
      const publicIds = new Set(value.context.publicSnapshot.frame.variables.filter(v => v.visibility === 'PUBLIC').map(v => v.id));
      const values = catalog.map(item => KE.PublicProposalFacts.shape.values.parse(item));
      if (values.some(items => items.some(item => !publicIds.has(item.variableId)))) throw new DurableJobError('INVALID');
      const result = await options.model({ context: value.context, publicCandidates: values, attempt: 1, retryReason: null, signal,
        invocation: { expiresAt: options.now() + (options.bounds?.timeoutMs ?? 8000), signal, assertCurrent: async () => { if (signal.aborted) throw new DurableJobError('STALE'); } } });
      return result;
    },
    async cancel(reference, value) {
      const transient = localApplication(value.record, options.now);
      const result = await transient.application.cancelReasoning({ kind: 'service', subject: 'durable-negotiator', roomIds: [reference.decisionId] }, reference.decisionId, reference.reasoningJobId);
      if (result !== 'CANCELLED') throw new DurableJobError('STALE');
      return { writes: [{ key: { PK: `ROOM#${reference.decisionId}`, SK: 'STATE' }, payload: encodeDecisionStateItem(transient.result()).payload!.S! }] };
    },
    async prepare(reference, value, output) {
      const data = output as { values?: unknown; permissionDependencies?: unknown; questionIntents?: unknown };
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(k => !['values', 'permissionDependencies', 'questionIntents', 'explanationDraft'].includes(k))
        || !Array.isArray(data.questionIntents)) throw new DurableJobError('INVALID_OUTPUT');
      const candidate = KE.CandidateProposal.safeParse({ schemaVersion: KE.KE_SCHEMA_VERSION, proposalId: randomUUID(), decisionId: reference.decisionId,
        semanticVersion: value.context.job.semanticVersion, contextToken: value.context.job.contextToken, proposalVersion: value.context.proposalVersion,
        values: data.values, permissionDependencies: data.permissionDependencies, createdAt: new Date(options.now()).toISOString(),
        validation: { status: 'VALID', checkedRuleIds: [], failedRuleIds: [], unknownRuleIds: [], unsupportedConditionIds: [] } });
      if (!candidate.success || !options.publicCandidates(value.context.publicSnapshot.frame).some(values => KE.serializeDecisionProposal({ schemaVersion: KE.KE_SCHEMA_VERSION,
        decisionId: reference.decisionId, contextToken: value.context.job.contextToken, semanticVersion: value.context.job.semanticVersion,
        proposalVersion: value.context.proposalVersion, requiredParticipantIds: value.context.definition.requiredParticipantIds, values })
        === KE.serializeDecisionProposal({ schemaVersion: KE.KE_SCHEMA_VERSION, decisionId: reference.decisionId, contextToken: value.context.job.contextToken,
          semanticVersion: value.context.job.semanticVersion, proposalVersion: value.context.proposalVersion, requiredParticipantIds: value.context.definition.requiredParticipantIds, values: candidate.data.values }))) throw new DurableJobError('INVALID_OUTPUT');
      const transient = localApplication(value.record, options.now), service: TrustedPrincipal = { kind: 'service', subject: 'durable-negotiator', roomIds: [reference.decisionId] };
      const outcome = await transient.application.completeReasoning(service, reference.decisionId, reference.reasoningJobId, candidate.data,
        { principal: { kind: 'participant', subject: reference.subject }, controlVersion: value.context.controlVersion, expiresAt: reference.expiresAt });
      if (outcome === 'STALE' || outcome === 'INVALID' || outcome === 'NEEDS_CLARIFICATION') throw new DurableJobError('INVALID_OUTPUT');
      // Preserve the existing consent workflow. An atomic pending proposal is useful only with exact valid questions.
      if (outcome === 'NEEDS_PERMISSION') {
        const targets = await transient.application.getPendingNegotiationFailures(service, reference.decisionId);
        if (!targets.length || data.questionIntents.length > 64) throw new DurableJobError('INVALID_OUTPUT');
        let version = value.context.controlVersion + 1; const seen = new Set<string>();
        for (const raw of data.questionIntents) {
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new DurableJobError('INVALID_OUTPUT');
          const intent = raw as { ownerParticipantId: string; constraintId: string; constraintVersion: number; adjustment: KE.ValidationRule };
          if (Object.keys(intent).sort().join() !== ['ownerParticipantId', 'constraintId', 'constraintVersion', 'adjustment'].sort().join()
            || !targets.some(t => t.ownerParticipantId === intent.ownerParticipantId && t.constraintId === intent.constraintId && t.constraintVersion === intent.constraintVersion)) throw new DurableJobError('INVALID_OUTPUT');
          const identity = `${intent.ownerParticipantId}/${intent.constraintId}/${intent.constraintVersion}`;
          if (seen.has(identity)) throw new DurableJobError('INVALID_OUTPUT'); seen.add(identity);
          if (!await transient.application.validatePendingNegotiationAdjustment(service, { decisionId: reference.decisionId, contextToken: value.context.job.contextToken,
            semanticVersion: value.context.job.semanticVersion, ownerParticipantId: intent.ownerParticipantId, constraintId: intent.constraintId,
            constraintVersion: intent.constraintVersion, adjustment: intent.adjustment, expiresAt: new Date(options.now() + 600_000).toISOString() })) throw new DurableJobError('INVALID_OUTPUT');
          const question = await transient.application.askNegotiation(service, { decisionId: reference.decisionId, contextToken: value.context.job.contextToken,
            semanticVersion: value.context.job.semanticVersion, participantId: intent.ownerParticipantId, pendingProposalId: candidate.data.proposalId,
            constraintId: intent.constraintId, constraintVersion: intent.constraintVersion, adjustment: intent.adjustment,
            expiresAt: new Date(options.now() + 600_000).toISOString(), runtimeGuard: { expiresAt: reference.expiresAt, expectedControlVersion: version } });
          if (!question) throw new DurableJobError('INVALID_OUTPUT'); version++;
        }
        if (data.questionIntents.length !== targets.length) throw new DurableJobError('INVALID_OUTPUT');
      } else if (data.questionIntents.length) throw new DurableJobError('INVALID_OUTPUT');
      return { writes: [{ key: { PK: `ROOM#${reference.decisionId}`, SK: 'STATE' }, payload: encodeDecisionStateItem(transient.result()).payload!.S! }] };
    },
  });
}

import { createDynamoModelJobStore, createDynamoModelJobLoader, createDurableBedrockNegotiation } from '@deal-table/adapters/durable-model-runtime';
/** Complete inactive managed composition; construction performs no network operation or runtime selection. */
export function createManagedDurableNegotiationWorker(options: { verifiedTarget: { account: string; region: string }; sourceSha: string;
  approval: { paidCallsApproved: boolean; invocationLoggingDisabled: boolean; retentionReviewed: boolean };
  publicCandidates: (frame: KE.PublicDecisionFrame) => readonly KE.CandidateProposal['values'][]; reconcile?: ReconciliationVerifier; now?: () => number }) {
  const store = createDynamoModelJobStore(options), load = createDynamoModelJobLoader(options);
  const model = createDurableBedrockNegotiation({ approval: options.approval, enabled: () => true });
  const worker = createDurableNegotiationWorker({ store, load, model, ...(options.reconcile ? { reconcile: options.reconcile } : {}), publicCandidates: options.publicCandidates, now: options.now ?? Date.now });
  return {
    enqueue(principal: TrustedPrincipal | null, reference: JobReference) {
      if (principal?.kind !== 'participant' || principal.subject !== reference.subject) throw new DurableJobError('STALE');
      return worker.enqueue(reference);
    }, reconcile: (delivery: unknown, evidence: unknown) => worker.reconcile(delivery, evidence), process: (delivery: unknown) => worker.process(delivery), deliveries: () => worker.deliveries(),
  };
}
