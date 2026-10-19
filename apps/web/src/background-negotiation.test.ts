import { describe, expect, it, vi } from 'vitest';
import { KnownEnough as KE } from '@deal-table/contracts';
import { BACKGROUND_NEGOTIATION_PROFILE } from '@deal-table/contracts/durable-command';
import { buildHypotheticalContributionFixture } from '../../../packages/test-support/src/known-enough-fixtures';
import { backgroundNegotiationAvailable, backgroundRequest, submitBackgroundRequest, pollBackgroundDecision, type BackgroundTarget } from './background-negotiation';
const jobId = '12345678-1234-4234-9234-123456789012';
const receipt = { jobId, state: 'QUEUED', expiresAt: new Date(300000).toISOString() };
async function fixture() {
  const f = await buildHypotheticalContributionFixture();
  const owner = f.ownerSnapshot; const snapshot = owner.publicSnapshot;
  const target: BackgroundTarget = { decisionId: snapshot.frame.decisionId, contextToken: snapshot.contextToken,
    semanticVersion: snapshot.semanticVersion, ownerParticipantId: owner.ownerParticipantId, expiresAt: receipt.expiresAt };
  return { owner, snapshot, target };
}
describe('background negotiation browser transport', () => {
  it('selects only the explicit compatible JSON profile; existing responses remain synchronous', () => {
    const response = (value: string) => new Response('', { headers: { 'content-type': value } });
    expect(backgroundNegotiationAvailable(response(`application/json; charset=utf-8; profile="${BACKGROUND_NEGOTIATION_PROFILE}"`))).toBe(true);
    for (const value of ['application/json', `text/plain; profile="${BACKGROUND_NEGOTIATION_PROFILE}"`,
      'application/json; profile="unknown"', `application/json; profile="${BACKGROUND_NEGOTIATION_PROFILE}"; profile="${BACKGROUND_NEGOTIATION_PROFILE}"`]) {
      expect(backgroundNegotiationAvailable(response(value))).toBe(false);
    }
  });
  it('builds only the server DTO and keeps exact request identity after an unknown response', async () => {
    const f = await fixture(); const command = backgroundRequest(f.snapshot, f.owner, 'stable-request');
    const bodies: string[] = []; let calls = 0;
    const api = vi.fn(async (_path: string, init?: RequestInit) => {
      bodies.push(String(init?.body)); if (++calls === 1) throw new Error('lost acknowledgement');
      return Response.json({ ok: true, requestId: command.requestId, job: receipt });
    });
    await expect(submitBackgroundRequest(api, command)).rejects.toThrow();
    expect(await submitBackgroundRequest(api, command)).toEqual(receipt);
    expect(bodies[0]).toBe(bodies[1]); expect(bodies[0]).not.toMatch(/subject|sourceSha|permission|private|provider/);
    expect(command.expected.controlVersion).toBe(f.owner.controlVersion);
  });
  it('rejects wrong acknowledgement identity and private or extended receipts', async () => {
    const f = await fixture(); const command = backgroundRequest(f.snapshot, f.owner, 'stable-request');
    for (const result of [{ ok: true, requestId: 'other', job: receipt }, { ok: true, requestId: command.requestId, job: { ...receipt, subject: 'private' } },
      { ok: true, requestId: command.requestId, job: receipt, modelOutput: 'private' }]) {
      await expect(submitBackgroundRequest(async () => Response.json(result), command)).rejects.toThrow();
    }
  });
  it('polls only signed snapshot reads until a fresh matching owned result settles', async () => {
    const f = await fixture(); let rounds = 0;
    const api = vi.fn(async (path: string, init?: RequestInit) => {
      expect(init?.method).toBeUndefined();
      const snapshot = KE.PublicDecisionSnapshot.parse({ ...f.snapshot, status: rounds < 1 ? 'REASONING' : f.snapshot.status, currentProposal: rounds < 1 ? null : f.snapshot.currentProposal });
      expect(path).toBe(`/decisions/${f.target.decisionId}/me`);
      rounds++; return Response.json({ ...f.owner, publicSnapshot: snapshot, privateProposalValues: snapshot.status === 'REASONING' ? null : f.owner.privateProposalValues });
    });
    const accept = vi.fn();
    expect(await pollBackgroundDecision({ target: f.target, api, accept, signal: new AbortController().signal, now: () => 0, wait: async () => {} })).toBe('SETTLED');
    expect(accept).toHaveBeenCalledTimes(2); expect(api).toHaveBeenCalledTimes(2);
    expect(api.mock.calls.every(([path]) => path.endsWith('/me'))).toBe(true);
  });
  it('stops on stale context or a foreign owner without rendering that result', async () => {
    const f = await fixture(); const accept = vi.fn();
    const stale = async () => Response.json(f.owner);
    expect(await pollBackgroundDecision({ target: { ...f.target, semanticVersion: f.snapshot.semanticVersion + 1 }, api: stale, accept, signal: new AbortController().signal, now: () => 0, wait: async () => {} })).toBe('CONTEXT_CHANGED');
    const foreign = async (path: string) => Response.json(path.endsWith('/public') ? f.snapshot : f.owner);
    expect(await pollBackgroundDecision({ target: { ...f.target, ownerParticipantId: 'other-owner' }, api: foreign, accept, signal: new AbortController().signal, now: () => 0, wait: async () => {} })).toBe('CONTEXT_CHANGED');
    expect(accept).not.toHaveBeenCalled();
  });
  it('bounds temporary failures, expiry and cancellation without submitting a replacement job', async () => {
    const f = await fixture(); const api = vi.fn(async () => new Response('', { status: 503 })); const accept = vi.fn();
    expect(await pollBackgroundDecision({ target: f.target, api, accept, signal: new AbortController().signal, now: () => 0, wait: async () => {} })).toBe('UNAVAILABLE');
    expect(api).toHaveBeenCalledTimes(3); api.mockClear();
    expect(await pollBackgroundDecision({ target: f.target, api, accept, signal: new AbortController().signal, now: () => 300000, wait: async () => {} })).toBe('EXPIRED');
    const controller = new AbortController(); controller.abort();
    expect(await pollBackgroundDecision({ target: f.target, api, accept, signal: controller.signal, now: () => 0 })).toBe('CANCELLED');
    expect(api).not.toHaveBeenCalled();
  });
});
