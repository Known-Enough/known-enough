import { describe, expect, it } from 'vitest';
import { DecisionNegotiator } from '@deal-table/application';
import { setupScenario, principal, canary, assertPublicPrivacy } from '../evaluations/ke14.ts';

describe('KE14 offline scenario qualification (does not establish deployed acceptance)', () => {
  it('constructs and confirms a five-owner Christmas frame, extracts distinct conditions, negotiates, and requires all exact approvals', async () => {
    const h = await setupScenario('christmas');
    try {
      expect(h.definition.requiredParticipantIds).toHaveLength(5);
      const maya = await h.application.getOwnerSnapshot(principal('maya'), h.decisionId);
      expect(maya.confirmedConstraints[0]).toMatchObject({ kind: 'HARD', rule: { operator: 'COMPARE' } });
      const leo = await h.application.getOwnerSnapshot(principal('leo'), h.decisionId);
      expect(leo.confirmedConstraints[0]).toMatchObject({ kind: 'HARD', rule: { operator: 'IN' } });
      const ana = await h.application.getOwnerSnapshot(principal('ana'), h.decisionId);
      expect(ana.confirmedConstraints).toHaveLength(1);
      expect(ana.confirmedConstraints[0]).toMatchObject({ kind: 'HARD', rule: { variableId: 'accommodation' } });
      expect((await h.runtime.negotiator.generate(principal('maya'), h.decisionId)).outcome).toBe('NEEDS_PERMISSION');
      await h.answer('ALLOW');
      const nina = await h.application.getOwnerSnapshot(principal('nina'), h.decisionId);
      expect(nina.ownApproval).toBeNull();
      const result = await h.runtime.negotiator.generate(principal('maya'), h.decisionId);
      expect(result.outcome).toBe('APPLIED');
      expect(result.explanation?.kind).toBe('VALIDATED_PUBLIC_VALUES');
      const proposal = result.publicSnapshot.currentProposal!;
      expect((await h.command('maya', 'APPROVE_PROPOSAL', { proposalId: proposal.proposalId,
        proposalVersion: proposal.facts.proposalVersion, publicHash: '0'.repeat(64) })).ok).toBe(false);
      expect((await h.application.getOwnerSnapshot(principal('maya'), h.decisionId)).ownApproval).toBeNull();
      // The public estimate is a public offer; the identical private cap must be checked by field provenance.
      expect(Object.keys(result.publicSnapshot).sort()).not.toContain('confirmedConstraints');
      expect(JSON.stringify(result)).not.toContain('permissionId');
      expect(JSON.stringify(result)).not.toContain('constraintId');
      expect(JSON.stringify(result)).not.toContain(canary);
      const afterLeo = await h.application.getOwnerSnapshot(principal('leo'), h.decisionId);
      expect(afterLeo.pendingQuestions).toEqual([]);
      expect(afterLeo.negotiationPermissions).toEqual([]);
      expect(afterLeo.confirmedConstraints.every(item => item.ownerParticipantId === 'leo')).toBe(true);
      for (const person of ['maya', 'leo', 'nina', 'ana']) expect((await h.approve(person)).ok).toBe(true);
      expect((await h.application.getPublicSnapshot(principal('maya'), h.decisionId)).status).toBe('APPROVING');
      expect((await h.approve('raul')).ok).toBe(true);
      expect((await h.application.getPublicSnapshot(principal('maya'), h.decisionId)).status).toBe('AGREED');
      expect(JSON.stringify(await h.repository.transactionDecision(h.decisionId, record => record))).not.toContain(canary);
      expect(h.providerCalls()).toBe(8); // scripted architect + five owners + two reasoning calls
    } finally { await h.runtime.stop(); }
  });

  it('keeps Ana unresolved until an explicit synthetic owner clarification preserves her quiet-hotel constraint', async () => {
    const h = await setupScenario('christmas', false);
    try {
      const before = await h.application.getOwnerSnapshot(principal('ana'), h.decisionId);
      expect(before.ownInputReadiness).toBe('NEEDS_CLARIFICATION');
      await expect(h.runtime.negotiator.generate(principal('maya'), h.decisionId)).rejects.toMatchObject({ code: 'NEEDS_CLARIFICATION' });
      await h.extract('ana', true);
      const after = await h.application.getOwnerSnapshot(principal('ana'), h.decisionId);
      expect(after.draft?.proposedConstraints).toHaveLength(1);
      expect(after.draft?.proposedConstraints[0]).toMatchObject({ kind: 'HARD', rule: { variableId: 'accommodation' } });
      // Reconfirmation changes semantics; nobody may reason under the prior frame confirmations.
      expect(after.publicSnapshot.contextToken).not.toBe(before.publicSnapshot.contextToken);
      expect(after.publicSnapshot.frameConfirmations).toEqual([]);
    } finally { await h.runtime.stop(); }
  });

  it('respects refusal without exposing its owner or re-asking an identical adjustment', async () => {
    const h = await setupScenario('christmas');
    try {
      await h.runtime.negotiator.generate(principal('maya'), h.decisionId);
      await h.answer('DECLINE');
      await h.runtime.negotiator.generate(principal('maya'), h.decisionId);
      const nina = await h.application.getOwnerSnapshot(principal('nina'), h.decisionId);
      expect(nina.pendingQuestions.filter(item => item.status === 'PENDING')).toEqual([]);
      expect(nina.refusedRequests).toHaveLength(1);
      expect(nina.publicSnapshot.currentProposal).toBeNull();
      assertPublicPrivacy(nina.publicSnapshot);
    } finally { await h.runtime.stop(); }
  });

  it('clears old grants, approvals and frame confirmations on semantic revision', async () => {
    const h = await setupScenario('christmas');
    try {
      await h.runtime.negotiator.generate(principal('maya'), h.decisionId);
      await h.answer('ALLOW');
      await h.runtime.negotiator.generate(principal('maya'), h.decisionId);
      await h.approve('maya');
      const stored = (await h.repository.transactionDecision(h.decisionId, record => structuredClone(record)))!;
      const owner = await h.application.getOwnerSnapshot(principal('maya'), h.decisionId);
      await h.application.reviseDecision(principal('maya'), { decisionId: h.decisionId,
        expectedControlVersion: owner.controlVersion, memberships: h.memberships,
        definition: { ...stored.definition, title: 'Revised synthetic Christmas', frameVersion: 2, semanticVersion: 2 } });
      const snapshot = await h.application.getPublicSnapshot(principal('maya'), h.decisionId);
      expect(snapshot.currentProposal).toBeNull();
      expect(snapshot.approvedParticipantIds).toEqual([]);
      expect(snapshot.frameConfirmations).toEqual([]);
      const nina = await h.application.getOwnerSnapshot(principal('nina'), h.decisionId);
      expect(nina.negotiationPermissions.filter(item => item.status === 'ACTIVE')).toEqual([]);
      assertPublicPrivacy(snapshot);
    } finally { await h.runtime.stop(); }
  });

  it('rejects an in-flight Purchase candidate after revision', async () => {
    const h = await setupScenario('purchase');
    try {
      const { job, candidate } = await h.purchaseCandidate();
      const owner = await h.application.getOwnerSnapshot(principal('maya'), h.decisionId);
      await h.application.reviseDecision(principal('maya'), { decisionId: h.decisionId,
        expectedControlVersion: owner.controlVersion, memberships: h.memberships,
        definition: { ...h.definition, title: 'Revised synthetic purchase', frameVersion: 2, semanticVersion: 2 } });
      expect(await h.application.completeReasoning(h.service, h.decisionId, job.id, candidate)).toBe('STALE');
      expect((await h.application.getPublicSnapshot(principal('maya'), h.decisionId)).currentProposal).toBeNull();
    } finally { await h.runtime.stop(); }
  });

  it('checks private Purchase caps and ownership totals through the same application/kernel, with owner-only contributions', async () => {
    const h = await setupScenario('purchase');
    try {
      const { job, candidate } = await h.purchaseCandidate();
      expect(await h.application.completeReasoning(h.service, h.decisionId, job.id, candidate)).toBe('APPLIED');
      const maya = await h.application.getOwnerSnapshot(principal('maya'), h.decisionId);
      expect(maya.privateProposalValues?.values.map(item => item.variableId)).toEqual(['maya-contribution']);
      assertPublicPrivacy(maya.publicSnapshot);
      for (const person of ['maya', 'leo']) expect((await h.approve(person)).ok).toBe(true);
      expect((await h.application.getPublicSnapshot(principal('maya'), h.decisionId)).status).toBe('APPROVING');
      expect((await h.approve('nina')).ok).toBe(true);
      expect((await h.application.getPublicSnapshot(principal('maya'), h.decisionId)).status).toBe('AGREED');
      expect(h.providerCalls()).toBe(0); // trusted setup/candidate, expressly not model-port qualification
    } finally { await h.runtime.stop(); }
  });

  it('invalidates an otherwise balanced Purchase candidate exceeding one private cap', async () => {
    const h = await setupScenario('purchase');
    try {
      const base = await h.purchaseCandidate();
      const values = base.candidate.values.map(item => item.value.type === 'MONEY' ? { ...item,
        value: { ...item.value, amountMinor: item.value.amountMinor + (item.variableId === 'maya-contribution' ? 1 : item.variableId === 'leo-contribution' ? -1 : 0) } } : item);
      expect(await h.application.completeReasoning(h.service, h.decisionId, base.job.id, { ...base.candidate, values })).toBe('INVALID');
      const snapshot = await h.application.getPublicSnapshot(principal('maya'), h.decisionId);
      expect(snapshot.currentProposal).toBeNull();
      assertPublicPrivacy(snapshot);
    } finally { await h.runtime.stop(); }
  });

  it('records the current Purchase model-port gap: public-only assignments cannot satisfy required private contributions', async () => {
    const h = await setupScenario('purchase');
    try {
      expect((await h.runtime.negotiator.generate(principal('maya'), h.decisionId)).outcome).toBe('NEEDS_CLARIFICATION');
      expect((await h.application.getPublicSnapshot(principal('maya'), h.decisionId)).currentProposal).toBeNull();
    } finally { await h.runtime.stop(); }
  });

  it('records the Purchase flexibility gap: private numeric adjustments are outside the reviewed question vocabulary', async () => {
    const h = await setupScenario('purchase', true, true);
    try {
      const owner = await h.application.getOwnerSnapshot(principal('maya'), h.decisionId);
      const constraint = owner.confirmedConstraints[0]!;
      await expect(h.application.askNegotiation(h.service, { decisionId: h.decisionId,
        participantId: 'maya', contextToken: owner.publicSnapshot.contextToken,
        semanticVersion: owner.publicSnapshot.semanticVersion, constraintId: constraint.constraintId,
        constraintVersion: constraint.constraintVersion, expiresAt: '2026-10-01T12:10:00.000Z',
        adjustment: { id: 'ke14-private-flex', visibility: 'TRUSTED_BACKEND', operator: 'COMPARE',
          variableId: 'maya-contribution', comparison: 'LTE',
          value: { type: 'MONEY', amountMinor: 2_600_000, currencyCode: 'USD', minorUnit: 2 } },
      })).rejects.toMatchObject({ code: 'INVALID_COMMAND' });
      const after = await h.application.getOwnerSnapshot(principal('maya'), h.decisionId);
      expect(after.pendingQuestions).toEqual([]);
      expect(after.negotiationPermissions).toEqual([]);
      assertPublicPrivacy(after.publicSnapshot);
    } finally { await h.runtime.stop(); }
  });

  it('rejects a private Purchase catalog before calling any model', async () => {
    const h = await setupScenario('purchase');
    try {
      const { job, candidate } = await h.purchaseCandidate();
      await h.application.cancelReasoning(h.service, h.decisionId, job.id);
      let invoked = false;
      const negotiator = new DecisionNegotiator({ application: h.application,
        ids: { next: () => 'ke14-private-catalog' }, clock: { now: () => '2026-10-01T12:00:00.000Z' },
        publicCandidates: () => [candidate.values], model: async () => { invoked = true; return {}; } });
      await expect(negotiator.generate(principal('maya'), h.decisionId)).rejects.toMatchObject({ code: 'INVALID_MODEL_OUTPUT' });
      expect(invoked).toBe(false);
      expect((await h.application.getPublicSnapshot(principal('maya'), h.decisionId)).currentProposal).toBeNull();
    } finally { await h.runtime.stop(); }
  });
});
