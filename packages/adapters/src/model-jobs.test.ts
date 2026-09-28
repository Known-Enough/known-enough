import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelJobMetric } from './model-jobs.ts';
import { BoundedModelJobs } from './model-jobs.ts';
import type { ModelInvocation } from '@deal-table/application';
const invocation = (): ModelInvocation => ({ expiresAt: Date.now() + 30_000, assertCurrent: vi.fn(async () => {}) });
afterEach(() => vi.useRealTimers());

describe('bounded model jobs', () => {
  it('delivers only an opaque ID, suppresses replay and clears completed data', async () => {
    const jobs = new BoundedModelJobs();
    const delivery = vi.spyOn(jobs, 'process');
    const task = vi.fn(async () => ({ private: 'PRIVATE_CANARY' }));
    const guard = invocation();
    const result = await jobs.run('OWNER', guard, task);
    expect(result).toEqual({ private: 'PRIVATE_CANARY' });
    expect(delivery).toHaveBeenCalledTimes(1);
    const message = delivery.mock.calls[0]![0];
    expect(Object.keys(message as object)).toEqual(['jobId']);
    expect(JSON.stringify(message)).not.toContain('PRIVATE_CANARY');
    await jobs.process(message);
    expect(task).toHaveBeenCalledTimes(1);
    expect(guard.assertCurrent).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(jobs)).not.toContain('PRIVATE_CANARY');
  });
  it.each(['before', 'after'])('rejects stale authority %s inference', async phase => {
    const jobs = new BoundedModelJobs();
    let stale = phase === 'before';
    const task = vi.fn(async () => { stale = true; return 'private'; });
    await expect(jobs.run('OWNER', { ...invocation(), assertCurrent: async () => { if (stale) throw Error('private reason'); } }, task))
      .rejects.toMatchObject({ message: 'STALE' });
    expect(task).toHaveBeenCalledTimes(phase === 'before' ? 0 : 1);
  });
  it('bounds concurrency and capacity without retrying a job', async () => {
    const jobs = new BoundedModelJobs({ concurrency: 1, capacity: 2 });
    let release!: () => void;
    const task = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const first = jobs.run('OWNER', invocation(), task);
    const secondTask = vi.fn(async () => 'second');
    const second = jobs.run('ARCHITECT', invocation(), secondTask);
    await expect(jobs.run('OWNER', invocation(), task)).rejects.toMatchObject({ code: 'CAPACITY' });
    await Promise.resolve();
    expect(task).toHaveBeenCalledTimes(1);
    expect(secondTask).not.toHaveBeenCalled();
    release();
    await first;
    expect(await second).toBe('second');
  });
  it('expires queued work and retains the slot for an uncooperative transport', async () => {
    vi.useFakeTimers();
    const jobs = new BoundedModelJobs({ concurrency: 1, timeoutMs: 100 });
    let release!: () => void;
    const task = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const first = jobs.run('OWNER', invocation(), task).catch(error => error.code);
    const nextTask = vi.fn(async () => 'must not run');
    const second = jobs.run('OWNER', invocation(), nextTask).catch(error => error.code);
    await vi.advanceTimersByTimeAsync(101);
    expect(await first).toBe('EXPIRED');
    expect(await second).toBe('EXPIRED');
    expect(nextTask).not.toHaveBeenCalled();
    const third = jobs.run('OWNER', invocation(), nextTask).catch(error => error.code);
    await vi.advanceTimersByTimeAsync(101);
    expect(await third).toBe('EXPIRED');
    expect(task).toHaveBeenCalledTimes(1);
    expect(nextTask).not.toHaveBeenCalled();
    release();
  });
  it('kill switch aborts outstanding work and prevents future submissions', async () => {
    const jobs = new BoundedModelJobs();
    let signal!: AbortSignal;
    const pending = jobs.run('NEGOTIATION', invocation(), async input => {
      signal = input;
      await new Promise<void>(resolve => input.addEventListener('abort', () => resolve(), { once: true }));
      return 'late';
    }).catch(error => error.code);
    await Promise.resolve(); await Promise.resolve();
    jobs.stop();
    expect(signal.aborted).toBe(true);
    expect(await pending).toBe('DISABLED');
    await expect(jobs.run('OWNER', invocation(), async () => 'never')).rejects.toMatchObject({ code: 'DISABLED' });
  });
  it('propagates caller abort without exposing the abort reason', async () => {
    const jobs = new BoundedModelJobs();
    const controller = new AbortController();
    const task = vi.fn(async () => 'never');
    const pending = jobs.run('OWNER', { ...invocation(), signal: controller.signal }, task).catch(error => error.message);
    controller.abort('PRIVATE_REASON');
    expect(await pending).toBe('EXPIRED');
    expect(task).not.toHaveBeenCalled();
  });
  it('uses fixed metric fields and ignores telemetry failure', async () => {
    const metric = vi.fn((_value: ModelJobMetric) => { void _value; throw Error('PRIVATE_LOG_FAILURE'); });
    const jobs = new BoundedModelJobs({ metric });
    expect(await jobs.run('OWNER', invocation(), async () => 'secret')).toBe('secret');
    expect(metric.mock.calls[0]).toHaveLength(1);
    expect(JSON.stringify(metric.mock.calls)).not.toContain('secret');
    expect(Object.keys(metric.mock.calls[0]![0] as object).sort()).toEqual(['durationMs', 'kind', 'outcome']);
  });
  it('rejects invalid envelopes, expired deadlines and invalid bounds', async () => {
    const jobs = new BoundedModelJobs();
    await expect(jobs.process({ jobId: 'fake', text: 'secret' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(jobs.run('OWNER', { ...invocation(), expiresAt: NaN }, async () => null)).rejects.toMatchObject({ code: 'EXPIRED' });
    expect(() => new BoundedModelJobs({ concurrency: 5 })).toThrow('Invalid model job bounds');
  });
});
