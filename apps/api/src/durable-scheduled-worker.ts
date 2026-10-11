import { DeliverySchema } from '@deal-table/adapters/durable-model-runtime';

export const MODEL_JOB_RULE = 'arn:aws:events:us-east-1:092954139775:rule/KnownEnoughModelJobs';
export const MODEL_JOB_FUNCTION = 'arn:aws:lambda:us-east-1:092954139775:function:known-enough-stage-model-jobs';
type Outcome = 'APPLIED' | 'SKIPPED' | 'RETRY' | 'DEAD';
interface Worker { deliveries(): Promise<{ jobId: string }[]>; process(delivery: { jobId: string }): Promise<Outcome> }
export interface JobInvocation { invokedFunctionArn: string; getRemainingTimeInMillis(): number }
export interface JobRunSummary { event: 'model-job-run'; discovered: number; attempted: number; applied: number; skipped: number; retry: number; dead: number; failed: number; deferred: number }
const invalid = (): never => { throw new Error('MODEL_JOB_INVOCATION_INVALID'); };
export function validateJobInvocation(event: unknown, invocation: JobInvocation): void {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return invalid();
  const e = event as Record<string, unknown>;
  if (e.source !== 'aws.events' || e['detail-type'] !== 'Scheduled Event' || e.account !== '092954139775'
    || e.region !== 'us-east-1' || !Array.isArray(e.resources) || e.resources.length !== 1 || e.resources[0] !== MODEL_JOB_RULE
    || !e.detail || typeof e.detail !== 'object' || Array.isArray(e.detail) || Object.keys(e.detail).length !== 0
    || invocation.invokedFunctionArn !== MODEL_JOB_FUNCTION) return invalid();
}
/** Fixed AWS application schedule. No request can supply a worker, job reference or provider input. */
export function createDurableScheduledWorker(options: { worker: Worker; report(summary: JobRunSummary): void }) {
  const worker = options.worker; const report = options.report;
  return async (event: unknown, invocation: JobInvocation): Promise<JobRunSummary> => {
    validateJobInvocation(event, invocation);
    const summary: JobRunSummary = { event: 'model-job-run', discovered: 0, attempted: 0, applied: 0, skipped: 0, retry: 0, dead: 0, failed: 0, deferred: 0 };
    const enoughTime = () => {
      const remaining = invocation.getRemainingTimeInMillis();
      if (!Number.isFinite(remaining) || remaining < 0) return invalid();
      return remaining >= 60000;
    };
    if (!enoughTime()) { report(summary); return summary; }
    // Validate the entire outbox before dispatch. Never process a corrupt prefix of a batch.
    const raw: unknown = await worker.deliveries();
    if (!Array.isArray(raw) || raw.length > 64) return invalid();
    const deliveries = raw.map(value => DeliverySchema.parse(value));
    if (new Set(deliveries.map(value => value.jobId)).size !== deliveries.length) return invalid();
    summary.discovered = deliveries.length;
    for (const delivery of deliveries) {
      if (!enoughTime()) break;
      summary.attempted++;
      try {
        // Await completion; racing a timeout must not abandon a possibly dispatched paid request.
        const result = await worker.process(delivery);
        if (result === 'APPLIED') summary.applied++;
        else if (result === 'SKIPPED') summary.skipped++;
        else if (result === 'RETRY') summary.retry++;
        else if (result === 'DEAD') summary.dead++;
        else summary.failed++;
      } catch { summary.failed++; }
    }
    summary.deferred = summary.discovered - summary.attempted;
    // Retryable/leased work remains durable for the next application tick. No resubmission or refunds.
    report({ ...summary });
    return summary;
  };
}
