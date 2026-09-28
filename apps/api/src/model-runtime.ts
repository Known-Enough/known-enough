import { DecisionArchitect, OwnerConversationArchitect, DecisionNegotiator } from '@deal-table/application';
import type { KnownEnoughApplication, Clock, IdSource } from '@deal-table/application';
import { BoundedModelJobs, createAuthorizedBedrockTransport, createBedrockModels } from '@deal-table/adapters';
import type { ConverseTransport, ModelJobMetric, ModelUsage } from '@deal-table/adapters';
import type { KnownEnough as KE } from '@deal-table/contracts';

/** Server-only composition. Existing HTTP handlers authenticate before invoking these services.
 * No environment-variable auto-enable; local fictional mode keeps its deterministic injected ports.
 */
export function createKnownEnoughModelRuntime(options: {
  application: KnownEnoughApplication; clock: Clock; ids: IdSource;
  provider: { mode: 'INJECTED'; transport: ConverseTransport }
    | { mode: 'BEDROCK'; paidCallsApproved: boolean; invocationLoggingDisabled: boolean; retentionReviewed: boolean };
  publicCandidates: (frame: KE.PublicDecisionFrame) => readonly KE.CandidateProposal['values'][];
  metric?: (value: ModelJobMetric) => void; usage?: (value: ModelUsage) => void;
}) {
  let enabled = true;
  const jobs = new BoundedModelJobs({ now: () => Date.parse(options.clock.now()),
    ...(options.metric ? { metric: options.metric } : {}) });
  const transport = options.provider.mode === 'INJECTED'
    ? options.provider.transport : createAuthorizedBedrockTransport(options.provider);
  const models = createBedrockModels({ transport, jobs, enabled: () => enabled,
    ...(options.usage ? { usage: options.usage } : {}) });
  return {
    architect: new DecisionArchitect(models.architect, () => options.ids.next(), () => Date.parse(options.clock.now()), () => enabled),
    ownerConversation: new OwnerConversationArchitect({ application: options.application, model: models.owner, clock: options.clock, ids: options.ids, isEnabled: () => enabled }),
    negotiator: new DecisionNegotiator({ application: options.application, model: models.negotiation, clock: options.clock,
      ids: options.ids, publicCandidates: options.publicCandidates, isEnabled: () => enabled }),
    stop: () => { enabled = false; jobs.stop(); },
    jobs,
  };
}
