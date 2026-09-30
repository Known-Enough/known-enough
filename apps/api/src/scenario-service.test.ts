import { describe, expect, it, vi } from 'vitest';
import { DecisionNegotiator, KnownEnoughApplication, type ModelFailureDiagnostic } from '@deal-table/application';
import type { KnownEnough as KE } from '@deal-table/contracts';
import { response } from '../../../tests/evaluations/ke10-injected.ts';
import { createKnownEnoughModelRuntime } from './model-runtime.ts';
import { InMemoryRoomRepository } from '@deal-table/adapters';
import { encodeDecisionStateItem, decodeDecisionStateItem } from '../../../packages/adapters/src/dynamodb-codec.ts';
import { fixedScenarioHarness } from '../../../tests/evaluations/ke14-fixed.ts';
import { readScenarioMembers, scenarioCandidates, ScenarioService } from './scenario-service.ts';
import { readKe13bConfig } from './ke13b-lambda.ts';

const participant = (id: string) => ({ kind: 'participant' as const, subject: `subject-${id}` });
const createBody = (scenario = 'SHARED_PURCHASE') => ({ requestId: 'create-request', idempotencyKey: 'create-key', scenario, objective: 'Synthetic group exploration.' });

async function ready(h: Awaited<ReturnType<typeof fixedScenarioHarness>>, scenario: 'CHRISTMAS' | 'SHARED_PURCHASE') {
  const snapshot = await h.scenarios.create(participant('maya'), createBody(scenario));
  const decisionId = snapshot.frame.decisionId;
  for (const person of snapshot.frame.participants.filter(item => item.id !== 'maya')) {
    const invite = await h.application.issueDecisionInvitation(participant('maya'), decisionId, { requestId: `invite-${person.id}`, participantId: person.id });
    await h.application.redeemDecisionInvitation(participant(person.id), decisionId, { requestId: `redeem-${person.id}`, token: invite.token });
  }
  async function command(person: string, type: string, payload: unknown) {
    const owner = await h.application.getOwnerSnapshot(participant(person), decisionId);
    const requestId = h.ids.next();
    const result = await h.application.execute(participant(person), { schemaVersion: 2, type, payload, requestId, idempotencyKey: requestId, decisionId,
      expected: { controlVersion: owner.controlVersion, ownerVersion: owner.ownerVersion,
        contextToken: owner.publicSnapshot.contextToken, semanticVersion: owner.publicSnapshot.semanticVersion } });
    expect(result.ok).toBe(true);
    return result;
  }
  for (const person of snapshot.frame.participants) await command(person.id, 'CONFIRM_FRAME', { frameVersion: 1 });
  for (const person of snapshot.frame.participants) {
    const draft = await h.runtime.ownerConversation.draft(participant(person.id), { decisionId, messages: [{ role: 'owner',
      text: person.id === 'ana' ? 'Synthetic owner withdraws proximity ambiguity, keeps quiet hotel mandatory. KE14_RAW_MESSAGE_CANARY'
        : 'Synthetic fixture condition. KE14_RAW_MESSAGE_CANARY' }] });
    await command(person.id, 'CONFIRM_CONSTRAINTS', { draftId: draft.draftId, draftVersion: draft.draftVersion, constraintIds: draft.proposedConstraints.map(item => item.constraintId) });
  }
  return { decisionId, command };
}

