import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().uuid();
export const DeliverySchema = z.strictObject({ jobId: uuid });
// Inputs/outputs/closures never enter a persisted record. Only reconstructable server operations qualify.
export const JobReferenceSchema = z.strictObject({ jobId: uuid, kind: z.literal('NEGOTIATION'),
  subject: id, decisionId: id, reasoningJobId: id, authorityHash: hash,
  sourceSha: z.string().regex(/^[a-f0-9]{40}$/), expiresAt: integer });
const lease = z.strictObject({ token: uuid, until: integer });
const usage = z.strictObject({ inputTokens: integer, outputTokens: integer });
export const JobSchema = z.strictObject({ schemaVersion: z.literal(1), revision: integer.min(1),
  reference: JobReferenceSchema, phase: z.enum(['READY', 'LEASED', 'CALLING', 'SUCCEEDED', 'DEAD']),
  lease: lease.nullable(), attempts: integer.max(2), failures: integer.max(3), availableAt: integer,
  reservedTokens: integer, reservedCostMicros: integer, usage: usage.nullable(), recoveryProofHash: hash.nullable(),
  reason: z.enum(['EXPIRED', 'STALE', 'RETRY_LIMIT', 'PROVIDER_UNCONFIRMED', 'INVALID_OUTPUT', 'BUDGET', 'DISABLED']).nullable(),
});
export type JobReference = z.infer<typeof JobReferenceSchema>;
export type DurableJob = z.infer<typeof JobSchema>;
export const TotalsSchema = z.strictObject({ runs: integer, reservedTokens: integer, reservedCostMicros: integer, messages: integer });
export const ControlSchema = z.strictObject({ schemaVersion: z.literal(1), revision: integer.min(1),
  enabled: z.boolean(), sourceSha: JobReferenceSchema.shape.sourceSha,
  active: z.array(uuid).max(64), slots: z.array(z.strictObject({ jobId: uuid, token: uuid, until: integer })).max(2),
}).refine(value => new Set(value.active).size === value.active.length
  && new Set(value.slots.map(slot => slot.jobId)).size === value.slots.length
  && value.slots.every(slot => value.active.includes(slot.jobId)));
