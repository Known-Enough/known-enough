import { describe, expect, it, vi } from 'vitest';
import { KnownEnough as KE } from '@deal-table/contracts';
import { buildChristmasFixture } from '../../test-support/src/known-enough-fixtures.ts';
import type { TrustedPrincipal } from './types.ts';
import { KnownEnoughApplication } from './known-enough.ts';
import { InMemoryRoomRepository } from '@deal-table/adapters';
import { OwnerConversationArchitect } from './owner-conversation.ts';

const decisionId = 'christmas-decision';
const principal = (subject: string): TrustedPrincipal => ({ kind: 'participant', subject: `subject-${subject}` });

async function setup(confirmFrame = true) {
  let sequence = 0;
  const fixture = buildChristmasFixture();
  const application = new KnownEnoughApplication({
    repository: new InMemoryRoomRepository(),
    clock: { now: () => '2026-10-01T12:00:00.000Z' },
    ids: { next: () => `owner-conversation-${++sequence}` },
  });
  await application.createDecision({
    definition: fixture.definition, creatorSubject: 'subject-maya',
    memberships: fixture.definition.participants.map(item => ({ subject: `subject-${item.id}`, participantId: item.id, active: true })),
  });
  for (const participantId of confirmFrame ? fixture.definition.requiredParticipantIds : []) {
    const owner = await application.getOwnerSnapshot(principal(participantId), decisionId);
    const result = await application.execute(principal(participantId), {
      schemaVersion: KE.KE_SCHEMA_VERSION, type: 'CONFIRM_FRAME', requestId: `confirm-${participantId}`,
      decisionId, idempotencyKey: `confirm-frame-${participantId}`,
      expected: {
        contextToken: owner.publicSnapshot.contextToken,
        semanticVersion: owner.publicSnapshot.semanticVersion,
        controlVersion: owner.controlVersion, ownerVersion: owner.ownerVersion,
      },
      payload: { frameVersion: fixture.definition.frameVersion },
    });
    expect(result.ok).toBe(true);
  }
  return { application, fixture };
}

const emptyInterpretation = (clarificationQuestion: string) => ({
  sourceSummary: 'Ignored free-text summary.', proposedConstraints: [],
  unsupportedConditions: [{ id: 'needs-clarification', sourceSummary: 'raw private text must not persist', clarificationQuestion }],
});

