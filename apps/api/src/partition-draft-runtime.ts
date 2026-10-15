import { createHash, randomUUID } from 'node:crypto';
import { DecisionArchitect, type ModelFailureDiagnostic } from '@deal-table/application';
import { createBedrockModels, type ConverseTransport } from '@deal-table/adapters';
import { DurableModelJobs, DurableJobError, createManagedPublicDraftPorts,
  type PublicDraftAtomicItem, type DurableJobStore, type JobReference, type JobPin, type PublicDraftCommit, type PublicDraftFence, type PublicDraftEffect } from '@deal-table/adapters/durable-model-runtime';
import { PartitionDraftFailure, type PartitionDraftArchitect } from '@deal-table/adapters/partition-request';
import type { PartitionFence, PartitionIOContext } from '@deal-table/adapters/partition-request';
import { stableDeliveryId } from './durable-enqueue.ts';
/** Public architecture only. No decision/private snapshots or caller-selected provider capabilities. */
export function createPartitionDraftRuntime(options: {
  diagnostic?: (value: { providerDispatched: boolean; providerAcknowledged: boolean; phase: string; reason: string | null; rejectionStage?: ModelFailureDiagnostic['stage'] }) => void;
  sourceSha: string; now?: () => number; transport: ConverseTransport;
  store: (commit: PublicDraftCommit) => DurableJobStore<PublicDraftFence, PublicDraftEffect>;
  authority: () => Promise<JobPin>;
  prepareGroupCommit: (mutations: PartitionFence['mutations'], context: PartitionIOContext) => Promise<PublicDraftAtomicItem[]>;
}): PartitionDraftArchitect {
  if (!/^[a-f0-9]{40}$/.test(options.sourceSha)) throw new Error('PUBLIC_DRAFT_RUNTIME_INVALID');
  return async (subject, request, io, scope) => {
    if (!scope || io.signal.aborted) throw new PartitionDraftFailure('AI_UNAVAILABLE');
    const now = options.now ?? Date.now;
    const id = stableDeliveryId(options.sourceSha, scope.groupId, request.draftId);
    const captures = new WeakMap<PublicDraftFence, PartitionFence>();
    const store = options.store(async (fence, effect) => {
      const selected = effect?.fence ?? fence; const native = captures.get(selected);
      if (!native || fence.reference.jobId !== id || selected.reference.jobId !== id) throw new DurableJobError('INVALID');
      return { items: await options.prepareGroupCommit(native.mutations, io), authority: await options.authority() };
    });
    let before;
    try { before = await store.read(id); } catch { throw new PartitionDraftFailure('AI_UNAVAILABLE'); }
    if (!before.control.enabled || before.control.sourceSha !== options.sourceSha) throw new PartitionDraftFailure('AI_UNAVAILABLE');
    if (!before.job && before.control.slots.length >= 2) throw new PartitionDraftFailure('AI_AT_CAPACITY');
    let ref: JobReference = before.job?.reference ?? { jobId: id, kind: 'ARCHITECT', subject,
      decisionId: scope.groupId, reasoningJobId: request.draftId, authorityHash: scope.bodyHash,
      sourceSha: options.sourceSha, expiresAt: now() + 300000, requestKey: scope.requestKey };
    if (ref.kind !== 'ARCHITECT' || ref.subject !== subject || ref.decisionId !== scope.groupId
      || ref.reasoningJobId !== request.draftId || ref.authorityHash !== scope.bodyHash || ref.requestKey !== scope.requestKey || ref.sourceSha !== options.sourceSha) throw new PartitionDraftFailure('REQUEST_UNKNOWN');
    let usage: { inputTokens: number; outputTokens: number } | null = null; let providerFailed = false; let providerAcknowledged = false; let providerDispatched = false; let rejectionStage: ModelFailureDiagnostic['stage'] | undefined;
    const capture = async (output?: unknown): Promise<PublicDraftFence> => {
      const native = await scope.fence(output); const fence: PublicDraftFence = { kind: 'PUBLIC_DRAFT', reference: structuredClone(ref) };
      captures.set(fence, native); return fence;
    };
    const engine = new DurableModelJobs({ kind: 'ARCHITECT', store, now, bounds: { leaseMs: 25000, timeoutMs: 18000 },
      execution: {
        reload: async reference => {
          if (reference.kind !== 'ARCHITECT' || reference.subject !== subject || reference.decisionId !== scope.groupId
            || reference.reasoningJobId !== request.draftId || reference.authorityHash !== scope.bodyHash || reference.requestKey !== scope.requestKey || reference.sourceSha !== options.sourceSha) throw new DurableJobError('STALE');
          ref = structuredClone(reference); return { context: structuredClone(request), fence: await capture() };
        },
        invoke: async (input, signal) => {
          const models = createBedrockModels({ transport: { send: async (command, options_) => {
              providerDispatched = true; const response = await options.transport.send(command, options_); providerAcknowledged = true;
              const inputTokens = response.usage?.inputTokens, outputTokens = response.usage?.outputTokens;
              if (typeof inputTokens === 'number' && typeof outputTokens === 'number' && [inputTokens, outputTokens].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000)) usage = { inputTokens, outputTokens };
              return response;
            } }, enabled: () => !signal.aborted && !io.signal.aborted,
            diagnostic: value => { if (value.kind === 'ARCHITECT') rejectionStage = value.stage; if (value.kind === 'ARCHITECT' && value.stage.startsWith('PROVIDER')) { providerFailed = true; if (value.stage !== 'PROVIDER') providerAcknowledged = true; } },
            usage: value => { if (value.kind !== 'ARCHITECT') throw new DurableJobError('INVALID_OUTPUT'); usage = { inputTokens: value.inputTokens, outputTokens: value.outputTokens }; },
            jobs: { run: async (kind, invocation, task) => {
              if (kind !== 'ARCHITECT' || io.signal.aborted) throw new DurableJobError('DISABLED');
              await invocation.assertCurrent(); await (await scope.fence()).assertCurrent();
              const result = await task(AbortSignal.any([signal, io.signal]));
              await invocation.assertCurrent(); return result;
            } } });
          const architect = new DecisionArchitect(models.architect, randomUUID, now, () => !signal.aborted && !io.signal.aborted, value => { rejectionStage = value.stage; });
          let output: unknown;
          try { output = await architect.draft(subject, input); }
          catch (error) { if (!usage) { if (!providerDispatched || providerAcknowledged) throw new DurableJobError('PROVIDER_REJECTED'); throw error; } output = null; } // Acknowledged invalid output is quiescent; usage stays charged.
          if (!usage) throw new DurableJobError(providerAcknowledged ? 'PROVIDER_REJECTED' : 'INVALID_OUTPUT');
          return { output, usage };
        },
        prepare: async (_reference, _input, output) => {
          try { return { kind: 'PUBLIC_DRAFT', fence: await capture(output) }; }
          catch (error) { if (error instanceof Error && (error.message === 'SESSION_INVALID' || error.message === 'INVALID_MODEL_OUTPUT')) throw new DurableJobError('INVALID_OUTPUT'); throw error; }
        },
      } });
    try { await engine.enqueue(ref); await engine.process({ jobId: id }); }
    catch { /* Read the single durable outcome; never repeat an ambiguous provider dispatch. */ }
    const after = await store.read(id);
    if (after.job?.phase !== 'SUCCEEDED') { try { options.diagnostic?.({ providerDispatched, providerAcknowledged, phase: after.job?.phase ?? 'MISSING', reason: after.job?.reason ?? null, ...(rejectionStage ? { rejectionStage } : {}) }); } catch { /* Diagnostics cannot change dispatch or disposition. */ } }
    if (after.job?.phase === 'SUCCEEDED') return undefined; // The same atomic transaction saved the strictly checked native draft.
    if (after.job?.phase === 'DEAD') throw new PartitionDraftFailure(after.job.reason === 'INVALID_OUTPUT' ? 'INVALID_MODEL_OUTPUT'
      : after.job.reason === 'PROVIDER_UNCONFIRMED' ? providerFailed ? 'PROVIDER_FAILED' : 'REQUEST_UNKNOWN' : providerFailed && providerAcknowledged ? 'PROVIDER_FAILED' : 'AI_UNAVAILABLE');
    throw new PartitionDraftFailure('REQUEST_PENDING');
  };
}
export function createManagedPartitionDraftRuntime(options: {
  sourceSha: string; prepareGroupCommit: Parameters<typeof createPartitionDraftRuntime>[0]['prepareGroupCommit'];
}): PartitionDraftArchitect {
  return createPartitionDraftRuntime({ ...options, ...createManagedPublicDraftPorts(options.sourceSha), diagnostic: value => console.warn(JSON.stringify({ event: 'FIX01_PUBLIC_DRAFT_FAILURE', ...value })) });
}
/** Same identity-bound key on reload, independent of a browser's raw objective or model output. */
export function publicDraftId(groupId: string, subject: string, key: string) {
  return 'draft-' + createHash('sha256').update(JSON.stringify([groupId, subject, key])).digest('hex').slice(0, 40);
}
