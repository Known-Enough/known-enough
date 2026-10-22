import { describe, expect, it } from 'vitest';
import { Alexa } from '@deal-table/contracts';
import { liveDecisionCopy, liveDecisionResult } from './live-decision';

const summary = Alexa.DecisionSummary.parse({ decisionId: 'dinner', title: 'Group dinner', status: 'AGREED',
  publicRevision: 7, contextToken: 'a'.repeat(64), proposalId: 'proposal', proposalVersion: 1,
  requiredApprovals: 2, approved: 2, participants: [
    { name: 'Alex', answered: true, approved: true, required: true },
    { name: 'Sam', answered: true, approved: true, required: true },
  ], choices: [{ topic: 'Restaurant', option: 'Moon Noodles' }, { topic: 'Day', option: '2026-10-31' }] });

describe('live decision read boundary', () => {
  it('uses structured shared facts rather than stale generated text', () => {
    const value = liveDecisionResult({ structuredContent: summary, content: [{ type: 'text', text: 'Nobody approved yet.' }] }, 'dinner');
    expect(value.approved).toBe(2);
    expect(liveDecisionCopy(value)).toMatchObject({ label: 'Decision agreed', explanation: 'Everyone has approved this outcome.', hasOutcome: true });
  });
  it('rejects denied reads and results for another decision', () => {
    expect(() => liveDecisionResult({ isError: true, structuredContent: summary }, 'dinner')).toThrow();
    expect(() => liveDecisionResult({ structuredContent: summary }, 'other')).toThrow();
    expect(() => liveDecisionResult({ content: [{ type: 'text', text: JSON.stringify(summary) }] }, 'dinner')).toThrow();
  });
  it('rejects owner fields instead of rendering or retaining them', () => {
    expect(() => liveDecisionResult({ structuredContent: { ...summary, privateAnswers: 'never render' } }, 'dinner')).toThrow();
    expect(() => liveDecisionResult({ structuredContent: { ...summary, choices: [{ topic: 'Place', option: 'Public', privateReason: 'never render' }] } }, 'dinner')).toThrow();
  });
  it('does not label an inconsistent agreement as agreed', () => {
    for (const changes of [{ approved: 0 }, { approved: 3 }, { proposalId: null }, { proposalVersion: null }]) {
      expect(() => liveDecisionResult({ structuredContent: { ...summary, ...changes } }, 'dinner')).toThrow();
    }
  });
  it('distinguishes a pending proposal from an agreement without inferring private reasons', () => {
    const value = liveDecisionResult({ structuredContent: { ...summary, status: 'APPROVING', approved: 1 } }, 'dinner');
    expect(liveDecisionCopy(value)).toMatchObject({ label: 'Proposed outcome', hasOutcome: true });
    expect(liveDecisionCopy({ ...value, status: 'NO_AGREEMENT', proposalId: null, proposalVersion: null, choices: [], approved: 0 }))
      .toMatchObject({ label: 'No matching outcome', hasOutcome: false });
    expect(liveDecisionCopy({ ...value, status: 'CLOSED' }).hasOutcome).toBe(false);
  });
});
