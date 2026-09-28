import type { ModelInvocation, ModelCommitGuard } from './model-runtime.ts';
import { KnownEnough as KE } from '@deal-table/contracts';
import type { KnownEnoughApplication } from './known-enough.ts';
import type { Clock, IdSource, TrustedPrincipal } from './types.ts';

const MAX_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 2_000;
const MAX_TOTAL_CHARS = 8_000;
const SAFE_SOURCE_SUMMARY = 'Review the structured conditions below before confirming them.';
const SAFE_CLARIFICATION_QUESTION = 'Please clarify this condition in your own words; it has not been added to the draft.';

export interface OwnerConversationMessage { role: 'owner' | 'assistant'; text: string }
export interface OwnerConversationContext {
  decisionId: string;
  ownerParticipantId: string;
  publicFrame: KE.PublicDecisionFrame;
  ownerPrivateVariables: KE.DecisionVariable[];
  ownerConfirmedConstraints: KE.ConfirmedConstraint[];
  ownerPreviousDraft: KE.AIConstraintDraft | null;
  messages: OwnerConversationMessage[];
}
export interface OwnerConversationInterpretation {
  sourceSummary: string;
  proposedConstraints: KE.AIConstraintDraft['proposedConstraints'];
  unsupportedConditions: KE.AIConstraintDraft['unsupportedConditions'];
}
export type OwnerConversationModel = (context: OwnerConversationContext, invocation?: ModelInvocation) => Promise<unknown>;

export class OwnerConversationError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'FRAME_NOT_CONFIRMED' | 'INVALID_INTERPRETATION') {
    super(code);
    this.name = 'OwnerConversationError';
  }
}

function invalid(): never { throw new OwnerConversationError('INVALID_INPUT'); }
function parseMessages(value: unknown): OwnerConversationMessage[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_MESSAGES) invalid();
  const result: OwnerConversationMessage[] = [];
  let total = 0;
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) invalid();
    const record = item as Record<string, unknown>;
    if (Object.keys(record).sort().join('|') !== 'role|text'
      || (record.role !== 'owner' && record.role !== 'assistant')
      || typeof record.text !== 'string' || record.text.trim().length < 1
      || record.text.length > MAX_MESSAGE_CHARS) invalid();
    total += record.text.length;
    if (total > MAX_TOTAL_CHARS) invalid();
    result.push({ role: record.role, text: record.text });
  }
  if (result.at(-1)?.role !== 'owner') invalid();
  return result;
}

function parseInterpretation(value: unknown): OwnerConversationInterpretation {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new OwnerConversationError('INVALID_INTERPRETATION');
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join('|') !== 'proposedConstraints|sourceSummary|unsupportedConditions'
    || typeof raw.sourceSummary !== 'string' || !Array.isArray(raw.proposedConstraints)
    || !Array.isArray(raw.unsupportedConditions))
    throw new OwnerConversationError('INVALID_INTERPRETATION');
  const parsed = KE.AIConstraintDraft.safeParse({
    schemaVersion: KE.KE_SCHEMA_VERSION,
    draftId: 'draft-placeholder', draftVersion: 0, decisionId: 'decision-placeholder',
    ownerParticipantId: 'owner-placeholder', ownerVersion: 0, semanticVersion: 0,
    contextToken: '0'.repeat(64), sourceSummary: 'Review the conditions below.',
    proposedConstraints: raw.proposedConstraints, unsupportedConditions: raw.unsupportedConditions,
    createdAt: '2026-09-27T00:00:00.000Z',
  });
  if (!parsed.success || raw.sourceSummary.length > 4_000)
    throw new OwnerConversationError('INVALID_INTERPRETATION');
  return {
    sourceSummary: raw.sourceSummary,
    proposedConstraints: parsed.data.proposedConstraints,
    unsupportedConditions: parsed.data.unsupportedConditions,
  };
}

/** Owner-scoped extraction boundary. Raw turns are passed only to the injected model and never stored. */
export class OwnerConversationArchitect {
  constructor(private readonly options: {
    application: KnownEnoughApplication;
    model: OwnerConversationModel;
    clock: Clock;
    ids: IdSource;
    isEnabled?: () => boolean;
  }) {}