describe('KE14 authenticated provisioning and trusted catalog composition', () => {
  it.each(['CHRISTMAS', 'SHARED_PURCHASE'] as const)('creates %s from a brief objective with complete structured public scope and no automatic consent', async scenario => {
    const h = await fixedScenarioHarness();
    const requests: { publicVariables: KE.PublicDecisionVariable[] }[] = [];
    const runtime = createKnownEnoughModelRuntime({ application: h.application, clock: h.clock, ids: h.ids,
      publicCandidates: () => [], provider: { mode: 'INJECTED', transport: { send: async command => {
        const input = JSON.parse(command.input.messages![0]!.content![0]!.text!);
        requests.push(input);
        return response({ title: 'Synthetic draft', description: 'Explore together.',
          variableIds: input.publicVariables.map((variable: KE.PublicDecisionVariable) => variable.id),
          rules: [], clarificationQuestions: [], participantInformationRequirements: [{ participantId: 'maya', kind: 'BUDGET' }] });
      } } } });
    const service = new ScenarioService({ application: runtime.application, architect: runtime.architect, members: h.members,
      clock: h.clock, isEnabled: runtime.isEnabled });
    try {
      const snapshot = await service.create(participant('maya'), createBody(scenario));
      expect(snapshot.frame.variables).toEqual(requests[0]!.publicVariables);
      expect(snapshot.frame.requiredParticipantIds).toHaveLength(scenario === 'CHRISTMAS' ? 5 : 3);
      expect(snapshot.frameConfirmations).toEqual([]);
      expect(snapshot.approvedParticipantIds).toEqual([]);
      expect(snapshot.currentProposal).toBeNull();
      expect(JSON.stringify(requests)).not.toMatch(/subject-maya|ownerParticipantId|maya-contribution|privateVariables|confirmedConstraints/);
      expect(await service.create(participant('maya'), createBody(scenario))).toEqual(snapshot);
      expect(requests).toHaveLength(1);
    } finally { await runtime.stop(); await h.runtime.stop(); }
  });
  it.each(['provider', 'envelope', 'fields', 'definition', 'selector', 'persistence'] as const)(
    'distinguishes %s failure with static diagnostics and no private payload or repeated model call', async failure => {
      const h = await fixedScenarioHarness();
      const events: ModelFailureDiagnostic[] = [];
      const send = vi.fn(async command => {
        if (failure === 'provider') throw Error('PRIVATE_PROVIDER_CANARY');
        const input = JSON.parse(command.input.messages![0]!.content![0]!.text!);
        const value = { title: failure === 'fields' ? null : 'Synthetic draft', description: 'PRIVATE_MODEL_CANARY',
          variableIds: failure === 'selector' ? ['guessed'] : input.publicVariables.map((variable: KE.PublicDecisionVariable) => variable.id),
          rules: failure === 'definition' ? [{ id: 'bad-reference', visibility: 'PUBLIC', operator: 'COMPARE',
            variableId: 'PRIVATE_UNKNOWN_VARIABLE', comparison: 'GT', value: { type: 'DURATION', seconds: 0 } }] : [],
          clarificationQuestions: [], participantInformationRequirements: [] };
        return failure === 'envelope' ? { ...response(value), stopReason: 'max_tokens' as const } : response(value);
      });
      const diagnostic = (event: ModelFailureDiagnostic) => { events.push(event); throw Error('PRIVATE_OBSERVER_CANARY'); };
      const runtime = createKnownEnoughModelRuntime({ application: h.application, clock: h.clock, ids: h.ids,
        diagnostic, publicCandidates: () => [], provider: { mode: 'INJECTED', transport: { send } } });
      const service = new ScenarioService({ application: runtime.application, architect: runtime.architect, members: h.members,
        clock: h.clock, isEnabled: runtime.isEnabled, diagnostic });
      if (failure === 'persistence') vi.spyOn(h.application, 'createDecision').mockRejectedValueOnce(Error('PRIVATE_STORAGE_CANARY'));
      const stages = { provider: 'PROVIDER', envelope: 'TOOL_ENVELOPE', fields: 'ARCHITECT_FIELDS',
        definition: 'ARCHITECT_DEFINITION', selector: 'TOOL_OUTPUT', persistence: 'SCENARIO_PERSISTENCE' };
      try {
        await expect(service.create(participant('maya'), createBody())).rejects.toBeDefined();
        expect(send).toHaveBeenCalledTimes(1);
        expect(events).toContainEqual({ kind: 'ARCHITECT', stage: stages[failure] });
        expect(events.every(event => Object.keys(event).sort().join('|') === 'kind|stage')).toBe(true);
        expect(JSON.stringify(events)).not.toMatch(/PRIVATE|subject-|Bearer/);
      } finally { await runtime.stop(); await h.runtime.stop(); }
    });
  it('awaited stop drains an admitted frame creation write before resolving', async () => {
    const h = await fixedScenarioHarness();
    let release!: () => void;
    let entered = false;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const original = h.repository.createDecision.bind(h.repository);
    const spy = vi.spyOn(h.repository, 'createDecision').mockImplementation(async record => {
      entered = true; await barrier; return original(record);
    });
    try {
      const creation = h.scenarios.create(participant('maya'), createBody());
      await vi.waitFor(() => expect(entered).toBe(true));
      let stopped = false;
      const stopping = h.runtime.stop().then(() => { stopped = true; });
      await Promise.resolve();
      expect(stopped).toBe(false);
      release();
      const snapshot = await creation;
      await stopping;
      expect(stopped).toBe(true);
      expect(snapshot.frameConfirmations).toEqual([]);
      expect(snapshot.currentProposal).toBeNull();
      await expect(h.scenarios.create(participant('maya'), { ...createBody(), idempotencyKey: 'after-stop' })).rejects.toBeDefined();
    } finally { release(); spy.mockRestore(); await h.runtime.stop(); }
  });
  it('persists creator-bound replay across codec/cold service state without another provider call, while invitees stay inactive', async () => {
    const h = await fixedScenarioHarness();
    try {
      const snapshot = await h.scenarios.create(participant('maya'), createBody());
      expect(snapshot.frameConfirmations).toEqual([]);
      expect(snapshot.approvedParticipantIds).toEqual([]);
      expect(h.requests).toHaveLength(1);
      const decisionId = snapshot.frame.decisionId;
      const record = (await h.repository.transactionDecision(decisionId, record => record))!;
      const decoded = decodeDecisionStateItem(encodeDecisionStateItem(record), decisionId);
      expect(decoded.creationBodyHash).toMatch(/^[a-f0-9]{64}$/);
      expect(decoded.memberships.filter(item => item.active).map(item => item.participantId)).toEqual(['maya']);
      await expect(h.application.getOwnerSnapshot(participant('leo'), decisionId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const replay = await h.scenarios.create(participant('maya'), { ...createBody(), requestId: 'retry-new-transport-id' });
      expect(replay).toEqual(snapshot);
      expect(h.requests).toHaveLength(1);
      const coldRepository = new InMemoryRoomRepository();
      await coldRepository.createDecision({ ...decoded, replays: [] });
      const coldApplication = new KnownEnoughApplication({ repository: coldRepository, clock: h.clock, ids: h.ids });
      const coldService = new ScenarioService({ application: coldApplication, architect: h.runtime.architect, members: h.members,
        clock: h.clock, isEnabled: h.runtime.isEnabled });
      expect(await coldService.create(participant('maya'), createBody())).toEqual(snapshot);
      expect(h.requests).toHaveLength(1);
      await expect(h.scenarios.create(participant('maya'), { ...createBody(), objective: 'Different objective' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      await h.repository.transactionDecision(decisionId, record => { record!.memberships[0]!.active = false; });
      await expect(h.scenarios.create(participant('maya'), createBody())).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(h.requests).toHaveLength(1);
    } finally { await h.runtime.stop(); }
  });

  it('rejects display, unregistered actors and client-supplied identity bindings before any provider call', async () => {
    const h = await fixedScenarioHarness();
    try {
      for (const actor of [null, { kind: 'display' as const, subject: 'display', roomId: 'room' }, participant('outsider')])
        await expect(h.scenarios.create(actor, createBody())).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(h.scenarios.create(participant('maya'), { ...createBody(), memberships: [{ subject: 'other', active: true }] })).rejects.toMatchObject({ code: 'INVALID_COMMAND' });
      expect(h.requests).toEqual([]);
      expect(() => readScenarioMembers(h.members.map(member => ({ ...member, subject: 'duplicate' })))).toThrow();
    } finally { await h.runtime.stop(); }
  });

  it.each(['CHRISTMAS', 'SHARED_PURCHASE'] as const)('completes %s through the same real ports with private conditional negotiation and unanimous exact approval', async scenario => {
    const h = await fixedScenarioHarness();
    try {
      const { decisionId, command } = await ready(h, scenario);
      const before = await h.runtime.negotiator.generate(participant('maya'), decisionId);
      expect(before.outcome).toBe('NEEDS_PERMISSION');
      expect(before.publicSnapshot.currentProposal).toBeNull();
      const nina = await h.application.getOwnerSnapshot(participant('nina'), decisionId);
      const question = nina.pendingQuestions[0]!;
      await command('nina', 'ANSWER_NEGOTIATION', { questionId: question.questionId, constraintVersion: question.constraintVersion, requestIdentity: question.requestIdentity, answer: 'ALLOW' });
      expect((await h.application.getOwnerSnapshot(participant('nina'), decisionId)).ownApproval).toBeNull();
      const applied = await h.runtime.negotiator.generate(participant('maya'), decisionId);
      expect(applied.outcome).toBe('APPLIED');
      expect(applied.explanation?.kind).toBe('VALIDATED_PUBLIC_VALUES');
      const serialized = JSON.stringify(applied);
      for (const marker of ['permissionId', 'constraintId', 'KE14_RAW_MESSAGE_CANARY', 'maya-contribution', 'leo-contribution', 'nina-contribution']) expect(serialized).not.toContain(marker);
      if (scenario === 'SHARED_PURCHASE') {
        const maya = await h.application.getOwnerSnapshot(participant('maya'), decisionId);
        expect(maya.privateProposalValues?.values).toEqual([{ variableId: 'maya-contribution', value: { type: 'MONEY', amountMinor: 2_500_000, currencyCode: 'USD', minorUnit: 2 } }]);
        const request = h.requests.find(input => 'publicCandidates' in input)!;
        expect(JSON.stringify(request.publicCandidates)).not.toContain('contribution');
        expect(JSON.stringify(request.publicCandidates)).not.toContain('2500000');
      }
      const proposal = applied.publicSnapshot.currentProposal!;
      const people = applied.publicSnapshot.frame.requiredParticipantIds;
      for (const person of people.slice(0, -1)) await command(person, 'APPROVE_PROPOSAL', { proposalId: proposal.proposalId, proposalVersion: proposal.facts.proposalVersion, publicHash: proposal.publicHash });
      expect((await h.application.getPublicSnapshot(participant('maya'), decisionId)).status).toBe('APPROVING');
      await command(people.at(-1)!, 'APPROVE_PROPOSAL', { proposalId: proposal.proposalId, proposalVersion: proposal.facts.proposalVersion, publicHash: proposal.publicHash });
      expect((await h.application.getPublicSnapshot(participant('maya'), decisionId)).status).toBe('AGREED');
      expect(JSON.stringify(await h.repository.transactionDecision(decisionId, record => record))).not.toContain('KE14_RAW_MESSAGE_CANARY');
    } finally { await h.runtime.stop(); }
  });

  it('rejects ambiguous public projections rather than choosing a private assignment silently', async () => {
    const h = await fixedScenarioHarness();
    try {
      const { decisionId } = await ready(h, 'SHARED_PURCHASE');
      let invoked = false;
      const negotiator = new DecisionNegotiator({ application: h.application, clock: h.clock, ids: h.ids,
        trustedCandidates: frame => [scenarioCandidates(frame)[1]!, scenarioCandidates(frame)[1]!.map(item => item.variableId === 'maya-contribution'
          ? { ...item, value: { type: 'MONEY', amountMinor: 2_000_000, currencyCode: 'USD', minorUnit: 2 } } : item)],
        model: async () => { invoked = true; return {}; } });
      await expect(negotiator.generate(participant('maya'), decisionId)).rejects.toMatchObject({ code: 'INVALID_MODEL_OUTPUT' });
      expect(invoked).toBe(false);
    } finally { await h.runtime.stop(); }
  });

  it('keeps paid Lambda model composition disabled without all explicit deployment acknowledgments and valid server bindings', () => {
    const env = { KE13B_TABLE_NAME: 'KnownEnoughStage', AWS_REGION: 'us-east-1', COGNITO_USER_POOL_ID: 'us-east-1_pool',
      COGNITO_PARTICIPANT_CLIENT_ID: 'participant', COGNITO_DISPLAY_CLIENT_ID: 'display', KE13B_ALLOWED_ORIGIN: 'https://app.example.test' };
    expect(readKe13bConfig(env).models).toBeUndefined();
    expect(() => readKe13bConfig({ ...env, KE14_MODEL_MODE: 'BEDROCK' })).toThrow();
    expect(() => readKe13bConfig({ ...env, KE14_MODEL_MODE: 'INJECTED' })).toThrow();
  });
});
