import { expect, it, vi } from 'vitest';
import type { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { InMemoryRoomRepository } from '@deal-table/adapters';
import type { KnownEnoughRecord } from '@deal-table/application';
import { buildChristmasPublicCandidates } from '../../../packages/test-support/src/known-enough-fixtures.ts';
import { createEvaluationDecision, evaluationPrincipal } from '../../../tests/evaluations/ke10.ts';
import { response, syntheticResponse } from '../../../tests/evaluations/ke10-injected.ts';
import { createKnownEnoughModelRuntime } from './model-runtime.ts';

type OutputKind = 'owner' | 'question';
class DelayedOutputRepository extends InMemoryRoomRepository {
  private armed: OutputKind | null = null;
  private fail = false;
  private enter!: () => void;
  private release!: () => void;
  readonly entered = new Promise<void>(resolve => { this.enter = resolve; });
  private readonly released = new Promise<void>(resolve => { this.release = resolve; });
  committed = false;
  arm(kind: OutputKind, fail: boolean) { this.armed = kind; this.fail = fail; }
  unblock() { this.release(); }
  override async transactionDecision<T>(id: string, transition: (record: KnownEnoughRecord | null) => T | Promise<T>): Promise<T> {
    let paused = false;
    const result = await super.transactionDecision(id, async record => {
      const drafts = record?.owners.map(owner => owner.draft?.draftId);
      const questions = record?.owners.reduce((count, owner) => count + owner.pendingQuestions.length, 0) ?? 0;
      const value = await transition(record);
      const changed = this.armed === 'owner'
        ? record?.owners.some((owner, index) => owner.draft?.draftId !== drafts?.[index])
        : this.armed === 'question' && (record?.owners.reduce((count, owner) => count + owner.pendingQuestions.length, 0) ?? 0) > questions;
      if (changed) {
        this.armed = null; paused = true; this.enter(); await this.released;
        if (this.fail) throw new Error('SYNTHETIC_OUTPUT_STORAGE_FAILURE');
      }
      return value;
    });
    if (paused) this.committed = true;
    return result;
  }
}
function questionResponse(command: ConverseCommand) {
  const input = JSON.parse(command.input.messages![0]!.content![0]!.text!) as {
    confirmedConstraints: { ownerParticipantId: string; constraintId: string; constraintVersion: number }[];
  };
  const target = input.confirmedConstraints.find(item => item.ownerParticipantId === 'nina' && item.constraintId === 'nina-destination-flexibility')!;
  return response({ candidateIndex: 3, permissionDependencies: [], questionIntents: [{ ownerParticipantId: 'nina',
    constraintId: target.constraintId, constraintVersion: target.constraintVersion,
    adjustmentVariableId: 'destination', adjustmentOptionIds: ['mazatlan'] }] }, 'ke_negotiation_output');
}
it.each(['owner', 'question'] as const)('awaited stop drains an entered %s output commit and closes later provider admission', async kind => {
  await checkDrain(kind, false);
});
it.each(['owner', 'question'] as const)('failed entered %s storage settles awaited stop without committing output or granting consent', async kind => {
  await checkDrain(kind, true);
});
async function checkDrain(kind: OutputKind, fail: boolean) {
  const repository = new DelayedOutputRepository(); const h = await createEvaluationDecision(undefined, repository);
  const before = await h.application.getOwnerSnapshot(evaluationPrincipal(kind === 'owner' ? 'maya' : 'nina'), h.decisionId);
  const send = vi.fn(async (command: ConverseCommand) => kind === 'owner' ? syntheticResponse(command) : questionResponse(command));
  const runtime = createKnownEnoughModelRuntime({ ...h, provider: { mode: 'INJECTED', transport: { send } }, publicCandidates: buildChristmasPublicCandidates });
  repository.arm(kind, fail);
  // Attach rejection handling before the deterministic storage barrier can fail.
  const producing = (kind === 'owner'
    ? runtime.ownerConversation.draft(evaluationPrincipal('maya'), { decisionId: h.decisionId, messages: [{ role: 'owner', text: 'Synthetic maximum USD 1600.' }] })
    : runtime.negotiator.generate(evaluationPrincipal('maya'), h.decisionId)).then(value => ({ value }), error => ({ error }));
  try {
    await repository.entered; expect(send).toHaveBeenCalledTimes(1);
    let resolved = false; const stopping = runtime.stop(); void stopping.then(() => { resolved = true; });
    await Promise.resolve(); expect(runtime.isEnabled()).toBe(false); expect(resolved).toBe(false); expect(repository.committed).toBe(false);
    repository.unblock(); await stopping; await producing;
    expect(resolved).toBe(true); expect(repository.committed).toBe(!fail);
    const owner = await h.application.getOwnerSnapshot(evaluationPrincipal(kind === 'owner' ? 'maya' : 'nina'), h.decisionId);
    expect(owner.negotiationPermissions).toEqual(before.negotiationPermissions); expect(owner.ownApproval).toEqual(before.ownApproval);
    if (kind === 'owner') expect(owner.draft?.draftId === before.draft?.draftId).toBe(fail);
    else expect(owner.pendingQuestions.filter(question => question.status === 'PENDING')).toHaveLength(fail ? 0 : 1);
    await expect(runtime.ownerConversation.draft(evaluationPrincipal('maya'), { decisionId: h.decisionId,
      messages: [{ role: 'owner', text: 'Synthetic request after stop.' }] })).rejects.toBeDefined();
    await runtime.stop(); expect(send).toHaveBeenCalledTimes(1);
  } finally { repository.unblock(); await runtime.stop(); await producing; }
}
