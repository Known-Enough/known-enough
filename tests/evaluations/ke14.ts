import assert from 'node:assert/strict';
import { KnownEnough as KE } from '@deal-table/contracts';
import { KnownEnoughApplication, type TrustedPrincipal } from '@deal-table/application';
import { InMemoryRoomRepository } from '@deal-table/adapters';
import type { ConverseCommand, ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import { createKnownEnoughModelRuntime } from '../../apps/api/src/model-runtime.ts';
import { buildChristmasFixture, buildChristmasPublicCandidates,
  buildHypotheticalContributionFixture } from '../../packages/test-support/src/known-enough-fixtures.ts';

export const canary = 'KE14_SYNTHETIC_OWNER_MESSAGE_DO_NOT_PUBLISH';
export const principal = (id: string): TrustedPrincipal => ({ kind: 'participant', subject: `ke14-${id}` });
const now = '2026-10-01T12:00:00.000Z';
const response = (command: ConverseCommand, output: unknown): ConverseCommandOutput => ({
  $metadata: {}, usage: undefined, metrics: undefined, stopReason: 'tool_use', output: { message: { role: 'assistant', content: [{ toolUse: {
    toolUseId: 'ke14-scripted-output', name: command.input.toolConfig!.tools![0]!.toolSpec!.name!, input: output as never,
  } }] } },
});

/** Offline qualification only: scripted transport, real model adapters/application/kernel.
 * No provider call, fabricated usage metrics, cloud identity or deployed acceptance. */
export async function setupScenario(kind: 'christmas' | 'purchase', clarifyAna = true, flexiblePurchase = false) {
  let sequence = 0;
  const ids = { next: () => `ke14-${++sequence}` };
  const clock = { now: () => now };
  const repository = new InMemoryRoomRepository();
  const application = new KnownEnoughApplication({ repository, ids, clock });
  const christmas = buildChristmasFixture();
  const purchase = await buildHypotheticalContributionFixture();
  let definition = kind === 'christmas' ? christmas.definition : purchase.definition;
  let ownerClarified = clarifyAna;
  let providerCalls = 0;
  const runtime = createKnownEnoughModelRuntime({ application, ids, clock,
    publicCandidates: kind === 'christmas' ? buildChristmasPublicCandidates
      : () => [purchase.candidate.values.filter(item => item.variableId.endsWith('-ownership'))],
    provider: { mode: 'INJECTED', transport: { send: async command => {
      providerCalls++;
      const input = JSON.parse(command.input.messages![0]!.content![0]!.text!) as Record<string, unknown>;
      const prompt = command.input.system![0]!.text!;
      if (prompt.includes('Construct only')) return response(command, {
        title: christmas.definition.title, description: christmas.definition.description,
        variables: christmas.definition.variables, rules: christmas.definition.rules,
        clarificationQuestions: [], participantInformationRequirements: [],
      });
      if (prompt.includes('Extract only')) {
        const person = input.ownerParticipantId as string;
        const source = christmas.drafts.find(draft => draft.ownerParticipantId === person)!;
        return response(command, { sourceSummary: canary, proposedConstraints: source.proposedConstraints,
          unsupportedConditions: person === 'ana' && !ownerClarified ? source.unsupportedConditions : [] });
      }
      const constraints = input.confirmedConstraints as KE.ConfirmedConstraint[];
      const permissions = input.activePermissions as KE.NegotiationPermission[];
      const nina = constraints.find(item => item.ownerParticipantId === 'nina' && item.kind === 'NEGOTIABLE');
      return response(command, { candidateIndex: kind === 'christmas' ? 4 : 0,
        permissionDependencies: permissions.map(item => ({ permissionId: item.permissionId,
          permissionVersion: item.permissionVersion, kind: 'NEGOTIATION', expiresAt: item.expiresAt })),
        questionIntents: nina && !permissions.length ? [{ ownerParticipantId: 'nina',
          constraintId: nina.constraintId, constraintVersion: nina.constraintVersion,
          adjustment: { id: 'ke14-allow-mazatlan', visibility: 'TRUSTED_BACKEND', operator: 'COMPARE',
            variableId: 'destination', comparison: 'EQ', value: { type: 'ENUM', optionId: 'mazatlan' } },
        }] : [],
      });
    } } },
  });
  if (kind === 'christmas') {
    const draft = await runtime.architect.draft('ke14-maya', { draftId: 'ke14-frame', revision: 1,
      objective: christmas.definition.objective, participants: christmas.definition.participants,
      allowedOptions: ['Cancún', 'Oaxaca', 'Mazatlán', 'Shared villa', 'Quiet hotel'] });
    definition = KE.DecisionDefinition.parse({ ...draft.frame,
      variables: draft.frame.variables.map(item => ({ ...item, ownerParticipantId: null })) });
  }
  const decisionId = definition.decisionId;
  const service: TrustedPrincipal = { kind: 'service', subject: 'ke14-synthetic-worker', roomIds: [decisionId] };
  const memberships = definition.participants.map(person => ({ subject: `ke14-${person.id}`, participantId: person.id, active: true }));
  await application.createDecision({ definition, creatorSubject: 'ke14-maya', memberships });

  async function command(person: string, type: string, payload: unknown) {
    const owner = await application.getOwnerSnapshot(principal(person), decisionId);
    const id = ids.next();
    return application.execute(principal(person), { schemaVersion: 2, type, payload, decisionId,
      requestId: id, idempotencyKey: id, expected: { contextToken: owner.publicSnapshot.contextToken,
        semanticVersion: owner.publicSnapshot.semanticVersion, controlVersion: owner.controlVersion, ownerVersion: owner.ownerVersion } });
  }
  for (const person of definition.requiredParticipantIds)
    assert.equal((await command(person, 'CONFIRM_FRAME', { frameVersion: 1 })).ok, true);

  async function confirmDraft(person: string, draft: KE.AIConstraintDraft) {
    assert.equal((await command(person, 'CONFIRM_CONSTRAINTS', { draftId: draft.draftId,
      draftVersion: draft.draftVersion, constraintIds: draft.proposedConstraints.map(item => item.constraintId) })).ok, true);
  }
  async function extract(person: string, clarified = ownerClarified) {
    ownerClarified = clarified;
    const draft = await runtime.ownerConversation.draft(principal(person), { decisionId,
      messages: [{ role: 'owner', text: person === 'ana' && clarified
        ? `Synthetic owner explicitly withdraws the unresolved proximity requirement; keep quiet hotel mandatory. ${canary}`
        : `Synthetic ${person} fixture condition. ${canary}` }] });
    await confirmDraft(person, draft);
    return draft;
  }
  for (const person of definition.requiredParticipantIds) {
    if (kind === 'christmas') await extract(person);
    else {
      const owner = await application.getOwnerSnapshot(principal(person), decisionId);
      const amount = purchase.candidate.values.find(item => item.variableId === `${person}-contribution`)!.value;
      const draft = KE.AIConstraintDraft.parse({ schemaVersion: 2, draftId: ids.next(), draftVersion: 1,
        decisionId, ownerParticipantId: person, ownerVersion: owner.ownerVersion,
        contextToken: owner.publicSnapshot.contextToken, semanticVersion: owner.publicSnapshot.semanticVersion,
        sourceSummary: 'Trusted synthetic setup; no model extraction claimed.', createdAt: now,
        proposedConstraints: [{ constraintId: `${person}-private-cap`, kind: flexiblePurchase && person === 'maya' ? 'NEGOTIABLE' : 'HARD', rule: {
          id: `${person}-private-cap-rule`, visibility: 'TRUSTED_BACKEND', operator: 'COMPARE',
          variableId: `${person}-contribution`, comparison: 'LTE', value: amount,
        } }], unsupportedConditions: [] });
      await application.storeConstraintDraft(service, draft);
      await confirmDraft(person, draft);
    }
  }
  async function answer(answer: 'ALLOW' | 'DECLINE') {
    const owner = await application.getOwnerSnapshot(principal('nina'), decisionId);
    const question = owner.pendingQuestions.find(item => item.status === 'PENDING')!;
    assert.ok(question);
    assert.equal((await command('nina', 'ANSWER_NEGOTIATION', { questionId: question.questionId,
      constraintVersion: question.constraintVersion, requestIdentity: question.requestIdentity, answer })).ok, true);
  }
  async function approve(person: string) {
    const snapshot = await application.getPublicSnapshot(principal(person), decisionId);
    const proposal = snapshot.currentProposal!;
    return command(person, 'APPROVE_PROPOSAL', { proposalId: proposal.proposalId,
      proposalVersion: proposal.facts.proposalVersion, publicHash: proposal.publicHash });
  }
  async function purchaseCandidate(values = purchase.candidate.values) {
    const job = await application.startReasoning(service, decisionId);
    const context = await application.getReasoningContext(service, decisionId, job.id);
    const candidate = KE.CandidateProposal.parse({ ...purchase.candidate, values,
      contextToken: job.contextToken, semanticVersion: job.semanticVersion, proposalVersion: context.proposalVersion });
    return { job, candidate };
  }
  return { application, repository, runtime, definition, memberships, service, decisionId,
    command, extract, answer, approve, purchaseCandidate, providerCalls: () => providerCalls };
}

export function assertPublicPrivacy(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const marker of [canary, 'private-cap', 'maya-contribution', 'leo-contribution', 'nina-contribution',
    '2500000', '1500000', '1000000', 'permissionId', 'constraintId',
    'refusedRequests', 'requestIdentity', 'sourceSummary', 'proposedConstraints'])
    assert.ok(!serialized.includes(marker), `Unexpected private marker: ${marker}`);
}
