import type { BoundedModelJobs } from '@deal-table/adapters';

/** Worker delivery contains only the opaque job ID. No logging or automatic redrive of private input. */
export function createModelWorker(jobs: BoundedModelJobs): (message: unknown) => Promise<void> {
  return message => jobs.process(message);
}
