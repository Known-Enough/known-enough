import { z } from 'zod';
import * as KE from './known-enough.ts';

export const PROTOCOL_VERSION = '2025-11-25';
export const TOOL_NAMES = ['list_groups', 'list_group_decisions', 'get_decision_progress', 'get_decision_outcome'] as const;
export const Identifier = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
export const GroupList = z.strictObject({ groups: z.array(z.strictObject({ id: Identifier, name: z.string().max(160) })).max(5), cursor: z.string().max(4096).nullable() });
export const GroupDecisions = z.strictObject({ groupId: Identifier, name: z.string().max(160), decisions: z.array(z.strictObject({ id: Identifier, title: z.string().max(160), current: z.boolean() })).max(64) });
export const DecisionSummary = z.strictObject({
  decisionId: Identifier, title: z.string().max(160), status: KE.PublicDecisionSnapshot.shape.status,
  publicRevision: KE.PublicDecisionSnapshot.shape.publicRevision, contextToken: z.string().regex(/^[a-f0-9]{64}$/),
  proposalId: Identifier.nullable(), proposalVersion: z.number().int().positive().nullable(),
  requiredApprovals: z.number().int().nonnegative().max(16), approved: z.number().int().nonnegative().max(16),
  participants: z.array(z.strictObject({ name: z.string().max(160), answered: z.boolean().nullable(), approved: z.boolean(), required: z.boolean() })).max(16),
  choices: z.array(z.strictObject({ topic: z.string().max(160), option: z.string().max(2000) })).max(32),
});
export type DecisionSummary = z.infer<typeof DecisionSummary>;
/** Explicit shared fields only. No owner draft, private variable or raw note is accepted. */
export function sharedDecisionSummary(raw: unknown): DecisionSummary {
  const snapshot = KE.PublicDecisionSnapshot.parse(raw);
  const proposal = snapshot.currentProposal;
  const label = (value: KE.DecisionValue, variable: KE.PublicDecisionFrame['variables'][number]): string => {
    switch (value.type) {
      case 'ENUM': return variable.type === 'ENUM' ? variable.options.find(option => option.id === value.optionId)?.label ?? value.optionId : value.optionId;
      case 'ENUM_SET': return variable.type === 'ENUM_SET' ? value.optionIds.map(id => variable.options.find(option => option.id === id)?.label ?? id).join(', ') : value.optionIds.join(', ');
      case 'DATE': return value.date;
      case 'DATETIME': return `${value.instant} (${value.displayTimeZone})`;
      case 'MONEY': return new Intl.NumberFormat('en-US', { style: 'currency', currency: value.currencyCode }).format(value.amountMinor / 10 ** value.minorUnit);
      case 'PERCENTAGE': return `${value.basisPoints / 100}%`;
      case 'NUMBER': return `${value.coefficient / 10 ** value.scale} ${value.unitCode}`;
      case 'DURATION': return `${value.seconds} seconds`;
      case 'BOOLEAN': return value.value ? 'Yes' : 'No';
      case 'PARTICIPANT': return snapshot.frame.participants.find(person => person.id === value.participantId)?.displayName ?? 'Participant';
    }
  };
  return DecisionSummary.parse({ decisionId: snapshot.frame.decisionId, title: snapshot.frame.title, status: snapshot.status,
    publicRevision: snapshot.publicRevision, contextToken: snapshot.contextToken, proposalId: proposal?.proposalId ?? null, proposalVersion: proposal?.facts.proposalVersion ?? null,
    requiredApprovals: snapshot.frame.requiredParticipantIds.length, approved: snapshot.frame.requiredParticipantIds.filter(id => snapshot.approvedParticipantIds.includes(id)).length,
    participants: snapshot.frame.participants.map(person => ({ name: person.displayName, answered: snapshot.participantProgress?.find(progress => progress.participantId === person.id)?.answersSaved ?? null,
      approved: snapshot.approvedParticipantIds.includes(person.id), required: person.requiredForApproval })),
    choices: (proposal?.facts.values ?? []).flatMap(assignment => {
      const variable = snapshot.frame.variables.find(variable => variable.id === assignment.variableId && variable.visibility === 'PUBLIC');
      return variable ? [{ topic: variable.label, option: label(assignment.value, variable) }] : [];
    }),
  });
}
