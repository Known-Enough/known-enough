import { describe, expect, it, vi } from 'vitest';
import type { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { InMemoryRoomRepository } from '@deal-table/adapters';
import type { KnownEnoughRecord } from '@deal-table/application';
import { buildChristmasPublicCandidates } from '../../../packages/test-support/src/known-enough-fixtures.ts';
import { createEvaluationDecision, evaluationPrincipal } from '../../../tests/evaluations/ke10.ts';
import { response, syntheticResponse } from '../../../tests/evaluations/ke10-injected.ts';
import { createKnownEnoughModelRuntime } from './model-runtime.ts';

function compose(h: Awaited<ReturnType<typeof createEvaluationDecision>>, send: (command: ConverseCommand) => ReturnType<typeof syntheticResponse> | Promise<ReturnType<typeof syntheticResponse>>) {
  return createKnownEnoughModelRuntime({ ...h, provider: { mode: 'INJECTED', transport: { send: async command => send(command) } },
    publicCandidates: buildChristmasPublicCandidates });
}
const messages = [{ role: 'owner', text: 'My maximum is USD 1600.' }];

class DelayedProposalRepository extends InMemoryRoomRepository {
  private pauseNextProposal = false;
  private enterTransaction!: () => void;
  private releaseTransaction!: () => void;
  private readonly proposalEntered = new Promise<void>(resolve => { this.enterTransaction = resolve; });
  private readonly transactionRelease = new Promise<void>(resolve => { this.releaseTransaction = resolve; });
  committedProposal = false;

  pauseProposalCommit(): void { this.pauseNextProposal = true; }
  waitForProposalCommit(): Promise<void> { return this.proposalEntered; }
  releaseProposalCommit(): void { this.releaseTransaction(); }

  override async transactionDecision<T>(
    decisionId: string,
    transition: (decision: KnownEnoughRecord | null) => Promise<T> | T,
  ): Promise<T> {
    let paused = false;
    const result = await super.transactionDecision(decisionId, async decision => {
      const outcome = await transition(decision);
      if (this.pauseNextProposal && decision?.status === 'PROPOSED' && decision.publicProposal) {
        this.pauseNextProposal = false;
        paused = true;
        this.enterTransaction();
        await this.transactionRelease;
      }
      return outcome;
    });
    if (paused) this.committedProposal = true;
    return result;
  }
}

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
    await runtime.stop();
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
    await runtime.stop();
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
    await runtime.stop();
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
    await runtime.stop();
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
    await runtime.stop();
  });
  it('stop before the owner transaction prevents a completed model response from storing a draft', async () => {
    const h = await createEvaluationDecision();
    const original = h.application.storeConstraintDraft.bind(h.application);
    vi.spyOn(h.application, 'storeConstraintDraft').mockImplementation(async (principal, input, guard) => {
      void runtime.stop();
      return original(principal, input, guard);
    });
    const runtime = compose(h, syntheticResponse);
    await expect(runtime.ownerConversation.draft(evaluationPrincipal('maya'), { decisionId: h.decisionId, messages }))
      .rejects.toMatchObject({ code: 'STALE_CONTEXT' });
    const stored = await h.repository.transactionDecision(h.decisionId, record => record);
    expect(stored?.owners.find(owner => owner.participantId === 'maya')?.draft).toBeNull();
  });
  it('stop before the proposal transaction prevents publication after a completed model response', async () => {
    const h = await createEvaluationDecision();
    const original = h.application.completeReasoning.bind(h.application);
    vi.spyOn(h.application, 'completeReasoning').mockImplementation(async (principal, decisionId, jobId, candidate, guard) => {
      void runtime.stop();
      return original(principal, decisionId, jobId, candidate, guard);
    });
    const runtime = compose(h, syntheticResponse);
    const result = await runtime.negotiator.generate(evaluationPrincipal('maya'), h.decisionId);
    expect(result.outcome).toBe('STALE');
    expect(result.publicSnapshot.currentProposal).toBeNull();
    const stored = await h.repository.transactionDecision(h.decisionId, record => record);
    expect(stored?.job).toBeNull();
    expect(stored?.publicProposal).toBeNull();
  });
  it('waits for an in-flight proposal transaction before awaited stop resolves', async () => {
    const repository = new DelayedProposalRepository();
    const h = await createEvaluationDecision(undefined, repository);
    repository.pauseProposalCommit();
    const runtime = compose(h, syntheticResponse);
    const generating = runtime.negotiator.generate(evaluationPrincipal('maya'), h.decisionId);
    try {
      await repository.waitForProposalCommit();
      let stopResolved = false;
      const stopping = runtime.stop().then(() => { stopResolved = true; });
      await Promise.resolve();
      expect(stopResolved).toBe(false);
      expect(repository.committedProposal).toBe(false);
      repository.releaseProposalCommit();
      await stopping;
      expect(repository.committedProposal).toBe(true);
      expect(stopResolved).toBe(true);
      expect((await generating).outcome).toBe('APPLIED');
      const stored = await repository.transactionDecision(h.decisionId, decision => decision);
      expect(stored?.publicProposal).not.toBeNull();
    } finally {
      repository.releaseProposalCommit();
      await runtime.stop();
    }
  });
  it('stop during frame construction rejects the completed model draft', async () => {
    const h = await createEvaluationDecision();
    let stopped = false;
    const ids = { next: () => {
      if (!stopped) { stopped = true; void runtime.stop(); }
      return 'late-public-draft';
    } };
    const runtime = createKnownEnoughModelRuntime({ ...h, ids, provider: { mode: 'INJECTED', transport: { send: async command => syntheticResponse(command) } },
      publicCandidates: buildChristmasPublicCandidates });
    await expect(runtime.architect.draft('subject-maya', { draftId: 'late-draft', revision: 1,
      objective: 'Choose together.', participants: [{ id: 'maya', displayName: 'Maya' }], allowedOptions: ['Cancún', 'Oaxaca'] }))
      .rejects.toMatchObject({ code: 'STALE_CONTEXT' });
  });
  it.each(['stop', 'control'] as const)('%s after a permission-needed result issues no question and releases the exact pending candidate', async change => {
    const h = await createEvaluationDecision();
    const original = h.application.completeReasoning.bind(h.application);
    vi.spyOn(h.application, 'completeReasoning').mockImplementation(async (...args) => {
      const outcome = await original(...args);
      if (outcome === 'NEEDS_PERMISSION') {
        if (change === 'stop') void runtime.stop();
        else await h.repository.transactionDecision(h.decisionId, record => { record!.controlVersion++; });
      }
      return outcome;
    });
    const runtime = compose(h, command => {
      const input = JSON.parse(command.input.messages![0]!.content![0]!.text!) as {
        publicCandidates: unknown[]; confirmedConstraints: { ownerParticipantId: string; constraintId: string; constraintVersion: number }[];
      };
      const nina = input.confirmedConstraints.find(item => item.ownerParticipantId === 'nina' && item.constraintId === 'nina-destination-flexibility')!;
      return response({ candidateIndex: 3, permissionDependencies: [],
        questionIntents: [{ ownerParticipantId: 'nina', constraintId: nina.constraintId,
          constraintVersion: nina.constraintVersion, adjustmentVariableId: 'destination', adjustmentOptionIds: ['mazatlan'] }] },
      'ke_negotiation_output');
    });
    const result = await runtime.negotiator.generate(evaluationPrincipal('maya'), h.decisionId);
    expect(result.outcome).toBe('STALE');
    const state = await h.repository.transactionDecision(h.decisionId, record => record);
    expect(state?.status).toBe('READY');
    expect(state?.pendingCandidate).toBeNull();
    expect(state?.owners.find(owner => owner.participantId === 'nina')?.pendingQuestions).toEqual([]);
  });
  it('bounds malformed proposal repairs to two isolated calls, leaving consent unchanged', async () => {
    const h = await createEvaluationDecision();
    const send = vi.fn(async () => response({ publishPrivateReason: 'CANARY' }, 'ke_negotiation_output'));
    const runtime = compose(h, send);
    await expect(runtime.negotiator.generate(evaluationPrincipal('maya'), h.decisionId)).rejects.toMatchObject({ code: 'INVALID_MODEL_OUTPUT' });
    expect(send).toHaveBeenCalledTimes(2);
    const owner = await h.application.getOwnerSnapshot(evaluationPrincipal('maya'), h.decisionId);
    expect(owner.ownApproval).toBeNull();
    expect(owner.publicSnapshot.currentProposal).toBeNull();
    expect(JSON.stringify(owner)).not.toContain('CANARY');
    await runtime.stop();
  });
});
