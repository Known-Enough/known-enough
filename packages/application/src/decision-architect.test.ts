import { describe, expect, it } from 'vitest';
import { DecisionArchitect, DecisionArchitectError, type DecisionArchitectModel } from './decision-architect.ts';

const request = (revision = 1) => ({
  draftId: 'draft-mvp', revision,
  objective: 'Choose a destination and dates for our family Christmas trip.',
  participants: [
    { id: 'person-1', displayName: 'Maya' }, { id: 'person-2', displayName: 'Leo' },
    { id: 'person-3', displayName: 'Nina' }, { id: 'person-4', displayName: 'Ana' },
    { id: 'person-5', displayName: 'Raul' },
  ],
  allowedOptions: ['Cancún', 'Oaxaca', 'Mazatlán'],
});

function christmasDraft() {
  return {
    title: 'Family Christmas trip',
    description: 'Compare a few destinations and dates together.',
    variables: [
      { id: 'destination', type: 'ENUM', label: 'Destination', required: true, visibility: 'PUBLIC', ownerParticipantId: null,
        options: [{ id: 'cancun', label: 'Cancún' }, { id: 'oaxaca', label: 'Oaxaca' }, { id: 'mazatlan', label: 'Mazatlán' }] },
      { id: 'trip-start', type: 'DATE', label: 'Trip start', required: true, visibility: 'PUBLIC', ownerParticipantId: null },
      { id: 'trip-duration', type: 'DURATION', unit: 'SECONDS', label: 'Trip duration', required: true, visibility: 'PUBLIC', ownerParticipantId: null },
    ],
    rules: [{ id: 'positive-duration', visibility: 'PUBLIC', operator: 'COMPARE', variableId: 'trip-duration',
      comparison: 'GT', value: { type: 'DURATION', seconds: 0 } }],
    clarificationQuestions: ['Which date range should the group consider?'],
    participantInformationRequirements: [
      { participantId: 'person-1', kind: 'DATES' },
      { participantId: 'person-2', kind: 'DATES' },
      { participantId: 'person-3', kind: 'DATES' },
      { participantId: 'person-4', kind: 'DATES' },
      { participantId: 'person-5', kind: 'DATES' },
    ],
  };
}

function create(model: DecisionArchitectModel) {
  let id = 0;
  return new DecisionArchitect(model, () => `architect-${++id}`);
}

