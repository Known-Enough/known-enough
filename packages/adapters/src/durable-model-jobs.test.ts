import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { DurableModelJobs, DurableJobError, type DurableJob, type JobReference, type JobSnapshot, type DurableJobStore } from './durable-model-jobs.ts';
const source = 'a'.repeat(40), authorityHash = 'b'.repeat(64);
const ref = (): JobReference => ({ jobId: randomUUID(), kind: 'NEGOTIATION', subject: 'synthetic', decisionId: 'decision', reasoningJobId: 'reasoning', authorityHash, sourceSha: source, expiresAt: 100_000 });
function fixture() {
  let time = 1000;
  const jobs = new Map<string, DurableJob>();
  const global = { control: { schemaVersion: 1 as const, revision: 1, enabled: true, sourceSha: source, active: [] as string[], slots: [] as { jobId: string; token: string; until: number }[] },
    totals: { runs: 9, messages: 7, reservedTokens: 100, reservedCostMicros: 200 } };
  const commits: JobSnapshot[] = [], effects: string[] = []; let current = true;
  const store: DurableJobStore<boolean, string> = {
    async read(id) { return structuredClone({ job: jobs.get(id) ?? null, ...global }); },
    async commit(prior, next, fence, effect) {
      const actual = { job: jobs.get(next.job!.reference.jobId) ?? null, ...global };
      if (JSON.stringify(prior) !== JSON.stringify(actual) || (fence && !current)) return false;
      global.control = structuredClone(next.control); global.totals = structuredClone(next.totals); jobs.set(next.job!.reference.jobId, structuredClone(next.job!));
      commits.push(structuredClone(next)); if (effect) effects.push(effect); return true;
    }, async deliveries() { return global.control.active.map(jobId => ({ jobId })); },
  };
  const reload = vi.fn(async () => { if (!current) throw new DurableJobError('STALE'); return { context: 'transient private condition and raw conversation', fence: true }; });
  const invoke = vi.fn(async () => ({ output: 'transient model output', usage: { inputTokens: 30, outputTokens: 4 } }));
  const prepare = vi.fn(async () => 'kernel-checked-result');
  const worker = () => new DurableModelJobs({ store, now: () => time, execution: { reload, invoke, prepare }, bounds: { timeoutMs: 100, leaseMs: 200, maxTokens: 100, maxCostMicros: 50 } });
  return { worker, jobs, global, commits, effects, reload, invoke, prepare, store,
    setTime: (value: number) => { time = value; }, stale: () => { current = false; } };
}
describe('durable model job recovery and charging', () => {
  it('recovers an ID-only persisted pending job in a new worker; preserves inherited cumulative counters', async () => {
    const f = fixture(), r = ref(); await f.worker().enqueue(r);
    expect(await f.worker().deliveries()).toEqual([{ jobId: r.jobId }]);
    expect(await f.worker().process({ jobId: r.jobId })).toBe('APPLIED');
    expect(f.global.totals).toEqual({ runs: 9, messages: 7, reservedTokens: 200, reservedCostMicros: 250 });
    expect(f.jobs.get(r.jobId)?.usage).toEqual({ inputTokens: 30, outputTokens: 4 });
    expect(f.effects).toEqual(['kernel-checked-result']);
    expect(JSON.stringify(f.commits)).not.toMatch(/private condition|raw conversation|model output|kernel-checked/);
    expect(await f.worker().deliveries()).toEqual([]);
    expect(await f.worker().process({ jobId: r.jobId })).toBe('SKIPPED'); expect(f.invoke).toHaveBeenCalledTimes(1);
    expect(f.reload.mock.calls.length).toBe(4);
  });
  it('idempotent duplicate enqueue neither charges nor replaces authority; changed same ID is rejected', async () => {
    const f = fixture(), r = ref(); await f.worker().enqueue(r); await f.worker().enqueue(r);
    expect(f.commits).toHaveLength(1); await expect(f.worker().enqueue({ ...r, subject: 'other' })).rejects.toThrow('MODEL_JOB_INVALID');
  });
  it.each([{ jobId: 'invalid' }, { ...ref() }, { jobId: randomUUID(), rawTurns: ['private'] }, null, []])('rejects untrusted delivery shape %j', async value => {
    const f = fixture(); await expect(f.worker().process(value)).rejects.toThrow('MODEL_JOB_INVALID'); expect(f.invoke).not.toHaveBeenCalled();
  });
  it('duplicate workers cannot dispatch twice or double-charge', async () => {
    const f = fixture(), r = ref(); await f.worker().enqueue(r);
    let finish!: (value: { output: string; usage: { inputTokens: number; outputTokens: number } }) => void;
    f.invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = f.worker().process({ jobId: r.jobId }); await vi.waitFor(() => expect(f.invoke).toHaveBeenCalledTimes(1));
    expect(await f.worker().process({ jobId: r.jobId })).toBe('SKIPPED'); finish({ output: 'result', usage: { inputTokens: 1, outputTokens: 1 } });
    expect(await first).toBe('APPLIED'); expect(f.global.totals.reservedTokens).toBe(200);
  });
  it('recovers an expired pre-dispatch lease with a fresh token', async () => {
    const f = fixture(), r = ref(); await f.worker().enqueue(r);
    const job = f.jobs.get(r.jobId)!; job.phase = 'LEASED'; job.lease = { token: randomUUID(), until: 1100 };
    f.global.control.slots.push({ jobId: r.jobId, ...job.lease }); f.setTime(1200);
    expect(await f.worker().process({ jobId: r.jobId })).toBe('APPLIED'); expect(f.invoke).toHaveBeenCalledTimes(1);
  });
  it('restart after dispatch never reissues an uncertain provider call or releases its quarantine slot', async () => {
    const f = fixture(), r = ref(); await f.worker().enqueue(r);
    const job = f.jobs.get(r.jobId)!; job.phase = 'CALLING'; job.lease = { token: randomUUID(), until: 1100 };
    job.attempts = 1; job.reservedTokens = 100; job.reservedCostMicros = 50;
    f.global.control.slots.push({ jobId: r.jobId, ...job.lease }); f.global.totals.reservedTokens += 100; f.global.totals.reservedCostMicros += 50;
    f.setTime(1200); expect(await f.worker().process({ jobId: r.jobId })).toBe('DEAD');
    expect(f.jobs.get(r.jobId)?.reason).toBe('PROVIDER_UNCONFIRMED'); expect(f.global.control.slots).toHaveLength(1);
    expect(f.global.totals.reservedTokens).toBe(200); expect(f.invoke).not.toHaveBeenCalled();
    expect(await f.worker().process({ jobId: r.jobId })).toBe('SKIPPED');
  });
  it.each(['before', 'after'] as const)('stale authority %s provider prevents output', async stage => {
    const f = fixture(), r = ref(); await f.worker().enqueue(r);
    if (stage === 'before') f.stale(); else f.invoke.mockImplementation(async () => { f.stale(); return { output: 'ignored', usage: { inputTokens: 3, outputTokens: 2 } }; });
    expect(await f.worker().process({ jobId: r.jobId })).toBe('DEAD'); expect(f.effects).toEqual([]);
    expect(f.invoke).toHaveBeenCalledTimes(stage === 'before' ? 0 : 1);
    expect(f.global.totals.reservedTokens).toBe(stage === 'before' ? 100 : 200);
  });
  it('bounded pre-call retry/backoff survives restart, ends after two retries and never charges provider', async () => {
    const f = fixture(), r = ref(); await f.worker().enqueue(r); f.reload.mockImplementation(async () => { throw new DurableJobError('RETRYABLE'); });
    expect(await f.worker().process({ jobId: r.jobId })).toBe('RETRY');
    expect(await f.worker().process({ jobId: r.jobId })).toBe('SKIPPED'); f.setTime(1500);
    expect(await f.worker().process({ jobId: r.jobId })).toBe('RETRY'); f.setTime(2500);
    expect(await f.worker().process({ jobId: r.jobId })).toBe('DEAD'); expect(f.jobs.get(r.jobId)?.reason).toBe('RETRY_LIMIT');
    expect(f.invoke).not.toHaveBeenCalled(); expect(f.global.totals.reservedTokens).toBe(100);
  });
  it.each(['expired', 'disabled'] as const)('terminal %s work makes no provider call', async state => {
    const f = fixture(), r = ref(); await f.worker().enqueue(r);
    if (state === 'expired') f.setTime(r.expiresAt); else f.global.control.enabled = false;
    expect(await f.worker().process({ jobId: r.jobId })).toBe('DEAD'); expect(f.invoke).not.toHaveBeenCalled();
  });
  it('paid dispatch failure stays charged and quarantined, with sanitized diagnostics only', async () => {
    const f = fixture(), r = ref(); await f.worker().enqueue(r); f.invoke.mockRejectedValue(new Error('private provider text'));
    expect(await f.worker().process({ jobId: r.jobId })).toBe('DEAD');
    expect(f.global.control.slots).toHaveLength(1); expect(f.global.totals.reservedCostMicros).toBe(250);
    expect(JSON.stringify(f.commits)).not.toContain('private provider text'); expect(f.prepare).not.toHaveBeenCalled();
  });
  it('bounded provider timeout fences uncooperative late response and retains slot', async () => {
    const f = fixture(), r = ref(); await f.worker().enqueue(r);
    let finish!: (value: { output: string; usage: { inputTokens: number; outputTokens: number } }) => void;
    f.invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    expect(await f.worker().process({ jobId: r.jobId })).toBe('DEAD'); finish({ output: 'late', usage: { inputTokens: 1, outputTokens: 1 } });
    await Promise.resolve(); expect(f.effects).toEqual([]); expect(f.global.control.slots).toHaveLength(1);
  });
  it('confirmed invalid output is charged but never retried; slot releases after definite response', async () => {
    const f = fixture(), r = ref(); await f.worker().enqueue(r); f.prepare.mockRejectedValue(new DurableJobError('INVALID_OUTPUT'));
    expect(await f.worker().process({ jobId: r.jobId })).toBe('DEAD'); expect(f.jobs.get(r.jobId)?.reason).toBe('INVALID_OUTPUT');
    expect(f.global.control.slots).toHaveLength(0); expect(f.global.totals.reservedTokens).toBe(200);
    expect(await f.worker().process({ jobId: r.jobId })).toBe('SKIPPED'); expect(f.invoke).toHaveBeenCalledTimes(1);
  });
  it('lease loss after provider response rejects output', async () => {
    const f = fixture(), r = ref(); await f.worker().enqueue(r);
    f.invoke.mockImplementation(async () => { f.setTime(1300); return { output: 'stale', usage: { inputTokens: 2, outputTokens: 2 } }; });
    expect(await f.worker().process({ jobId: r.jobId })).toBe('DEAD'); expect(f.effects).toEqual([]);
  });
  it('two unresolved calls consume distributed capacity, including expired quarantines', async () => {
    const f = fixture(); f.invoke.mockRejectedValue(new Error('uncertain'));
    for (let i = 0; i < 2; i++) { const r = ref(); await f.worker().enqueue(r); await f.worker().process({ jobId: r.jobId }); }
    f.setTime(5000); const third = ref(); await f.worker().enqueue(third);
    expect(await f.worker().process({ jobId: third.jobId })).toBe('SKIPPED'); expect(f.invoke).toHaveBeenCalledTimes(2);
  });
  it('cumulative overflow blocks dispatch and preserves prior counters', async () => {
    const f = fixture(), r = ref(); f.global.totals.reservedTokens = Number.MAX_SAFE_INTEGER - 50; await f.worker().enqueue(r);
    expect(await f.worker().process({ jobId: r.jobId })).toBe('DEAD'); expect(f.invoke).not.toHaveBeenCalled();
    expect(f.jobs.get(r.jobId)?.reason).toBe('BUDGET'); expect(f.global.totals.reservedTokens).toBe(Number.MAX_SAFE_INTEGER - 50);
  });
  it.each([{ maxTokens: 0 }, { leaseMs: 100 }, { timeoutMs: 99 }, { maxCostMicros: 0 }])('rejects unsafe operational bounds %j', async bounds => {
    const f = fixture(); expect(() => new DurableModelJobs({ store: f.store, now: () => 1000, execution: { reload: f.reload, invoke: f.invoke, prepare: f.prepare }, bounds })).toThrow('MODEL_JOB_INVALID');
  });
});