describe('OwnerConversationArchitect', () => {
  it('uses the authenticated owner context and stores only a private, structured draft without raw turns', async () => {
    const h = await setup();
    const privateText = 'I cannot disclose the personal reason, but my absolute maximum is $2,000.';
    let seenOwner = '';
    let seenMessages = '';
    const architect = new OwnerConversationArchitect({
      application: h.application,
      model: async context => {
        seenOwner = context.ownerParticipantId;
        seenMessages = context.messages.map(message => message.text).join('\n');
        return emptyInterpretation('What numeric limit should I record?');
      },
      clock: { now: () => '2026-10-01T12:00:00.000Z' },
      ids: { next: () => 'maya-private-draft' },
    });

    const draft = await architect.draft(principal('maya'), {
      decisionId, messages: [{ role: 'owner', text: privateText }],
    });
    const stored = await h.application.getOwnerSnapshot(principal('maya'), decisionId);
    const other = await h.application.getOwnerSnapshot(principal('leo'), decisionId);
    expect(seenOwner).toBe('maya');
    expect(seenMessages).toBe(privateText);
    expect(draft.sourceSummary).toBe('Review the structured conditions below before confirming them.');
    expect(draft.unsupportedConditions[0]?.sourceSummary).toBe('An owner statement needs clarification.');
    expect(JSON.stringify(stored)).not.toContain(privateText);
    expect(stored.draft?.draftId).toBe('maya-private-draft');
    expect(other.draft).toBeNull();
  });

  it('never loads another owner conversation into model context', async () => {
    const h = await setup();
    const observed: string[] = [];
    const architect = new OwnerConversationArchitect({
      application: h.application,
      model: async context => {
        observed.push(`${context.ownerParticipantId}:${JSON.stringify(context.ownerPreviousDraft)}:${context.messages.map(item => item.text).join('|')}`);
        return emptyInterpretation('Please clarify this condition.');
      },
      clock: { now: () => '2026-10-01T12:00:00.000Z' },
      ids: { next: (() => { let n = 0; return () => `isolated-draft-${++n}`; })() },
    });
    await architect.draft(principal('leo'), {
      decisionId, messages: [{ role: 'owner', text: 'LEO_SECRET_CONVERSATION' }],
    });
    await architect.draft(principal('maya'), {
      decisionId, messages: [{ role: 'owner', text: 'MAYA_PRIVATE_INPUT' }],
    });
    expect(observed).toHaveLength(2);
    expect(observed[1]).toContain('maya:null:MAYA_PRIVATE_INPUT');
    expect(observed[1]).not.toContain('LEO_SECRET_CONVERSATION');
  });

  it('rejects wrong-owner, cross-decision, incomplete-frame and oversized requests before extraction', async () => {
    const h = await setup();
    const model = vi.fn(async () => emptyInterpretation('Please clarify.'));
    const architect = new OwnerConversationArchitect({
      application: h.application, model,
      clock: { now: () => '2026-10-01T12:00:00.000Z' }, ids: { next: () => 'unused-draft' },
    });
    const messages = [{ role: 'owner', text: 'A synthetic private statement.' }];
    await expect(architect.draft(principal('outsider'), { decisionId, messages })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(architect.draft(principal('maya'), { decisionId: 'other-decision', messages })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(architect.draft(principal('maya'), { decisionId, messages: [{ role: 'owner', text: 'x'.repeat(2_001) }] }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(architect.draft(null, { decisionId, messages })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(model).not.toHaveBeenCalled();
  });

  it('requires explicit current frame confirmations and rejects invented metadata or malformed interpretations', async () => {
    const h = await setup();
    const model = vi.fn(async () => ({
      ...emptyInterpretation('Please clarify.'),
      decisionId,
    }));
    const architect = new OwnerConversationArchitect({
      application: h.application, model,
      clock: { now: () => '2026-10-01T12:00:00.000Z' }, ids: { next: () => 'unused-draft' },
    });
    await expect(architect.draft(principal('maya'), {
      decisionId, messages: [{ role: 'assistant', text: 'What should I capture?' }, { role: 'owner', text: 'A synthetic response.' }],
    })).rejects.toMatchObject({ code: 'INVALID_INTERPRETATION' });
    expect(model).toHaveBeenCalledTimes(1);
  });

  it('does not invoke extraction until every required participant confirmed the current frame', async () => {
    const h = await setup(false);
    const model = vi.fn(async () => emptyInterpretation('Please clarify.'));
    const architect = new OwnerConversationArchitect({
      application: h.application, model,
      clock: { now: () => '2026-10-01T12:00:00.000Z' }, ids: { next: () => 'unused-draft' },
    });
    await expect(architect.draft(principal('maya'), {
      decisionId, messages: [{ role: 'owner', text: 'A synthetic private statement.' }],
    })).rejects.toMatchObject({ code: 'FRAME_NOT_CONFIRMED' });
    expect(model).not.toHaveBeenCalled();
  });
});

it('KE09 replaces model identifiers that encode private text before persistence', async () => {
  const h = await setup();
  const canary = 'RAW_PRIVATE_CANARY';
  const architect = new OwnerConversationArchitect({
    application: h.application, clock: { now: () => '2026-10-01T12:00:00.000Z' }, ids: { next: () => 'server-draft-id' },
    model: async () => ({ sourceSummary: canary, proposedConstraints: [{ constraintId: canary, kind: 'HARD',
      rule: { id: canary, visibility: 'TRUSTED_BACKEND', operator: 'COMPARE', variableId: 'estimated-total', comparison: 'LTE',
        value: { type: 'MONEY', amountMinor: 160_000, currencyCode: 'USD', minorUnit: 2 } } }],
      unsupportedConditions: [{ id: canary, sourceSummary: canary, clarificationQuestion: canary }],
    }),
  });
  const draft = await architect.draft(principal('maya'), { decisionId, messages: [{ role: 'owner', text: canary }] });
  expect(JSON.stringify(draft)).not.toContain(canary);
  expect(JSON.stringify(await h.application.getOwnerSnapshot(principal('maya'), decisionId))).not.toContain(canary);
  expect(draft.proposedConstraints[0]?.constraintId).toBe('server-draft-id-condition-0');
});
