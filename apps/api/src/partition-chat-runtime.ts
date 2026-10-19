import { createHash } from 'node:crypto';
import { AssistantChat as Chat } from '@deal-table/contracts';
import { AssistantChatApplication, KnownEnoughApplicationError, type Clock, type ChatContext, type TrustedPrincipal } from '@deal-table/application';
import { createPartitionDecisionRepository, TransactWriteItemsCommand, partitionIO,
  type PartitionTransport, type PartitionDecisionTransport, type PartitionIOContext } from '@deal-table/adapters/partition-request';
import { createManagedPublicDraftPorts, interpretAssistantChat, DurableModelJobs, DurableJobError,
  type PublicDraftCommit, type PublicDraftFence, type PublicDraftEffect, type PublicDraftAtomicItem,
  type DurableJobStore, type JobPin, type JobReference } from '@deal-table/adapters/durable-model-runtime';
import type { ConverseTransport } from '@deal-table/adapters';
import { stableDeliveryId } from './durable-enqueue.ts';

type Participant = Extract<TrustedPrincipal, { kind: 'participant' }>;
export type ChatRequest = { principal: Participant; decisionId: string; scope: Chat.Scope;
  post?: Chat.Post; requestId?: string; io: PartitionIOContext };
export type AssistantChatRuntime = (input: ChatRequest) => Promise<Chat.Snapshot | Chat.Receipt>;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Request-only execution. A history/status read never dispatches or repeats a provider call. */
export function createPartitionChatRuntime(options: {
  sourceSha: string; groups: PartitionTransport; decisions: PartitionDecisionTransport; decisionArn: string; partitionArn: string;
  retainedDecisions(principal: Participant): PartitionDecisionTransport;
  clock: Clock; prepareDecisionCommit(command: TransactWriteItemsCommand, io: PartitionIOContext): Promise<PublicDraftAtomicItem[]>;
  assertRetained(principal: Participant): Promise<{ expiresAt: string }>;
  acknowledgeSyntheticProcessing(principal: Participant): Promise<void>;
  retentionConditions(principal: Participant): Promise<PublicDraftAtomicItem[]>;
  transport: ConverseTransport; store(commit: PublicDraftCommit): DurableJobStore<PublicDraftFence, PublicDraftEffect>;
  authority(): Promise<JobPin>;
}): AssistantChatRuntime {
  return async ({ principal, decisionId, scope, post, requestId, io }) => {
    const now = () => Date.parse(options.clock.now());
    const phaseIO = () => { const phase = partitionIO({ timeoutMs: 27000 }); return { ...phase, signal: AbortSignal.any([phase.signal, io.signal]) }; };
    const application = (transport = options.decisions) => new AssistantChatApplication(
      createPartitionDecisionRepository({ ...options, transport }).forParticipant(principal, phaseIO()), options.clock);
    // Reading shared chat or an empty private thread does not enroll the viewer in
    // AI processing. Every persisted message already carries its author's deadline.
    // The first explicit send creates/checks the normal retention stamp.
    if (!post && !requestId) return application().read(principal, decisionId, scope);
    if (post) await options.acknowledgeSyntheticProcessing(principal);
    const retention = post ? await options.assertRetained(principal) : undefined;
    const app = application(post ? options.retainedDecisions(principal) : options.decisions);
    const id = post?.requestId ?? requestId!;
    // Save the sender's message once before any paid call, under current access/retention fences.
    const saved = post ? await app.post(principal, decisionId, scope, post, retention!.expiresAt, options.sourceSha) : undefined;
    const conversation = await app.read(principal, decisionId, scope);
    const message = conversation.messages.find(message => message.id === id && message.authorId === conversation.viewerId);
    const receipt = async (state: Chat.Receipt['state']): Promise<Chat.Receipt> => ({ requestId: id, state, conversation: await application().read(principal, decisionId, scope) });
    if (!message) return receipt('NOT_SUBMITTED');
    if (!message.askAssistant) return receipt('POSTED');
    if (conversation.messages.some(message => message.replyTo === id)) return receipt('ANSWERED');
    // A new deployment cannot classify an old accepted/uncertain call as never sent.
    if (message.modelSource !== options.sourceSha) return receipt('UNKNOWN');
    await options.assertRetained(principal);
    const reasoningJobId = 'chat-' + digest([scope, id]).slice(0, 48);
    const jobId = stableDeliveryId(options.sourceSha, decisionId, reasoningJobId);
    const captures = new WeakMap<PublicDraftFence, PublicDraftAtomicItem[]>();
    const store = options.store(async (fence, effect) => {
      const selected = effect?.fence ?? fence, items = captures.get(selected);
      if (!items || selected.kind !== 'ASSISTANT_CHAT' || selected.reference.jobId !== jobId) throw new DurableJobError('INVALID');
      return { items: [...items, ...await options.retentionConditions(principal)], authority: await options.authority() };
    });
    const before = await store.read(jobId);
    const authorityHash = digest([principal.subject, decisionId, scope, id, message.text]);
    const reference: JobReference = before.job?.reference ?? { jobId, kind: 'CHAT', subject: principal.subject, decisionId,
      reasoningJobId, authorityHash, sourceSha: options.sourceSha, expiresAt: now() + 300000, requestKey: id };
    if (reference.kind !== 'CHAT' || reference.subject !== principal.subject || reference.decisionId !== decisionId
      || reference.authorityHash !== authorityHash || reference.requestKey !== id || reference.reasoningJobId !== reasoningJobId) throw new KnownEnoughApplicationError('FORBIDDEN');
    const disposition = (job: typeof before.job): Chat.Receipt['state'] => {
      if (!job) return 'NOT_SUBMITTED';
      if (job.phase === 'SUCCEEDED') return 'ANSWERED';
      if (job.phase === 'DEAD') return job.reason === 'PROVIDER_UNCONFIRMED' ? 'UNKNOWN' : 'UNAVAILABLE';
      if (job.phase === 'CALLING' && ((job.lease?.until ?? 0) <= now() || job.reference.expiresAt <= now())) return 'UNKNOWN';
      return 'PENDING';
    };
    // A replay/status request only observes. Accepted/unknown calls are never resumed here.
    if (!saved?.created || before.job || !before.control.enabled || before.control.sourceSha !== options.sourceSha || before.control.slots.length >= 2 || io.signal.aborted)
      return receipt(disposition(before.job));
    const current = await app.context(principal, decisionId, scope, id);
    async function capture(work: (app: AssistantChatApplication) => Promise<unknown>): Promise<PublicDraftFence> {
      await options.assertRetained(principal);
      let items: PublicDraftAtomicItem[] | undefined;
      const transport: PartitionDecisionTransport = { send: async (command, context) => {
        if (!(command instanceof TransactWriteItemsCommand)) return options.decisions.send(command, context);
        items = await options.prepareDecisionCommit(command, context); return {};
      } };
      await work(application(transport));
      if (!items) throw new DurableJobError('INVALID');
      const fence: PublicDraftFence = { kind: 'ASSISTANT_CHAT', reference }; captures.set(fence, items); return fence;
    }
    let dispatched = false, responded = false;
    const engine = new DurableModelJobs<ChatContext, PublicDraftFence, PublicDraftEffect>({ kind: 'CHAT', store, now,
      bounds: { leaseMs: 25000, timeoutMs: 18000 }, execution: {
        reload: async () => ({ context: current, fence: await capture(async app => {
          if (digest(await app.context(principal, decisionId, scope, id)) !== digest(current)) throw new DurableJobError('STALE');
        }) }),
        invoke: async (context, signal) => {
          try {
            return await interpretAssistantChat({ send: async (command, bounded) => {
              dispatched = true; const response = await options.transport.send(command, bounded); responded = true; return response;
            } }, context, scope, AbortSignal.any([signal, io.signal]));
          } catch (error) {
            // Pre-dispatch validation is a known failure. An uncertain dispatched call stays unknown.
            if (!dispatched) throw new DurableJobError('PROVIDER_REJECTED');
            if (responded) throw new DurableJobError('INVALID_OUTPUT');
            throw error;
          }
        },
        prepare: async (_reference, context, plan) => {
          if (!Chat.Plan.safeParse(plan).success) throw new DurableJobError('INVALID_OUTPUT');
          const fence = await capture(app => app.reply(principal, decisionId, scope, id, plan, context));
          return { kind: 'ASSISTANT_CHAT', fence };
        },
      } });
    try { await engine.enqueue(reference); await engine.process({ jobId }); } catch { /* Read back once; no blind retry. */ }
    return receipt(disposition((await store.read(jobId)).job));
  };
}
export function createManagedPartitionChatRuntime(options: Omit<Parameters<typeof createPartitionChatRuntime>[0], 'transport' | 'store' | 'authority'>) {
  return createPartitionChatRuntime({ ...options, ...createManagedPublicDraftPorts(options.sourceSha) });
}
