import type { ConverseTransport } from '@deal-table/adapters';
import type { KnownEnough as KE } from '@deal-table/contracts';
/** Synthetic test provider only. Production has no objective switch or fixture fallback. */
export function npTransport(): ConverseTransport {
  return { send: async command => {
    const input = JSON.parse(command.input.messages![0]!.content![0]!.text!) as Record<string, unknown>;
    const name = command.input.toolConfig!.tools![0]!.toolSpec!.name!;
    let output: unknown;
    if (name === 'ke_architect_output') {
      const garden = (input.objective as string).includes('garden');
      output = { title: garden ? 'Garden workday' : 'Gallery meetup', description: 'Compare these fictional shared choices.',
        variables: [{ id: garden ? 'activity' : 'venue', type: 'ENUM', label: garden ? 'Activity' : 'Venue', visibility: 'PUBLIC', required: true,
          ownerParticipantId: null, options: garden ? [{ id: 'planting', label: 'Planting' }, { id: 'watering', label: 'Watering' }]
            : [{ id: 'courtyard', label: 'Courtyard' }, { id: 'studio', label: 'Studio' }] },
        { id: 'slot', type: 'ENUM', label: 'Time slot', visibility: 'PUBLIC', required: true, ownerParticipantId: null,
          options: [{ id: 'morning', label: 'Morning' }, { id: 'afternoon', label: 'Afternoon' }] }], rules: [],
        clarificationQuestions: [], participantInformationRequirements: (input.participants as { id: string }[]).map(person => ({ participantId: person.id, kind: 'PREFERENCES' })) };
    } else if (name === 'ke_owner_output') {
      const messages = input.messages as { text: string }[];
      const text = messages.map(item => item.text).join(' ');
      const frame = input.publicFrame as KE.PublicDecisionFrame;
      const variable = frame.variables[0]!;
      const negotiated = text.includes('flexible');
      const options = variable.type === 'ENUM' ? variable.options : [];
      const choice = text.includes('second') ? options[1]!.id : options[0]!.id;
      output = { sourceSummary: 'NP_PRIVATE_RAW_CANARY', proposedConstraints: text.includes('unsupported') ? [] : [
        { constraintId: 'owner-choice', kind: negotiated ? 'NEGOTIABLE' : 'HARD', rule: { id: 'owner-choice-rule',
          visibility: 'TRUSTED_BACKEND', operator: 'IN', variableId: variable.id, values: [{ type: 'ENUM', optionId: choice }] } }],
        unsupportedConditions: text.includes('unsupported') ? [{ id: 'uncertain', sourceSummary: 'NP_PRIVATE_RAW_CANARY', clarificationQuestion: 'Please clarify.' }] : [] };
    } else {
      const frame = input.frame as KE.PublicDecisionFrame;
      const candidates = input.publicCandidates as KE.CandidateProposal['values'][];
      const variable = frame.variables[0]!;
      const option = variable.type === 'ENUM' ? variable.options[1]!.id : '';
      const constraints = input.confirmedConstraints as KE.ConfirmedConstraint[];
      const negotiable = constraints.find(item => item.kind === 'NEGOTIABLE');
      const permissions = input.activePermissions as KE.NegotiationPermission[];
      output = { candidateIndex: candidates.findIndex(values => values.some(item => item.variableId === variable.id && item.value.type === 'ENUM' && item.value.optionId === option)),
        permissionDependencies: permissions.map(item => ({ permissionId: item.permissionId, permissionVersion: item.permissionVersion, kind: 'NEGOTIATION', expiresAt: item.expiresAt })),
        questionIntents: !negotiable || permissions.length ? [] : [{ ownerParticipantId: negotiable.ownerParticipantId,
          constraintId: negotiable.constraintId, constraintVersion: negotiable.constraintVersion,
          adjustmentVariableId: variable.id, adjustmentOptionIds: [option] }] };
    }
    return { $metadata: {}, usage: undefined, metrics: undefined, stopReason: 'tool_use', output: { message: { role: 'assistant', content: [{ toolUse: { toolUseId: 'np-injected', name, input: output as never } }] } } };
  } };
}
