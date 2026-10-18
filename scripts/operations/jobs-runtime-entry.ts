import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BedrockClient, GetModelInvocationLoggingConfigurationCommand } from '@aws-sdk/client-bedrock';
import { genericCandidates } from '@deal-table/adapters';
import { createManagedDurableNegotiationWorker } from '../../apps/api/src/durable-model-worker.ts';
import { createDurableScheduledWorker, validateJobInvocation, type JobInvocation } from '../../apps/api/src/durable-scheduled-worker.ts';
import { loadJobsPackage } from './jobs-package.ts';
/** Dedicated function only. Provider content is never logged, and each invocation rechecks actual logging configuration. */
export async function handler(event: unknown, context: JobInvocation) {
  try {
    validateJobInvocation(event, context);
    const config = loadJobsPackage(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'jobs-private.json')));
    const client = new BedrockClient({ region: 'us-east-1', endpoint: 'https://bedrock.us-east-1.amazonaws.com', maxAttempts: 1 });
    const { loggingConfig } = await client.send(new GetModelInvocationLoggingConfigurationCommand({}), { abortSignal: AbortSignal.timeout(5000) });
    if (loggingConfig && [loggingConfig.textDataDeliveryEnabled, loggingConfig.imageDataDeliveryEnabled,
      loggingConfig.embeddingDataDeliveryEnabled, loggingConfig.videoDataDeliveryEnabled].some(value => value !== undefined && value !== false)) {
      throw new Error('MODEL_JOB_LOGGING_ENABLED');
    }
    // Native loader still independently joins current AUTH, all-member retention, admission and consent.
    const worker = createManagedDurableNegotiationWorker({ verifiedTarget: { account: '092954139775', region: 'us-east-1' }, sourceSha: config.sourceSha,
      approval: { paidCallsApproved: true, invocationLoggingDisabled: true, retentionReviewed: true }, publicCandidates: genericCandidates,
      reportInvalidOutput: stage => console.warn(JSON.stringify({ event: 'model-job-output-invalid', stage })),
      reportFailure: value => console.warn(JSON.stringify({ event: 'model-job-failure', ...value })) });
    return await createDurableScheduledWorker({ worker, report: summary => console.info(JSON.stringify(summary)) })(event, context);
  } catch {
    console.warn(JSON.stringify({ event: 'model-job-run', result: 'UNAVAILABLE' }));
    throw new Error('MODEL_JOB_RUN_UNAVAILABLE');
  }
}