export type JobControl = z.infer<typeof ControlSchema>;
export interface JobSnapshot { job: DurableJob | null; control: JobControl; totals: z.infer<typeof TotalsSchema> }
/** Atomic job/control/TOTAL CAS, joined current authority conditions and output effects. */
export interface DurableJobStore<Fence, Effect> {
  read(jobId: string): Promise<JobSnapshot>;
  commit(prior: JobSnapshot, next: JobSnapshot, fence?: Fence, effect?: Effect): Promise<boolean>;
  deliveries(): Promise<{ jobId: string }[]>;
}
export class DurableJobError extends Error {
  constructor(readonly code: 'INVALID' | 'CONFLICT' | 'CAPACITY' | 'STALE' | 'DISABLED' | 'BUDGET' | 'RETRYABLE' | 'INVALID_OUTPUT') {
    super(`MODEL_JOB_${code}`); this.name = 'DurableJobError';
  }
}
const fail = (code: DurableJobError['code']): never => { throw new DurableJobError(code); };
function safeSum(a: number, b: number) { const value = a + b; if (!Number.isSafeInteger(value) || value > Number.MAX_SAFE_INTEGER - 1) fail('BUDGET'); return value; }
function checked(value: JobSnapshot): JobSnapshot {
  const control = ControlSchema.safeParse(value.control), totals = TotalsSchema.safeParse(value.totals), job = value.job === null ? null : JobSchema.safeParse(value.job);
  if (!control.success || !totals.success || (job && !job.success)) return fail('INVALID');
  const result = { control: control.data, totals: totals.data, job: job?.success ? job.data : null };
  if (result.job) {
    const j = result.job, terminal = ['SUCCEEDED', 'DEAD'].includes(j.phase);
    if (j.reference.sourceSha !== result.control.sourceSha || (terminal && j.reason !== 'PROVIDER_UNCONFIRMED') === result.control.active.includes(j.reference.jobId)
      || (['LEASED', 'CALLING'].includes(j.phase) !== Boolean(j.lease))
      || (j.phase === 'CALLING' && (j.attempts === 0 || j.reservedTokens === 0))
      || (j.phase === 'DEAD' ? j.reason === null : j.reason !== null)) return fail('INVALID');
  }
  return value;
}
export interface PreparedCall<Context, Fence> { context: Context; fence: Fence }
export interface DurableExecution<Context, Fence, Effect> {
  /** Fresh verified subject/admission/retention/consent/semantic/activation checks; no cached identity. */
  reload(reference: JobReference): Promise<PreparedCall<Context, Fence>>;
  invoke(context: Context, signal: AbortSignal): Promise<{ output: unknown; usage: z.infer<typeof usage> }>;
  /** Kernel validation only, returns conditional writes; no independent output transaction. */
  prepare(reference: JobReference, context: Context, output: unknown): Promise<Effect>;
  /** Optional current-state kernel cancellation; never used for uncertain provider calls. */
  cancel?(reference: JobReference, context: Context): Promise<Effect>;
}
/** Explicit server-only inactive worker, independent of the installed transient closure runner. */
export class DurableModelJobs<Context, Fence, Effect> {
  private readonly bounds: { leaseMs: number; timeoutMs: number; maxTokens: number; maxCostMicros: number };
  constructor(private readonly options: { store: DurableJobStore<Fence, Effect>; now: () => number;
    reconcile?: (reference: JobReference, evidence: unknown) => Promise<{ providerStopped: true; proofHash: string; usage: z.infer<typeof usage> | null }>;
    execution: DurableExecution<Context, Fence, Effect>; bounds?: Partial<DurableModelJobs<Context, Fence, Effect>['bounds']> }) {
    this.bounds = { leaseMs: 10_000, timeoutMs: 8_000, maxTokens: 18_432, maxCostMicros: 10_000, ...options.bounds };
    const b = this.bounds;
    if (!Object.values(b).every(Number.isSafeInteger) || b.timeoutMs < 100 || b.timeoutMs > 30_000
      || b.leaseMs <= b.timeoutMs || b.leaseMs > 60_000 || b.maxTokens < 1 || b.maxTokens > 100_000
      || b.maxCostMicros < 1 || b.maxCostMicros > 1_000_000) fail('INVALID');
  }
  private now() { const time = this.options.now(); if (!integer.safeParse(time).success) fail('INVALID'); return time; }
  private async bounded<T>(work: () => Promise<T>, deadline: number): Promise<T> {
    const remaining = Math.min(this.bounds.leaseMs, deadline - this.now()); if (remaining <= 0) return fail('STALE');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([work(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new DurableJobError('STALE')), remaining);
    })]); } finally { if (timer) clearTimeout(timer); }
  }
  private async read(id: string) { return checked(await this.options.store.read(id)); }
  private async save(prior: JobSnapshot, next: JobSnapshot, fence?: Fence, effect?: Effect) {
    next.control.revision = safeSum(prior.control.revision, 1);
    if (next.job) next.job.revision = safeSum(prior.job?.revision ?? 0, 1);
    checked(next);
    if (!await this.options.store.commit(prior, next, fence, effect)) fail('CONFLICT');
  }
  async enqueue(raw: JobReference): Promise<{ jobId: string }> {
    const parsed = JobReferenceSchema.safeParse(raw); if (!parsed.success) return fail('INVALID'); const ref = parsed.data;
    const prior = await this.read(ref.jobId);
    if (prior.job) { if (!isDeepStrictEqual(prior.job.reference, ref)) fail('INVALID'); return { jobId: ref.jobId }; }
    if (!prior.control.enabled || ref.sourceSha !== prior.control.sourceSha) fail('DISABLED');
    const now = this.now(); if (ref.expiresAt <= now || ref.expiresAt - now > 300_000) fail('STALE');
    if (prior.control.active.length >= 64) fail('CAPACITY');
    await this.bounded(() => this.options.execution.reload(ref), ref.expiresAt);
    const next = structuredClone(prior); next.control.active.push(ref.jobId);
    next.job = { schemaVersion: 1, revision: 1, reference: ref, phase: 'READY', lease: null,
      attempts: 0, failures: 0, availableAt: now, reservedTokens: 0, reservedCostMicros: 0, usage: null, reason: null, recoveryProofHash: null };
    await this.save(prior, next); return { jobId: ref.jobId };
  }
  deliveries() { return this.options.store.deliveries(); }

  /** Disabled unless a trusted managed verifier proves provider quiescence/usage, not a timeout or queue hint. */
  async reconcile(raw: unknown, evidence: unknown): Promise<void> {
    const delivery = DeliverySchema.safeParse(raw); if (!delivery.success) return fail('INVALID');
    if (!this.options.reconcile) return fail('DISABLED');
    const prior = await this.read(delivery.data.jobId);
    if (!prior.job || prior.job.phase !== 'DEAD' || prior.job.reason !== 'PROVIDER_UNCONFIRMED') return fail('STALE');
    const proof = z.strictObject({ providerStopped: z.literal(true), proofHash: hash, usage: usage.nullable() }).safeParse(await this.bounded(() => this.options.reconcile!(prior.job!.reference, evidence), this.now() + this.bounds.leaseMs));
    if (!proof.success || (proof.data.usage && safeSum(proof.data.usage.inputTokens, proof.data.usage.outputTokens) > prior.job.reservedTokens)) return fail('INVALID');
    const next = structuredClone(prior); next.job!.recoveryProofHash = proof.data.proofHash; next.job!.usage = proof.data.usage;
    this.finish(next, 'DEAD', 'STALE'); // disposition stays dead; there is never a delayed result application or refund
    let fence: Fence | undefined; let effect: Effect | undefined;
    if (this.options.execution.cancel) {
      try { const cleanup = await this.bounded(() => this.options.execution.reload(prior.job!.reference), this.now() + this.bounds.leaseMs);
        effect = await this.bounded(() => this.options.execution.cancel!(prior.job!.reference, cleanup.context), this.now() + this.bounds.leaseMs); fence = cleanup.fence; }
      catch { /* Preserve changed contexts and exact dead disposition; managed closeout observes missing cancellation. */ }
    }
    await this.save(prior, next, fence, effect);
  }
  private finish(next: JobSnapshot, phase: 'SUCCEEDED' | 'DEAD', reason: DurableJob['reason']) {
    const job = next.job!; job.phase = phase; job.reason = reason; job.lease = null;
    if (reason !== 'PROVIDER_UNCONFIRMED') {
      next.control.active = next.control.active.filter(id => id !== job.reference.jobId);
      next.control.slots = next.control.slots.filter(slot => slot.jobId !== job.reference.jobId);
    }
  }
  private current(prior: JobSnapshot, token: string) {
    if (!prior.job?.lease || prior.job.lease.token !== token || prior.job!.lease!.until <= this.now()) fail('STALE');
    if (!prior.control.enabled || prior.job!.reference.expiresAt <= this.now()) fail('STALE');
    if (!prior.control.slots.some(slot => slot.jobId === prior.job!.reference.jobId && slot.token === token && slot.until > this.now())) fail('STALE');
  }
  async process(raw: unknown): Promise<'APPLIED' | 'SKIPPED' | 'RETRY' | 'DEAD'> {
    const delivery = DeliverySchema.safeParse(raw); if (!delivery.success) return fail('INVALID');
    const id = delivery.data.jobId; let prior = await this.read(id); const job = prior.job;
    if (!job || ['SUCCEEDED', 'DEAD'].includes(job.phase)) return 'SKIPPED';
    const now = this.now();
    if (job.lease && job.lease.until > now) return 'SKIPPED';
    const next = structuredClone(prior);
    // A dead worker might already have sent a paid request. Never reissue uncertain calls.
    if (job.phase === 'CALLING' || job.reference.expiresAt <= now || !prior.control.enabled) {
      this.finish(next, 'DEAD', job.phase === 'CALLING' ? 'PROVIDER_UNCONFIRMED' : !prior.control.enabled ? 'DISABLED' : 'EXPIRED');
      await this.save(prior, next); return 'DEAD';
    }
    if (job.availableAt > now) return 'SKIPPED';
    // Expired CALLING slots remain occupied until their IDs are reconciled above.
    next.control.slots = next.control.slots.filter(slot => slot.until > now || slot.jobId !== id);
    if (next.control.slots.length >= 2) return 'SKIPPED';
    const token = randomUUID(), until = Math.min(safeSum(now, this.bounds.leaseMs), job.reference.expiresAt);
    next.job!.phase = 'LEASED'; next.job!.lease = { token, until };
    next.control.slots.push({ jobId: id, token, until });
    await this.save(prior, next);
    let called = false; let responded = false; let observedUsage: z.infer<typeof usage> | null = null; let callTimer: ReturnType<typeof setTimeout> | undefined; const controller = new AbortController();
    try {
      const prepared = await this.bounded(() => this.options.execution.reload(job.reference), until);
      prior = await this.read(id); this.current(prior, token);
      const reserved = structuredClone(prior); reserved.job!.phase = 'CALLING';
      reserved.job!.attempts = safeSum(prior.job!.attempts, 1);
      if (reserved.job!.attempts > 2) fail('INVALID_OUTPUT');
      reserved.job!.reservedTokens = safeSum(prior.job!.reservedTokens, this.bounds.maxTokens);
      reserved.job!.reservedCostMicros = safeSum(prior.job!.reservedCostMicros, this.bounds.maxCostMicros);
      reserved.totals.reservedTokens = safeSum(prior.totals.reservedTokens, this.bounds.maxTokens);
      reserved.totals.reservedCostMicros = safeSum(prior.totals.reservedCostMicros, this.bounds.maxCostMicros);
      await this.save(prior, reserved, prepared.fence);
      // Refresh once more immediately before provider dispatch; reserved counters stay charged if this fails.
      const immediate = await this.bounded(() => this.options.execution.reload(job.reference), until);
      prior = await this.read(id); this.current(prior, token); if (prior.job!.phase !== 'CALLING') fail('STALE');
      await this.save(prior, structuredClone(prior), immediate.fence);
      prior = await this.read(id); this.current(prior, token);
      called = true;
      const allowance = Math.min(this.bounds.timeoutMs, until - this.now()); if (allowance <= 0) fail('STALE');
      const deadline = new Promise<never>((_, reject) => { callTimer = setTimeout(() => { controller.abort(); reject(new DurableJobError('STALE')); }, allowance); });
      const result = await Promise.race([deadline, this.options.execution.invoke(immediate.context, controller.signal)]);
      responded = true;
      const observed = usage.safeParse(result.usage);
      if (!observed.success) return fail('INVALID_OUTPUT');
      if (safeSum(observed.data.inputTokens, observed.data.outputTokens) > this.bounds.maxTokens) return fail('INVALID_OUTPUT');
      // Context and authority are reloaded, never inferred from old queue bytes or provider output.
      observedUsage = observed.data;
      const fresh = await this.bounded(() => this.options.execution.reload(job.reference), until);
      const effect = await this.bounded(() => this.options.execution.prepare(job.reference, fresh.context, result.output), until);
      prior = await this.read(id); this.current(prior, token);
      const completed = structuredClone(prior); completed.job!.usage = observed.data;
      this.finish(completed, 'SUCCEEDED', null);
      await this.save(prior, completed, fresh.fence, effect); return 'APPLIED';
    } catch (error) {
      controller.abort();
      const failure = error instanceof DurableJobError ? error.code : 'STALE';
      prior = await this.read(id);
      // A lost token never cancels/retries a successor, and uncertain transaction acknowledgements are read back.
      if (prior.job?.phase === 'SUCCEEDED') return 'APPLIED';
      if (!prior.job || prior.job.lease?.token !== token) return 'SKIPPED';
      const failed = structuredClone(prior); if (observedUsage) failed.job!.usage = observedUsage;
      if (called || prior.job.phase === 'CALLING') {
        this.finish(failed, 'DEAD', !called || responded ? failure === 'INVALID_OUTPUT' ? 'INVALID_OUTPUT' : 'STALE' : 'PROVIDER_UNCONFIRMED');
      } else if (failure === 'RETRYABLE' && prior.job.failures < 2 && prior.control.enabled && prior.job.reference.expiresAt > this.now()) {
        failed.job!.phase = 'READY'; failed.job!.lease = null; failed.job!.failures++;
        failed.job!.availableAt = Math.min(safeSum(this.now(), 500 * 2 ** prior.job.failures), prior.job.reference.expiresAt);
        failed.control.slots = failed.control.slots.filter(slot => slot.jobId !== id);
      } else this.finish(failed, 'DEAD', failure === 'RETRYABLE' ? 'RETRY_LIMIT' : failure === 'BUDGET' ? 'BUDGET' : 'STALE');
      let fence: Fence | undefined; let effect: Effect | undefined;
      if (failed.job!.phase === 'DEAD' && failed.job!.reason !== 'PROVIDER_UNCONFIRMED' && this.options.execution.cancel) {
        try { const cleanup = await this.bounded(() => this.options.execution.reload(job.reference), this.now() + this.bounds.leaseMs);
          effect = await this.bounded(() => this.options.execution.cancel!(job.reference, cleanup.context), this.now() + this.bounds.leaseMs); fence = cleanup.fence; }
        catch { /* Changed/denied context must not cancel somebody else's current reasoning. */ }
      }
      await this.save(prior, failed, fence, effect); return failed.job!.phase === 'READY' ? 'RETRY' : 'DEAD';
    } finally { if (callTimer) clearTimeout(callTimer); }
  }
}

export function modelJobAuthorityHash(value: { controlVersion: number; epoch: number; contextToken: string; semanticVersion: number; consentRevision: number }): string {
  if (![value.controlVersion, value.epoch, value.semanticVersion, value.consentRevision].every(n => Number.isSafeInteger(n) && n >= 0)
    || typeof value.contextToken !== 'string' || value.contextToken.length < 1 || value.contextToken.length > 256) return fail('INVALID');
  return createHash('sha256').update(JSON.stringify([value.controlVersion, value.epoch, value.contextToken, value.semanticVersion, value.consentRevision])).digest('hex');
}