it('authority withdrawal after reservation makes no call, remains charged, and safely frees its pre-dispatch slot', async () => {
  const f = fixture(), r = ref(); await f.worker().enqueue(r); let reloads = 0;
  f.reload.mockImplementation(async () => { if (++reloads === 2) throw new DurableJobError('STALE'); return { context: 'private', fence: true }; });
  expect(await f.worker().process({ jobId: r.jobId })).toBe('DEAD'); expect(f.invoke).not.toHaveBeenCalled();
  expect(f.global.totals.reservedTokens).toBe(200); expect(f.global.control.slots).toHaveLength(0);
});
it('verified managed reconciliation releases quarantine with proof hash/actual usage and no refund/reissue', async () => {
  const f = fixture(), r = ref(); await f.worker().enqueue(r); f.invoke.mockRejectedValue(new Error('uncertain'));
  await f.worker().process({ jobId: r.jobId });
  await expect(f.worker().reconcile({ jobId: r.jobId }, { timeout: true })).rejects.toThrow('MODEL_JOB_DISABLED');
  const verify = vi.fn(async () => ({ providerStopped: true as const, proofHash: 'c'.repeat(64), usage: { inputTokens: 2, outputTokens: 3 } }));
  const worker = new DurableModelJobs({ store: f.store, now: () => 1000, execution: { reload: f.reload, invoke: f.invoke, prepare: f.prepare }, reconcile: verify });
  await worker.reconcile({ jobId: r.jobId }, 'verified-private-managed-receipt');
  expect(f.global.control.slots).toHaveLength(0); expect(f.global.totals.reservedTokens).toBe(200);
  expect(f.jobs.get(r.jobId)).toMatchObject({ phase: 'DEAD', usage: { inputTokens: 2, outputTokens: 3 }, recoveryProofHash: 'c'.repeat(64) });
  expect(JSON.stringify(f.commits)).not.toContain('verified-private-managed-receipt');
  expect(await worker.process({ jobId: r.jobId })).toBe('SKIPPED'); expect(f.invoke).toHaveBeenCalledTimes(1);
});
it('stalled private reload/prepare cannot hang a worker or authorize a late result', async () => {
  const f = fixture(), r = ref(); await f.worker().enqueue(r); f.reload.mockImplementation(() => new Promise(() => {}));
  expect(await f.worker().process({ jobId: r.jobId })).toBe('DEAD'); expect(f.invoke).not.toHaveBeenCalled();
  const g = fixture(), s = ref(); await g.worker().enqueue(s); g.prepare.mockImplementation(() => new Promise(() => {}));
  expect(await g.worker().process({ jobId: s.jobId })).toBe('DEAD'); expect(g.effects).toEqual([]); expect(g.global.totals.reservedTokens).toBe(200);
});
