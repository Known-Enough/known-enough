import { describe, expect, it, vi } from 'vitest';
import type { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { buildChristmasPublicCandidates } from '../../../packages/test-support/src/known-enough-fixtures.ts';
import { createEvaluationDecision, evaluationPrincipal } from '../../../tests/evaluations/ke10.ts';
import { syntheticResponse } from '../../../tests/evaluations/ke10-injected.ts';
import { createKnownEnoughModelRuntime } from './model-runtime.ts';

function compose(h: Awaited<ReturnType<typeof createEvaluationDecision>>, send: (command: ConverseCommand) => ReturnType<typeof syntheticResponse> | Promise<ReturnType<typeof syntheticResponse>>) {
  return createKnownEnoughModelRuntime({ ...h, provider: { mode: 'INJECTED', transport: { send: async command => send(command) } },
    publicCandidates: buildChristmasPublicCandidates });
}
const messages = [{ role: 'owner', text: 'My maximum is USD 1600.' }];

describe('KE10 application/runtime composition', () => {
  it('keeps local live mode disabled without separate paid-call and privacy authorization', async () => {
    const h = await createEvaluationDecision();
    expect(() => createKnownEnoughModelRuntime({ ...h, publicCandidates: buildChristmasPublicCandidates,
      provider: { mode: 'BEDROCK', paidCallsApproved: false, invocationLoggingDisabled: false, retentionReviewed: false } }))
      .toThrow('DISABLED');
  });
  it('rejects a duplicate owner completion after a newer draft wins', async () => {
    const h = await createEvaluationDecision();
    let firstResolve!: (value: ReturnType<typeof syntheticResponse>) => void;
    let firstCommand!: ConverseCommand;
    const send = vi.fn(async (command: ConverseCommand) => {
      if (send.mock.calls.length === 1) {
        firstCommand = command;
        return new Promise<ReturnType<typeof syntheticResponse>>(resolve => { firstResolve = resolve; });
      }
      return syntheticResponse(command);
    });
    const runtime = compose(h, send);
    const first = runtime.ownerConversation.draft(evaluationPrincipal('maya'), { decisionId: h.decisionId, messages }).catch(error => error.code);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const second = await runtime.ownerConversation.draft(evaluationPrincipal('maya'), { decisionId: h.decisionId, messages });
    firstResolve(syntheticResponse(firstCommand));
    expect(await first).toBe('STALE');
    expect((await h.application.getOwnerSnapshot(evaluationPrincipal('maya'), h.decisionId)).draft?.draftId).toBe(second.draftId);
    runtime.stop();
  });
  it.each(['expiry', 'control', 'membership'] as const)('checks %s inside the owner output transaction', async change => {
    let instant = Date.now();
    const h = await createEvaluationDecision({ now: () => new Date(instant).toISOString() });
    const original = h.application.storeConstraintDraft.bind(h.application);
    vi.spyOn(h.application, 'storeConstraintDraft').mockImplementation(async (principal, input, guard) => {
      if (change === 'expiry') instant += 30_001;
      else await h.repository.transactionDecision(h.decisionId, record => {
        if (change === 'control') record!.controlVersion++;
        else record!.memberships.find(member => member.participantId === 'maya')!.active = false;
      });
      return original(principal, input, guard);
    });
    const runtime = compose(h, syntheticResponse);
    await expect(runtime.ownerConversation.draft(evaluationPrincipal('maya'), { decisionId: h.decisionId, messages })).rejects.toBeDefined();
    const stored = await h.repository.transactionDecision(h.decisionId, record => record);
    expect(stored?.owners.find(owner => owner.participantId === 'maya')?.draft).toBeNull();
    runtime.stop();
  });
  it('rejects changed permission authority before a second provider attempt and releases only its job', async () => {
    const h = await createEvaluationDecision();
    const send = vi.fn(async (command: ConverseCommand) => {
      // Models the control-version change made by revocation or a new permission response.
      await h.repository.transactionDecision(h.decisionId, record => { record!.controlVersion++; });
      return syntheticResponse(command);
    });
    const runtime = compose(h, send);
    await expect(runtime.negotiator.generate(evaluationPrincipal('maya'), h.decisionId)).rejects.toMatchObject({ code: 'MODEL_FAILED' });
    expect(send).toHaveBeenCalledTimes(1);
    const state = await h.repository.transactionDecision(h.decisionId, record => record);
    expect(state?.job).toBeNull();
    expect(state?.publicProposal).toBeNull();
    expect(state?.status).toBe('READY');
    runtime.stop();
  });
  it('does not let an obsolete completion cancel a newer job epoch', async () => {
    const h = await createEvaluationDecision();
    let newerId = '';
    const send = vi.fn(async (command: ConverseCommand) => {
      const state = await h.repository.transactionDecision(h.decisionId, record => record);
      await h.application.cancelReasoning(h.service, h.decisionId, state!.job!.id);
      newerId = (await h.application.startReasoning(h.service, h.decisionId)).id;
      return syntheticResponse(command);
    });
    const runtime = compose(h, send);
    await expect(runtime.negotiator.generate(evaluationPrincipal('maya'), h.decisionId)).rejects.toMatchObject({ code: 'MODEL_FAILED' });
    const state = await h.repository.transactionDecision(h.decisionId, record => record);
    expect(state?.job?.id).toBe(newerId);
    expect(state?.status).toBe('REASONING');
    expect(state?.publicProposal).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
    runtime.stop();
  });
  it.each(['expiry', 'control'] as const)('checks %s transactionally before applying a proposal', async change => {
    let instant = Date.now();
    const h = await createEvaluationDecision({ now: () => new Date(instant).toISOString() });
    const original = h.application.completeReasoning.bind(h.application);
    vi.spyOn(h.application, 'completeReasoning').mockImplementation(async (principal, decisionId, jobId, candidate, guard) => {
      if (change === 'expiry') instant += 30_001;
      else await h.repository.transactionDecision(h.decisionId, record => { record!.controlVersion++; });
      return original(principal, decisionId, jobId, candidate, guard);
    });
    const runtime = compose(h, syntheticResponse);
    const result = await runtime.negotiator.generate(evaluationPrincipal('maya'), h.decisionId);
    expect(result.outcome).toBe('STALE');
    expect(result.publicSnapshot.currentProposal).toBeNull();
    expect((await h.repository.transactionDecision(h.decisionId, record => record))?.job).toBeNull();
    runtime.stop();
  });
  it('bounds malformed proposal repairs to two isolated calls, leaving consent unchanged', async () => {
    const h = await createEvaluationDecision();
    const send = vi.fn(async (command: ConverseCommand) => ({ ...syntheticResponse(command),
      output: { message: { role: 'assistant' as const, content: [{ text: '{"publishPrivateReason":"CANARY"}' }] } } }));
    const runtime = compose(h, send);
    await expect(runtime.negotiator.generate(evaluationPrincipal('maya'), h.decisionId)).rejects.toMatchObject({ code: 'INVALID_MODEL_OUTPUT' });
    expect(send).toHaveBeenCalledTimes(2);
    const owner = await h.application.getOwnerSnapshot(evaluationPrincipal('maya'), h.decisionId);
    expect(owner.ownApproval).toBeNull();
    expect(owner.publicSnapshot.currentProposal).toBeNull();
    expect(JSON.stringify(owner)).not.toContain('CANARY');
    runtime.stop();
  });
});