  async draft(principal: TrustedPrincipal | null, input: { decisionId: string; messages: unknown }): Promise<KE.AIConstraintDraft> {
    const messages = parseMessages(input.messages);
    const owner = await this.options.application.getOwnerSnapshot(principal, input.decisionId);
    const required = owner.publicSnapshot.frame.requiredParticipantIds;
    const confirmed = new Set(owner.publicSnapshot.frameConfirmations.map(item => item.participantId));
    if (!required.every(participantId => confirmed.has(participantId)) || !confirmed.has(owner.ownerParticipantId))
      throw new OwnerConversationError('FRAME_NOT_CONFIRMED');

    const commitGuard: ModelCommitGuard = {
      principal, controlVersion: owner.controlVersion,
      expiresAt: Date.parse(this.options.clock.now()) + 30_000,
      ...(this.options.isEnabled ? { isEnabled: this.options.isEnabled } : {}),
    };
    const invocation: ModelInvocation = {
      expiresAt: commitGuard.expiresAt,
      assertCurrent: async () => {
        const current = await this.options.application.getOwnerSnapshot(principal, input.decisionId);
        if (this.options.isEnabled?.() === false || Date.parse(this.options.clock.now()) >= commitGuard.expiresAt
          || current.controlVersion !== owner.controlVersion || current.ownerVersion !== owner.ownerVersion
          || current.draftVersion !== owner.draftVersion || current.ownerParticipantId !== owner.ownerParticipantId
          || current.publicSnapshot.contextToken !== owner.publicSnapshot.contextToken
          || current.publicSnapshot.semanticVersion !== owner.publicSnapshot.semanticVersion)
          throw new OwnerConversationError('INVALID_INTERPRETATION');
      },
    };
    const context: OwnerConversationContext = {
      decisionId: input.decisionId,
      ownerParticipantId: owner.ownerParticipantId,
      publicFrame: structuredClone(owner.publicSnapshot.frame),
      ownerPrivateVariables: structuredClone(owner.privateVariables),
      ownerConfirmedConstraints: structuredClone(owner.confirmedConstraints),
      ownerPreviousDraft: owner.draft ? structuredClone(owner.draft) : null,
      messages,
    };
    const interpretation = parseInterpretation(await this.options.model(context, invocation));
    const createdAt = this.options.clock.now();
    if (!Number.isFinite(Date.parse(createdAt))) throw new Error('Invalid application clock');
    const draftId = this.options.ids.next();
    const identifierPrefix = draftId.slice(0, 60);
    const draft = KE.AIConstraintDraft.parse({
      schemaVersion: KE.KE_SCHEMA_VERSION,
      draftId,
      draftVersion: (owner.draftVersion ?? 0) + 1,
      decisionId: input.decisionId,
      ownerParticipantId: owner.ownerParticipantId,
      ownerVersion: owner.ownerVersion,
      semanticVersion: owner.publicSnapshot.semanticVersion,
      contextToken: owner.publicSnapshot.contextToken,
      // Store only a fixed review cue; do not retain the conversation or model's free-text summary.
      sourceSummary: SAFE_SOURCE_SUMMARY,
      proposedConstraints: interpretation.proposedConstraints.map((item, index) => item.kind === 'PREFERENCE'
        ? { ...item, constraintId: `${identifierPrefix}-condition-${index}` }
        : { ...item, constraintId: `${identifierPrefix}-condition-${index}`, rule: { ...item.rule, id: `${identifierPrefix}-rule-${index}` } }),
      unsupportedConditions: interpretation.unsupportedConditions.map((_item, index) => ({
        id: `${identifierPrefix}-clarification-${index}`,
        sourceSummary: 'An owner statement needs clarification.',
        clarificationQuestion: SAFE_CLARIFICATION_QUESTION,
      })),
      createdAt: new Date(createdAt).toISOString(),
    });
    await this.options.application.storeConstraintDraft({
      kind: 'service', subject: 'owner-conversation-interpreter', roomIds: [input.decisionId],
    }, draft, commitGuard);
    return draft;
  }
}
