import { KnownEnough as KE } from '../../packages/contracts/src/index.ts';
import { evaluateKnownEnoughCandidate, type KnownEnoughKernelDiagnostic } from '../../packages/domain/src/index.ts';
import { safeKernelCodes, safeRuleFailureKinds } from './kernel-codes.mjs';
import type { KnownEnoughRecord } from '../../packages/application/src/index.ts';
export function classifyFailedRules(
  diagnostics: readonly KnownEnoughKernelDiagnostic[],
  publicRuleIds: readonly string[],
  constraints: readonly {constraintId: string; ownerParticipantId: string; status: string; kind: string; rule?: {id: string}}[],
) {
  return safeRuleFailureKinds(diagnostics.filter(d => d.code === 'RULE_FAILED').map(d => {
    if (d.constraintId !== undefined || d.ownerParticipantId !== undefined) {
      const matches = constraints.filter(c => c.constraintId === d.constraintId && c.ownerParticipantId === d.ownerParticipantId
        && c.status === 'ACTIVE' && c.kind === 'HARD' && c.rule?.id === d.ruleId);
      return matches.length === 1 ? 'HARD_CONDITION' : 'UNKNOWN_RULE';
    }
    return d.ruleId !== undefined && publicRuleIds.includes(d.ruleId) ? 'PUBLIC_RULE' : 'UNKNOWN_RULE';
  }));
}
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
  return {status: 'PASS', codes: safeKernelCodes(result.diagnostics.map(d => d.code)), ruleFailureKinds: classifyFailedRules(result.diagnostics, decision.definition.rules.map(r => r.id), decision.owners.flatMap(o => o.confirmedConstraints))};
}
