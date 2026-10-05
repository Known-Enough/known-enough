import { KnownEnough as KE } from '../../packages/contracts/src/index.ts';
import { evaluateKnownEnoughCandidate } from '../../packages/domain/src/index.ts';
import { safeKernelCodes } from './kernel-codes.mjs';
import type { KnownEnoughRecord } from '../../packages/application/src/index.ts';
/** Internal QA only: caller checks active lease and run ownership before supplying a record. */
export async function diagnosePendingCandidate(decision: KnownEnoughRecord | null) {
  const candidate = decision?.pendingCandidate;
  if (!decision || !candidate) return { status: 'UNKNOWN', codes: [] };
  const facts = KE.PublicProposalFacts.parse({schemaVersion: KE.KE_SCHEMA_VERSION, decisionId: decision.decisionId,
    contextToken: decision.definition.contextToken, semanticVersion: decision.definition.semanticVersion,
    proposalVersion: candidate.proposalVersion, requiredParticipantIds: decision.definition.requiredParticipantIds,
    values: candidate.values.filter(a => decision.definition.variables.some(v => v.id === a.variableId && v.visibility === 'PUBLIC'))});
  const result = await evaluateKnownEnoughCandidate({definition: decision.definition, candidate,
    publicProposal: {proposalId: candidate.proposalId, facts, publicHash: await KE.hashDecisionProposal(facts), createdAt: candidate.createdAt},
    confirmedConstraints: decision.owners.flatMap(o => o.confirmedConstraints.filter(c => c.status === 'ACTIVE')),
    frameConfirmations: decision.frameConfirmations, readyParticipantIds: decision.owners.filter(o => o.readiness === 'READY').map(o => o.participantId),
    unresolvedConditionIds: decision.owners.flatMap(o => o.draft?.unsupportedConditions.map(c => c.id) ?? []),
    negotiationPermissions: decision.owners.flatMap(o => o.negotiationPermissions.filter(p => p.status === 'ACTIVE')),
    disclosurePermissions: decision.owners.flatMap(o => o.disclosurePermissions.filter(p => p.status === 'ACTIVE')),
    now: new Date().toISOString()});
  return {status: 'PASS', codes: safeKernelCodes(result.diagnostics.map(d => d.code))};
}