describe('injected decision architect', () => {
  it('drafts a contract-valid public frame and asks for clarification without confirming it', async () => {
    let received: unknown;
    const architect = create({ draft: async input => { received = input; return christmasDraft(); } });
    const result = await architect.draft('organizer', request());

    expect(received).toEqual({
      objective: request().objective,
      participants: request().participants,
      allowedOptions: request().allowedOptions,
    });
    expect(result.status).toBe('NEEDS_CLARIFICATION');
    expect(result.frame.title).toBe('Family Christmas trip');
    expect(result.frame.participants.map(person => person.displayName)).toEqual(['Maya', 'Leo', 'Nina', 'Ana', 'Raul']);
    expect(result.frame.variables.find(variable => variable.id === 'destination')).toMatchObject({
      visibility: 'PUBLIC', type: 'ENUM', options: [{ label: 'Cancún' }, { label: 'Oaxaca' }, { label: 'Mazatlán' }],
    });
    expect(result.frame.rules).toHaveLength(1);
    expect(result.clarificationQuestions).toEqual(['Which date range should the group consider?']);
    expect(result.participantInformationRequirements).toHaveLength(5);
    expect(result.participantInformationRequirements[0]?.prompt).toBe('Share dates or times that do not work for you privately.');
    expect(result.frame.contextToken).toMatch(/^[a-f0-9]{64}$/);
    expect(result.frame.frameVersion).toBe(1);
    expect(JSON.stringify(result.frame)).not.toContain('ownerParticipantId');
  });

  it('fills server-owned public metadata and a missing enum option ID before strict validation', async () => {
    const base = christmasDraft();
    const destinationInput = base.variables.find(variable => variable.id === 'destination');
    if (!destinationInput || destinationInput.type !== 'ENUM' || !Array.isArray(destinationInput.options))
      throw new Error('Missing synthetic destination variable');
    const modelOutput = { ...base, variables: [
      { ...destinationInput, ownerParticipantId: 'untrusted-owner', options: [
        ...destinationInput.options.slice(0, 2), { label: 'Mazatlán' },
      ] },
      { ...base.variables[1], ownerParticipantId: 'untrusted-owner' },
      base.variables[2],
    ] };
    const result = await create({ draft: async () => modelOutput }).draft('organizer', request());
    const destination = result.frame.variables.find(variable => variable.id === 'destination');
    expect(destination?.type).toBe('ENUM');
    if (destination?.type === 'ENUM') expect(destination.options[2]?.id).toBe('ke-option-1-3');
    expect(result.frame.variables.every(variable => !Object.hasOwn(variable, 'ownerParticipantId'))).toBe(true);
    expect(JSON.stringify(result.frame)).not.toContain('untrusted-owner');
  });

  it('rejects malformed or extra model fields and never trusts model-supplied participants', async () => {
    const malformed = create({ draft: async () => '{not json' });
    await expect(malformed.draft('organizer', request())).rejects.toMatchObject({ code: 'RETRYABLE_SERVER_ERROR' });

    const inventedParticipant = create({ draft: async () => ({ ...christmasDraft(), participantInformationRequirements: [
      { participantId: 'uninvited', kind: 'DATES' },
    ] }) });
    await expect(inventedParticipant.draft('organizer', request())).rejects.toMatchObject({ code: 'RETRYABLE_SERVER_ERROR' });

    const participantOverride = create({ draft: async () => ({ ...christmasDraft(), participants: [] }) });
    await expect(participantOverride.draft('organizer', request())).rejects.toMatchObject({ code: 'RETRYABLE_SERVER_ERROR' });

    const privateLeak = create({ draft: async () => ({ ...christmasDraft(), participantInformationRequirements: [
      { participantId: 'person-1', kind: 'MAYA_BUDGET_IS_2000' },
    ] }) });
    await expect(privateLeak.draft('organizer', request())).rejects.toMatchObject({ code: 'RETRYABLE_SERVER_ERROR' });
  });

  it('rejects invented public options, unsupported operators and inconsistent references', async () => {
    const inventedOption = create({ draft: async () => ({ ...christmasDraft(), variables: [
      { id: 'destination', type: 'ENUM', label: 'Destination', required: true, visibility: 'PUBLIC', ownerParticipantId: null,
        options: [{ id: 'moon', label: 'The Moon' }] },
    ] }) });
    await expect(inventedOption.draft('organizer', request())).rejects.toMatchObject({ code: 'RETRYABLE_SERVER_ERROR' });

    const unsupported = create({ draft: async () => ({ ...christmasDraft(), rules: [
      { id: 'unsafe-rule', visibility: 'PUBLIC', operator: 'EXECUTE', expression: 'true' },
    ] }) });
    await expect(unsupported.draft('organizer', request())).rejects.toMatchObject({ code: 'RETRYABLE_SERVER_ERROR' });

    const inconsistent = create({ draft: async () => ({ ...christmasDraft(), rules: [
      { id: 'unknown-reference', visibility: 'PUBLIC', operator: 'COMPARE', variableId: 'invented-variable',
        comparison: 'GT', value: { type: 'DURATION', seconds: 0 } },
    ] }) });
    await expect(inconsistent.draft('organizer', request())).rejects.toMatchObject({ code: 'RETRYABLE_SERVER_ERROR' });
  });

  it('drops an older result when a newer revision for the same draft finishes first', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    let resolveSecond: ((value: unknown) => void) | undefined;
    let calls = 0;
    const architect = create({ draft: async () => new Promise(resolve => {
      calls++;
      if (calls === 1) resolveFirst = resolve;
      else resolveSecond = resolve;
    }) });
    const first = architect.draft('organizer', request(1));
    const second = architect.draft('organizer', request(2));
    resolveSecond?.(christmasDraft());
    await expect(second).resolves.toMatchObject({ revision: 2, status: 'NEEDS_CLARIFICATION' });
    resolveFirst?.(christmasDraft());
    await expect(first).rejects.toBeInstanceOf(DecisionArchitectError);
    await expect(first).rejects.toMatchObject({ code: 'STALE_CONTEXT' });
  });
});
