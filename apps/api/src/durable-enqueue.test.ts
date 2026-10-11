import { expect, it, vi } from 'vitest';
import type { KnownEnoughRecord } from '@deal-table/application';
import { KnownEnoughApplicationError } from '@deal-table/application';
import type { JobReference, JobSnapshot, DurableJob } from '@deal-table/adapters/durable-model-runtime';
import { createDurableEnqueue, stableDeliveryId, type DurableEnqueueRequest } from './durable-enqueue.ts';
const source = 'a'.repeat(40); const now = Date.parse('2026-10-11T00:00:00Z');
function fixture() {
  const record = { status: 'READY', job: null, solveEpoch: 2, controlVersion: 8,
    definition: { decisionId: 'owned-decision', contextToken: 'b'.repeat(64), semanticVersion: 3 } } as
    Pick<KnownEnoughRecord, 'status' | 'job' | 'solveEpoch' | 'controlVersion' | 'definition'>;
  const jobs = new Map<string, DurableJob>();
  const control = { schemaVersion: 1 as const, revision: 1, enabled: true, sourceSha: source, active: [] as string[], slots: [] };
  const readJob = vi.fn(async (jobId: string): Promise<JobSnapshot> => ({ job: structuredClone(jobs.get(jobId) ?? null),
    control: structuredClone(control), totals: { runs: 63, reservedTokens: 1000, reservedCostMicros: 500, messages: 58 } }));
  const enqueue = vi.fn(async (_principal: unknown, reference: JobReference) => {
    jobs.set(reference.jobId, { schemaVersion: 1, revision: 1, reference: structuredClone(reference), phase: 'READY', lease: null,
      attempts: 0, failures: 0, availableAt: now, reservedTokens: 0, reservedCostMicros: 0, usage: null, reason: null, recoveryProofHash: null });
    control.active.push(reference.jobId); return { jobId: reference.jobId };
  });
  const authorize = vi.fn(async () => {}); const retained = vi.fn(async () => {});
  const request: DurableEnqueueRequest = { principal: { kind: 'participant', subject: 'signed-owner' }, decisionId: 'owned-decision',
    expected: { contextToken: 'b'.repeat(64), semanticVersion: 3, controlVersion: 8 }, signal: new AbortController().signal,
    authorize, read: vi.fn(async () => structuredClone(record)), begin: vi.fn(async () => {
      record.solveEpoch++; record.controlVersion++; record.status = 'REASONING';
      record.job = { id: 'kernel-reasoning', epoch: record.solveEpoch, contextToken: record.definition.contextToken, semanticVersion: record.definition.semanticVersion };
      return record.job;
    }) };
  const bridge = () => createDurableEnqueue({ sourceSha: source, now: () => now, assertRetained: retained, readJob, enqueue });
  return { record, jobs, control, readJob, enqueue, retained, authorize, request, bridge };
}
it('queues only an authenticated current kernel job and returns an allowlisted receipt without private data', async () => {
  const f = fixture(); const result = await f.bridge()(f.request);
  expect(result).toEqual({ jobId: stableDeliveryId(source, f.request.decisionId, 'kernel-reasoning'), state: 'QUEUED', expiresAt: new Date(now + 300000).toISOString() });
  const reference = f.enqueue.mock.calls[0]![1];
  expect(Object.keys(reference).sort()).toEqual(['authorityHash', 'decisionId', 'expiresAt', 'jobId', 'kind', 'reasoningJobId', 'sourceSha', 'subject']);
  expect(reference.subject).toBe('signed-owner'); expect(f.request.begin).toHaveBeenCalledOnce();
  expect(JSON.stringify(result)).not.toMatch(/subject|sourceSha|authorityHash|contextToken|kernel-reasoning/);
});
it('a fresh server bridge and repeated request return the same delivery without another kernel or queue write', async () => {
  const f = fixture(); const first = await f.bridge()(f.request); const repeat = await f.bridge()(f.request);
  expect(repeat).toEqual(first); expect(f.request.begin).toHaveBeenCalledOnce(); expect(f.enqueue).toHaveBeenCalledOnce();
});
it('a current second group member can observe the same queue receipt without replacing its original subject', async () => {
  const f = fixture(); const first = await f.bridge()(f.request);
  expect(await f.bridge()({ ...f.request, principal: { kind: 'participant', subject: 'another-verified-member' } })).toEqual(first);
  expect(f.enqueue).toHaveBeenCalledOnce(); expect(f.jobs.get(first.jobId)!.reference.subject).toBe('signed-owner');
});
it('reconciles lost enqueue acknowledgements from exact persisted references without reissuing a queue write', async () => {
  const f = fixture(); const original = f.enqueue.getMockImplementation()!;
  f.enqueue.mockImplementation(async (principal, reference) => { await original(principal, reference); throw new Error('PRIVATE_SOCKET_ERROR'); });
  const result = await f.bridge()(f.request); expect(result.state).toBe('QUEUED'); expect(f.enqueue).toHaveBeenCalledOnce();
});
it('ambiguous enqueue without a persisted reference remains retryable rather than claiming success', async () => {
  const f = fixture(); f.enqueue.mockRejectedValue(new Error('UNKNOWN_COMMIT'));
  await expect(f.bridge()(f.request)).rejects.toMatchObject({ code: 'RETRYABLE_SERVER_ERROR' }); expect(f.enqueue).toHaveBeenCalledOnce();
});
it('a committed kernel begin with a lost response is resumed from its exact context instead of starting another job', async () => {
  const f = fixture(); const begin = vi.mocked(f.request.begin).getMockImplementation()!;
  vi.mocked(f.request.begin).mockImplementation(async () => { await begin(); throw new Error('LOST_BEGIN_ACK'); });
  expect((await f.bridge()(f.request)).state).toBe('QUEUED'); expect(f.request.begin).toHaveBeenCalledOnce();
});
it('disabled or foreign-source queues cannot strand a new kernel job', async () => {
  for (const change of [{ enabled: false }, { sourceSha: 'c'.repeat(40) }]) {
    const f = fixture(); Object.assign(f.control, change);
    await expect(f.bridge()(f.request)).rejects.toMatchObject({ code: 'RETRYABLE_SERVER_ERROR' });
    expect(f.request.begin).not.toHaveBeenCalled(); expect(f.enqueue).not.toHaveBeenCalled();
  }
});
it('authentication, admission and retention are checked before kernel or queue changes', async () => {
  const f = fixture();
  await expect(f.bridge()({ ...f.request, principal: { kind: 'display', subject: 'display', roomId: 'owned-decision' } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(f.authorize).not.toHaveBeenCalled();
  f.authorize.mockRejectedValue(new KnownEnoughApplicationError('FORBIDDEN'));
  await expect(f.bridge()(f.request)).rejects.toMatchObject({ code: 'FORBIDDEN' }); expect(f.retained).not.toHaveBeenCalled();
  f.authorize.mockResolvedValue(undefined); f.retained.mockRejectedValue(new Error('EXPIRED_RETENTION'));
  await expect(f.bridge()(f.request)).rejects.toThrow('EXPIRED_RETENTION'); expect(f.request.begin).not.toHaveBeenCalled(); expect(f.enqueue).not.toHaveBeenCalled();
});
it('stale semantic/control/epoch contexts and terminal or expired existing deliveries cannot be renewed', async () => {
  for (const expected of [{ contextToken: 'c'.repeat(64) }, { semanticVersion: 7 }, { controlVersion: 100 }]) {
    const f = fixture(); await expect(f.bridge()({ ...f.request, expected: { ...f.request.expected, ...expected } })).rejects.toMatchObject({ code: 'STALE_CONTEXT' });
    expect(f.enqueue).not.toHaveBeenCalled();
  }
  for (const mutate of [(job: DurableJob) => { job.phase = 'DEAD'; }, (job: DurableJob) => { job.reference.expiresAt = now - 1; },
    (job: DurableJob) => { job.reference.authorityHash = 'c'.repeat(64); }]) {
    const f = fixture(); const result = await f.bridge()(f.request); mutate(f.jobs.get(result.jobId)!);
    await expect(f.bridge()(f.request)).rejects.toMatchObject({ code: 'STALE_CONTEXT' }); expect(f.enqueue).toHaveBeenCalledOnce();
  }
});
it('aborted requests stop before any operation and delivery IDs are stable RFC UUIDs isolated by source and decision', async () => {
  const f = fixture(); const controller = new AbortController(); controller.abort();
  await expect(f.bridge()({ ...f.request, signal: controller.signal })).rejects.toMatchObject({ code: 'RETRYABLE_SERVER_ERROR' });
  expect(f.authorize).not.toHaveBeenCalled(); expect(f.request.begin).not.toHaveBeenCalled();
  expect(stableDeliveryId(source, 'decision', 'kernel')).toMatch(/^[a-f0-9-]{14}4[a-f0-9-]{4}[89ab]/);
  expect(stableDeliveryId(source, 'decision', 'kernel')).not.toBe(stableDeliveryId('d'.repeat(40), 'decision', 'kernel'));
});
