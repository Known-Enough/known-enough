import { KnownEnough as KE } from '@deal-table/contracts';
import { KnownEnoughApplication } from '@deal-table/application';
import { InMemoryRoomRepository } from '@deal-table/adapters';
import type { ConverseCommand, ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import { createKnownEnoughModelRuntime } from '../../apps/api/src/model-runtime.ts';
import { ScenarioService, scenarioCandidates } from '../../apps/api/src/scenario-service.ts';
import { buildChristmasFixture, buildHypotheticalContributionFixture } from '../../packages/test-support/src/known-enough-fixtures.ts';

/** Same production services with explicitly scripted provider data. Never live or managed-auth evidence. */
export async function fixedScenarioHarness() {
  let sequence = 0;
  const ids = { next: () => `ke14-fixed-${++sequence}` };
  const clock = { now: () => '2026-10-01T12:00:00.000Z' };
  const repository = new InMemoryRoomRepository();
  const application = new KnownEnoughApplication({ repository, ids, clock });
  const christmas = buildChristmasFixture();
  const purchase = await buildHypotheticalContributionFixture();
  const requests: Record<string, unknown>[] = [];
  const transport = { send: async (command: ConverseCommand): Promise<ConverseCommandOutput> => {
    const input = JSON.parse(command.input.messages![0]!.content![0]!.text!) as Record<string, unknown>;
    requests.push(input);
    const prompt = command.input.system![0]!.text!;
    let output: unknown;
    if (prompt.includes('Construct only')) {
      const buying = (input.objective as string).includes('Hypothetical USD 50,000');
      output = { title: buying ? 'Hypothetical shared purchase' : christmas.definition.title,
        description: 'Synthetic exploration only. No transaction or advice.',
        variables: buying ? [...purchase.publicFrame.variables, { id: 'funding-structure', type: 'ENUM', visibility: 'PUBLIC',
          required: true, label: 'Contribution structure', options: [{ id: 'equal', label: 'Equal contributions' }, { id: 'weighted', label: 'Weighted contributions' }] }]
          : christmas.definition.variables,
        rules: [], clarificationQuestions: [], participantInformationRequirements: [] };
    } else if (prompt.includes('Extract only')) {
      const frame = input.publicFrame as KE.PublicDecisionFrame;
      const person = input.ownerParticipantId as string;
      const buying = frame.variables.some(item => item.id === 'funding-structure');
      const amounts: Record<string, number> = { maya: 2_500_000, leo: 1_500_000, nina: 1_000_000 };
      const constraints = buying ? [{ constraintId: `${person}-cap`, kind: 'HARD', rule: { id: `${person}-cap-rule`,
        visibility: 'TRUSTED_BACKEND', operator: 'COMPARE', variableId: `${person}-contribution`, comparison: 'LTE',
        value: { type: 'MONEY', amountMinor: amounts[person]!, currencyCode: 'USD', minorUnit: 2 } } },
      ...(person === 'nina' ? [{ constraintId: 'nina-structure', kind: 'NEGOTIABLE', rule: { id: 'nina-structure-rule',
        visibility: 'TRUSTED_BACKEND', operator: 'IN', variableId: 'funding-structure', values: [{ type: 'ENUM', optionId: 'equal' }] } }] : [])]
        : christmas.drafts.find(item => item.ownerParticipantId === person)!.proposedConstraints;
      output = { sourceSummary: 'KE14_RAW_MESSAGE_CANARY', proposedConstraints: constraints, unsupportedConditions: [] };
    } else {
      const frame = input.frame as KE.PublicDecisionFrame;
      const buying = frame.variables.some(item => item.id === 'funding-structure');
      const constraints = input.confirmedConstraints as KE.ConfirmedConstraint[];
      const nina = constraints.find(item => item.kind === 'NEGOTIABLE' && item.ownerParticipantId === 'nina')!;
      const permissions = input.activePermissions as KE.NegotiationPermission[];
      output = { candidateIndex: buying ? 1 : 4,
        permissionDependencies: permissions.map(item => ({ permissionId: item.permissionId, permissionVersion: item.permissionVersion,
          kind: 'NEGOTIATION', expiresAt: item.expiresAt })),
        questionIntents: permissions.length ? [] : [{ ownerParticipantId: 'nina', constraintId: nina.constraintId,
          constraintVersion: nina.constraintVersion, adjustment: { id: 'ke14-alternative', visibility: 'TRUSTED_BACKEND',
            operator: 'IN', variableId: buying ? 'funding-structure' : 'destination', values: [{ type: 'ENUM', optionId: buying ? 'weighted' : 'mazatlan' }] } }],
      };
    }
    return { $metadata: {}, usage: undefined, metrics: undefined, stopReason: 'tool_use', output: { message: {
      role: 'assistant', content: [{ toolUse: { toolUseId: 'ke14-fixed', name: command.input.toolConfig!.tools![0]!.toolSpec!.name!, input: output as never } }] } } };
  } };
  const runtime = createKnownEnoughModelRuntime({ application, clock, ids, provider: { mode: 'INJECTED', transport },
    publicCandidates: frame => scenarioCandidates(frame).map(values => values.filter(item => frame.variables.some(variable => variable.id === item.variableId))),
    trustedCandidates: scenarioCandidates });
  const members = christmas.definition.participants.map(person => ({ participantId: person.id, displayName: person.displayName, subject: `subject-${person.id}` }));
  const scenarios = new ScenarioService({ application: runtime.application, architect: runtime.architect, members, clock, isEnabled: runtime.isEnabled });
  return { application, runtime, repository, scenarios, members, requests, clock, ids };
}
