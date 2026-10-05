import { DecisionArchitect, OwnerConversationArchitect, DecisionNegotiator } from '@deal-table/application';
import type { KnownEnoughApplication, Clock, IdSource, ModelFailureDiagnostic } from '@deal-table/application';
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
  trustedCandidates?: (frame: KE.PublicDecisionFrame) => readonly KE.CandidateProposal['values'][];
  metric?: (value: ModelJobMetric) => void; usage?: (value: ModelUsage) => void;
  diagnostic?: (value: ModelFailureDiagnostic) => void;
}) {
  let enabled = true;
  let stopping: Promise<void> | undefined;
  const outputWrites = new Set<Promise<unknown>>();
  const trackOutputWrite = <T>(write: () => Promise<T>): Promise<T> => {
    const pending = Promise.resolve().then(write);
    outputWrites.add(pending);
    void pending.then(() => outputWrites.delete(pending), () => outputWrites.delete(pending));
    return pending;
  };
  const modelApplication = new Proxy(options.application, {
    get(target, property, receiver) {
      if (property === 'createDecision')
        return (...args: Parameters<typeof target.createDecision>) => trackOutputWrite(() => target.createDecision(...args));
      if (property === 'completeReasoning')
        return (...args: Parameters<typeof target.completeReasoning>) => trackOutputWrite(() => target.completeReasoning(...args));
      if (property === 'storeConstraintDraft')
        return (...args: Parameters<typeof target.storeConstraintDraft>) => trackOutputWrite(() => target.storeConstraintDraft(...args));
      if (property === 'askNegotiation')
        return (...args: Parameters<typeof target.askNegotiation>) => trackOutputWrite(() => target.askNegotiation(...args));
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const jobs = new BoundedModelJobs({ now: () => Date.parse(options.clock.now()),
    ...(options.metric ? { metric: options.metric } : {}) });
  const transport = options.provider.mode === 'INJECTED'
    ? options.provider.transport : createAuthorizedBedrockTransport(options.provider);
  const models = createBedrockModels({ transport, jobs, enabled: () => enabled,
    ...(options.usage ? { usage: options.usage } : {}), ...(options.diagnostic ? { diagnostic: options.diagnostic } : {}) });
  const stop = (): Promise<void> => {
    enabled = false;
    jobs.stop();
    stopping ??= (async () => {
      while (outputWrites.size > 0) await Promise.allSettled([...outputWrites]);
    })();
    return stopping;
  };
  return {
    application: modelApplication,
    isEnabled: () => enabled,
    architect: new DecisionArchitect(models.architect, () => options.ids.next(), () => Date.parse(options.clock.now()), () => enabled,
      options.diagnostic),
    ownerConversation: new OwnerConversationArchitect({ application: modelApplication, model: models.owner, clock: options.clock, ids: options.ids, isEnabled: () => enabled }),
    negotiator: new DecisionNegotiator({ application: modelApplication, model: models.negotiation, clock: options.clock,
      ids: options.ids, publicCandidates: options.publicCandidates,
      ...(options.trustedCandidates ? { trustedCandidates: options.trustedCandidates } : {}), ...(options.diagnostic ? { diagnostic: options.diagnostic } : {}), isEnabled: () => enabled }),
    stop,
    jobs,
  };
}
