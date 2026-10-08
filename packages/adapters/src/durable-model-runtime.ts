// Server-only inactive OPS03 composition exports; browser imports remain prohibited.
export * from './durable-model-jobs.ts';
export * from './dynamo-model-jobs.ts';
export { decodeDecisionStateItem, encodeDecisionStateItem, validateDecisionStateGuard } from './dynamodb-codec.ts';
export { RetentionPolicy, RetentionStamp, retentionDeadline } from './partition-lifecycle.ts';

import { createAuthorizedBedrockTransport, createBedrockModels, type ConverseTransport } from './bedrock-models.ts';
import { DurableJobError } from './durable-model-jobs.ts';
import type { DecisionNegotiationModel } from '@deal-table/application';
/** Existing forced-tool parser and one-attempt SDK; usage belongs to this invocation, never a shared callback. */
export function createDurableBedrockNegotiation(options: { transport?: ConverseTransport;
  approval: { paidCallsApproved: boolean; invocationLoggingDisabled: boolean; retentionReviewed: boolean }; enabled: () => boolean }) {
  const authorized = createAuthorizedBedrockTransport(options.approval);
  const transport = options.transport ?? authorized;
  return async (input: Parameters<DecisionNegotiationModel>[0]) => {
    let usage: { inputTokens: number; outputTokens: number } | null = null;
    const models = createBedrockModels({ transport, enabled: options.enabled, usage: value => {
      if (value.kind !== 'NEGOTIATION') throw new DurableJobError('INVALID'); usage = { inputTokens: value.inputTokens, outputTokens: value.outputTokens };
    }, jobs: { async run(kind, invocation, task) {
      if (kind !== 'NEGOTIATION' || input.signal.aborted || !options.enabled()) throw new DurableJobError('DISABLED');
      await invocation.assertCurrent(); const result = await task(input.signal); await invocation.assertCurrent(); return result;
    } } });
    const output = await models.negotiation(input); if (!usage) throw new DurableJobError('INVALID_OUTPUT'); return { output, usage };
  };
}
