import { createHash } from 'node:crypto';
import type { KnownEnoughRecord, TrustedPrincipal } from '@deal-table/application';
import { KnownEnoughApplicationError } from '@deal-table/application';
import { DeliverySchema, JobReferenceSchema, modelJobAuthorityHash, type JobReference, type JobSnapshot } from '@deal-table/adapters/durable-model-runtime';
import type { KnownEnough as KE } from '@deal-table/contracts';
export interface NegotiationExpected { contextToken: string; semanticVersion: number; controlVersion: number }
type CurrentRecord = Pick<KnownEnoughRecord, 'status' | 'job' | 'definition' | 'controlVersion' | 'solveEpoch'>;
export interface DurableEnqueueRequest {
  principal: TrustedPrincipal; decisionId: string; expected: NegotiationExpected; signal: AbortSignal;
  /** These closures are built by the authenticated server handler, never deserialized from HTTP. */
  authorize(): Promise<void>; read(): Promise<CurrentRecord | null>; begin(): Promise<NonNullable<KnownEnoughRecord['job']>>;
}
export function stableDeliveryId(sourceSha: string, decisionId: string, reasoningJobId: string): string {
  const bytes = createHash('sha256').update(JSON.stringify([sourceSha, decisionId, reasoningJobId])).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const fail = (code: Extract<KE.DecisionCommandResult, { ok: false }>['error']['code']): never => { throw new KnownEnoughApplicationError(code); };
/** Server-owned queue bridge. It cannot configure authority or invoke AI. */
export function createDurableEnqueue(options: {
  sourceSha: string; now: () => number; assertRetained(principal: TrustedPrincipal): Promise<unknown>;
  readJob(jobId: string): Promise<JobSnapshot>;
  enqueue(principal: TrustedPrincipal, reference: JobReference): Promise<{ jobId: string }>;
}) {
  if (!/^[a-f0-9]{40}$/.test(options.sourceSha) || /^0+$/.test(options.sourceSha)) throw new Error('DURABLE_ENQUEUE_INVALID');
  const sourceSha = options.sourceSha; const now = options.now; const retained = options.assertRetained;
  const readJob = options.readJob; const enqueue = options.enqueue;
  return async (request: DurableEnqueueRequest) => {
    if (request.principal.kind !== 'participant') return fail('FORBIDDEN');
    const principal = structuredClone(request.principal); const decisionId = request.decisionId;
    const expected = structuredClone(request.expected); const live = () => { if (request.signal.aborted) return fail('RETRYABLE_SERVER_ERROR'); };
    live(); await request.authorize(); live(); await retained(principal); live();
    let record = await request.read(); live();
    if (!record || record.definition.decisionId !== decisionId) return fail('NOT_FOUND');
    const contextMatches = (value: CurrentRecord) => value.definition.contextToken === expected.contextToken
      && value.definition.semanticVersion === expected.semanticVersion;
    if (!contextMatches(record)) return fail('STALE_CONTEXT');
    // Control inspection happens before creating a kernel job, preventing disabled queues from stranding requests.
    const preflight = await readJob(stableDeliveryId(sourceSha, decisionId, 'preflight')); live();
    if (!preflight.control.enabled || preflight.control.sourceSha !== sourceSha) return fail('RETRYABLE_SERVER_ERROR');
    if (!record.job) {
      if (record.controlVersion !== expected.controlVersion) return fail('STALE_CONTEXT');
      try { await request.begin(); }
      catch (error) {
        // A racing request or lost begin acknowledgement is resolved by reading the current exact kernel job.
        record = await request.read();
        if (!record?.job || record.status !== 'REASONING' || !contextMatches(record)
          || record.controlVersion !== expected.controlVersion + 1) throw error;
      }
      record = await request.read(); live();
    }
    if (!record?.job || record.status !== 'REASONING' || !contextMatches(record)
      || record.controlVersion !== expected.controlVersion + 1 || record.job.epoch !== record.solveEpoch
      || record.job.contextToken !== expected.contextToken || record.job.semanticVersion !== expected.semanticVersion) return fail('STALE_CONTEXT');
    const jobId = stableDeliveryId(sourceSha, decisionId, record.job.id);
    const before = await readJob(jobId); live();
    const hash = modelJobAuthorityHash({ controlVersion: record.controlVersion, epoch: record.solveEpoch,
      contextToken: record.definition.contextToken, semanticVersion: record.definition.semanticVersion, consentRevision: record.controlVersion });
    const matches = (reference: JobReference) => reference.jobId === jobId && reference.kind === 'NEGOTIATION'
      && reference.decisionId === decisionId && reference.reasoningJobId === record!.job!.id
      && reference.sourceSha === sourceSha && reference.authorityHash === hash;
    const receipt = (snapshot: JobSnapshot) => {
      if (!snapshot.job || !matches(snapshot.job.reference) || !['READY', 'LEASED', 'CALLING', 'SUCCEEDED'].includes(snapshot.job.phase)
        || snapshot.job.reference.expiresAt <= now()) return fail('STALE_CONTEXT');
      return { jobId, state: 'QUEUED' as const, expiresAt: new Date(snapshot.job.reference.expiresAt).toISOString() };
    };
    if (before.job) return receipt(before);
    const time = now(); if (!Number.isSafeInteger(time) || time < 0 || time > Number.MAX_SAFE_INTEGER - 300000) return fail('RETRYABLE_SERVER_ERROR');
    const reference = JobReferenceSchema.parse({ jobId, kind: 'NEGOTIATION', subject: principal.subject,
      decisionId, reasoningJobId: record.job.id, sourceSha, authorityHash: hash, expiresAt: time + 300000 });
    try { const result = await enqueue(principal, reference); if (result.jobId !== jobId) return fail('RETRYABLE_SERVER_ERROR'); }
    catch {
      // Never repeat an ambiguous enqueue. A matching durable reference is the only successful reconciliation.
      try { const observed = await readJob(jobId); if (observed.job) return receipt(observed); } catch { /* remains unknown */ }
      return fail('RETRYABLE_SERVER_ERROR');
    }
    live();
    return receipt(await readJob(jobId));
  };
}

import { createDynamoModelJobStore, createDynamoModelJobLoader } from '@deal-table/adapters/durable-model-runtime';
import { genericCandidates } from '@deal-table/adapters';
import { createDurableNegotiationWorker } from './durable-model-worker.ts';
/** Native request binding deliberately supplies no working provider and exposes no delivery processor. */
export function createManagedDurableEnqueue(options: {
  sourceSha: string; assertRetained(principal: TrustedPrincipal): Promise<unknown>; now?: () => number;
}) {
  const now = options.now ?? Date.now; const sourceSha = options.sourceSha;
  const target = { account: '092954139775', region: 'us-east-1' };
  // The 64-request store bound belongs to one HTTP request, not a warm Lambda.
  return async (request: DurableEnqueueRequest) => {
    const store = createDynamoModelJobStore({ verifiedTarget: target, sourceSha });
    const worker = createDurableNegotiationWorker({ now, store, bounds: { leaseMs: 30_000 },
      reportFailure: value => console.warn('model-job-inline-failure', value),
      reportInvalidOutput: stage => console.warn('model-job-inline-output-invalid', stage), load: createDynamoModelJobLoader({ verifiedTarget: target, sourceSha }),
      publicCandidates: genericCandidates, model: async () => { throw new Error('PROVIDER_NOT_AVAILABLE_IN_REQUEST_HANDLER'); } });
    const enqueue = createDurableEnqueue({ sourceSha, now, assertRetained: options.assertRetained,
      readJob: jobId => store.read(DeliverySchema.parse({ jobId }).jobId),
      enqueue: async (principal, reference) => {
        if (principal.kind !== 'participant' || principal.subject !== reference.subject) return fail('FORBIDDEN');
        const result = await worker.enqueue(reference);
        // The accepted-job receipt remains valid if a proven no-match finishes
        // before the HTTP acknowledgement; the next owner read carries the result.
        try { if (await worker.finishNoMatch(reference)) console.info('model-job-inline-no-match', 'APPLIED'); }
        catch { console.warn('model-job-inline-no-match', 'DEFERRED'); /* Preserve the exact queued job. */ }
        return result;
      } });
    return enqueue(request);
  };
}
