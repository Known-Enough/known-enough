import { reportModelFailure } from '@deal-table/application';
import { AsyncResource } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { ModelInvocation, ModelJobKind, ModelJobRunner, ModelFailureDiagnostic } from '@deal-table/application';

export class ModelRuntimeError extends Error {
  constructor(readonly code: 'DISABLED' | 'CAPACITY' | 'STALE' | 'EXPIRED' | 'PROVIDER_FAILED' | 'INVALID_OUTPUT' | 'INVALID_INPUT') {
    super(code);
    this.name = 'ModelRuntimeError';
  }
}
export interface ModelJobEnvelope { jobId: string }
export interface ModelJobMetric { kind: ModelJobKind; outcome: 'SUCCEEDED' | 'FAILED'; durationMs: number }
interface Entry {
  kind: ModelJobKind;
  invocation: ModelInvocation;
  task: (signal: AbortSignal) => Promise<unknown>;
  resolve(value: unknown): void;
  reject(error: ModelRuntimeError): void;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  dispose(): void;
  running: boolean;
  started: number;
}
/** Process-local queue. Payloads exist only in transient closures, never in envelopes or telemetry.
 * Restart loses outstanding work; clients resubmit. This is not a distributed queue lease.
 */
export class BoundedModelJobs implements ModelJobRunner {
  private readonly entries = new Map<string, Entry>();
  private readonly queue: ModelJobEnvelope[] = [];
  private running = 0;
  private enabled = true;
  private readonly concurrency: number;
  private readonly capacity: number;
  constructor(private readonly options: {
    concurrency?: number; capacity?: number; timeoutMs?: number;
    diagnostic?: (value: ModelFailureDiagnostic) => void;
    now?: () => number; metric?: (value: ModelJobMetric) => void;
  } = {}) {
    this.concurrency = options.concurrency ?? 2;
    this.capacity = options.capacity ?? 32;
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1 || this.concurrency > 4
      || !Number.isInteger(this.capacity) || this.capacity < this.concurrency || this.capacity > 64
      || !Number.isInteger(options.timeoutMs ?? 8_000) || (options.timeoutMs ?? 8_000) < 100
      || (options.timeoutMs ?? 8_000) > 30_000) throw new Error('Invalid model job bounds');
  }
  private now(): number { return this.options.now?.() ?? Date.now(); }
  /** Cancels queued/running callers and aborts provider requests. Re-enable requires a new runtime. */
  stop(): void {
    this.enabled = false;
    for (const id of this.entries.keys()) this.finish(id, new ModelRuntimeError('DISABLED'));
  }
  run(kind: ModelJobKind, invocation: ModelInvocation, task: (signal: AbortSignal) => Promise<unknown>): Promise<unknown> {
    if (!this.enabled) return Promise.reject(new ModelRuntimeError('DISABLED'));
    if (this.entries.size + this.running >= this.capacity) return Promise.reject(new ModelRuntimeError('CAPACITY'));
    const duration = Math.min(invocation.expiresAt - this.now(), this.options.timeoutMs ?? 8_000);
    if (!Number.isFinite(duration) || duration <= 0 || invocation.signal?.aborted)
      return Promise.reject(new ModelRuntimeError('EXPIRED'));
    const jobId = randomUUID();
    return new Promise((resolve, reject) => {
      const abort = () => this.finish(jobId, new ModelRuntimeError('EXPIRED'));
      const entry: Entry = {
        kind, invocation: { ...invocation, assertCurrent: AsyncResource.bind(invocation.assertCurrent) }, task: AsyncResource.bind(task), resolve, reject, running: false, started: this.now(),
        controller: new AbortController(), timer: setTimeout(() => {
          if (this.entries.has(jobId)) reportModelFailure(this.options.diagnostic, kind, 'MODEL_DEADLINE');
          abort();
        }, duration),
        dispose: () => invocation.signal?.removeEventListener('abort', abort),
      };
      this.entries.set(jobId, entry);
      invocation.signal?.addEventListener('abort', abort, { once: true });
      this.queue.push({ jobId });
      queueMicrotask(() => this.pump());
    });
  }
  private finish(id: string, error?: ModelRuntimeError, value?: unknown): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    const index = this.queue.findIndex(item => item.jobId === id);
    if (index !== -1) this.queue.splice(index, 1);
    clearTimeout(entry.timer);
    entry.dispose();
    entry.controller.abort();
    try { this.options.metric?.({ kind: entry.kind, outcome: error ? 'FAILED' : 'SUCCEEDED',
      durationMs: Math.max(0, this.now() - entry.started) }); } catch { /* Telemetry has no authority. */ }
    if (error) entry.reject(error); else entry.resolve(value);
  }
  private pump(): void {
    while (this.enabled && this.running < this.concurrency && this.queue.length) {
      const message = this.queue.shift()!;
      void this.process(message);
    }
  }
  /** Strict ID-only delivery boundary. Unknown/replayed deliveries have no effect. */
  async process(message: unknown): Promise<void> {
    if (!message || typeof message !== 'object' || Array.isArray(message)
      || Object.keys(message).join('|') !== 'jobId' || !('jobId' in message)
      || typeof message.jobId !== 'string' || !/^[0-9a-f-]{36}$/.test(message.jobId))
      throw new ModelRuntimeError('INVALID_INPUT');
    const id = message.jobId;
    const entry = this.entries.get(id);
    if (!entry || entry.running || !this.enabled || this.running >= this.concurrency) return;
    entry.running = true;
    this.running++;
    try {
      await entry.invocation.assertCurrent();
      if (!this.entries.has(id) || this.now() >= entry.invocation.expiresAt) throw new ModelRuntimeError('EXPIRED');
      const value = await entry.task(entry.controller.signal);
      await entry.invocation.assertCurrent();
      if (!this.entries.has(id) || this.now() >= entry.invocation.expiresAt) throw new ModelRuntimeError('EXPIRED');
      this.finish(id, undefined, value);
    } catch (error) {
      this.finish(id, error instanceof ModelRuntimeError ? error : new ModelRuntimeError('STALE'));
    } finally {
      // Keep the slot until an aborted transport actually settles, bounding hung providers too.
      this.running--;
      this.pump();
    }
  }
}
