import { describe, expect, it, vi } from 'vitest';
import { createDurableScheduledWorker, MODEL_JOB_FUNCTION, MODEL_JOB_RULE } from './durable-scheduled-worker.ts';
const id = '12345678-1234-4234-9234-123456789012';
const other = '12345678-1234-4234-9234-123456789013';
const event = () => ({ source: 'aws.events', 'detail-type': 'Scheduled Event', account: '092954139775', region: 'us-east-1', resources: [MODEL_JOB_RULE], detail: {} });
const context = () => ({ invokedFunctionArn: MODEL_JOB_FUNCTION, getRemainingTimeInMillis: () => 180000 });
describe('automatic durable outbox runner', () => {
  it('rejects foreign invocation and caller-selected jobs before touching storage', async () => {
    const worker = { deliveries: vi.fn(), process: vi.fn() }; const run = createDurableScheduledWorker({ worker, report: vi.fn() });
    for (const value of [null, {}, { ...event(), account: 'other' }, { ...event(), region: 'us-west-2' },
      { ...event(), source: 'request' }, { ...event(), resources: [MODEL_JOB_RULE, MODEL_JOB_RULE] },
      { ...event(), detail: { jobId: id } }, { ...event(), resources: [MODEL_JOB_RULE + '-other'] }]) {
      await expect(run(value, context())).rejects.toThrow('MODEL_JOB_INVOCATION_INVALID');
    }
    await expect(run(event(), { ...context(), invokedFunctionArn: MODEL_JOB_FUNCTION + '-other' })).rejects.toThrow();
    expect(worker.deliveries).not.toHaveBeenCalled(); expect(worker.process).not.toHaveBeenCalled();
  });
  it('rejects oversized duplicate or private-bearing outboxes before processing any prefix', async () => {
    for (const value of [[{ jobId: id }, { jobId: id }], Array.from({ length: 65 }, () => ({ jobId: id })),
      [{ jobId: id }, { jobId: other, subject: 'private' }], [{ jobId: 'bad' }]]) {
      const worker = { deliveries: vi.fn(async () => value), process: vi.fn() };
      await expect(createDurableScheduledWorker({ worker, report: vi.fn() })(event(), context())).rejects.toThrow();
      expect(worker.process).not.toHaveBeenCalled();
    }
  });
  it('new worker instances discover retryable saved IDs and delegate duplicate prevention to the durable processor', async () => {
    let done = false; let paid = 0;
    const worker = { deliveries: async () => [{ jobId: id }], process: async () => {
      if (done) return 'SKIPPED' as const; paid++; done = true; return 'APPLIED' as const;
    } };
    const first = await createDurableScheduledWorker({ worker, report: vi.fn() })(event(), context());
    const restarted = await createDurableScheduledWorker({ worker, report: vi.fn() })(event(), context());
    expect(first.applied).toBe(1); expect(restarted.skipped).toBe(1); expect(paid).toBe(1);
  });
  it('stops before the execution deadline without dropping undispatched saved work', async () => {
    let remaining = 180000;
    const worker = { deliveries: async () => [{ jobId: id }, { jobId: other }], process: vi.fn(async () => {
      remaining = 59000; return 'RETRY' as const;
    }) };
    const result = await createDurableScheduledWorker({ worker, report: vi.fn() })(event(), { ...context(), getRemainingTimeInMillis: () => remaining });
    expect(result).toMatchObject({ discovered: 2, attempted: 1, retry: 1, deferred: 1 });
    expect(worker.process).toHaveBeenCalledOnce();
  });
  it('awaits outcomes and reports counts without IDs provider responses or raw errors', async () => {
    const report = vi.fn(); const worker = { deliveries: async () => [{ jobId: id }, { jobId: other }],
      process: vi.fn().mockRejectedValueOnce(new Error('private provider response')).mockResolvedValueOnce('DEAD') };
    const result = await createDurableScheduledWorker({ worker, report })(event(), context());
    expect(result).toMatchObject({ failed: 1, dead: 1, attempted: 2 });
    expect(JSON.stringify(report.mock.calls)).not.toMatch(/private|12345678/);
    expect(report).toHaveBeenCalledOnce();
  });
  it('does not read the outbox when the invocation has insufficient time', async () => {
    const worker = { deliveries: vi.fn(), process: vi.fn() };
    await createDurableScheduledWorker({ worker, report: vi.fn() })(event(), { ...context(), getRemainingTimeInMillis: () => 1000 });
    expect(worker.deliveries).not.toHaveBeenCalled();
  });
});
