import type { ConverseCommand, ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import { evaluationCanary } from './ke10.ts';

export const response = (output: unknown): ConverseCommandOutput => ({ $metadata: {}, metrics: { latencyMs: 1 }, stopReason: 'end_turn',
  output: { message: { role: 'assistant', content: [{ text: JSON.stringify(output) }] } },
  usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } });
export function syntheticResponse(command: ConverseCommand): ConverseCommandOutput {
  const prompt = command.input.system?.[0]?.text ?? '';
  const input = JSON.parse(command.input.messages![0]!.content![0]!.text!) as Record<string, unknown>;
  if (prompt.includes('Construct only')) return response({ title: 'Destination', description: 'Synthetic evaluation.',
    variables: [{ id: 'destination', type: 'ENUM', visibility: 'PUBLIC', ownerParticipantId: null, required: true,
      label: 'Destination', options: [{ id: 'cancun', label: 'Cancún' }, { id: 'oaxaca', label: 'Oaxaca' }] }],
    rules: [], clarificationQuestions: [], participantInformationRequirements: [] });
  if (prompt.includes('Extract only')) return response({ sourceSummary: evaluationCanary,
    proposedConstraints: [{ constraintId: evaluationCanary, kind: 'HARD', rule: { id: evaluationCanary,
      visibility: 'TRUSTED_BACKEND', operator: 'COMPARE', variableId: 'estimated-total', comparison: 'LTE',
      value: { type: 'MONEY', amountMinor: 160_000, currencyCode: 'USD', minorUnit: 2 } } }], unsupportedConditions: [] });
  return response({ values: (input.publicCandidates as unknown[])[0], permissionDependencies: [], questionIntents: [],
    explanationDraft: { variableIds: [], ruleIds: [] } });
}
