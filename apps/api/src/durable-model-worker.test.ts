import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { afterEach, expect, it, vi } from 'vitest';
import { createDurableNegotiationWorker, createManagedDurableNegotiationWorker } from './durable-model-worker.ts';
import { durableFixture } from '../../../packages/adapters/src/test-support/durable-model-fixture.ts';
import { JOB_TARGET as r } from '../../../packages/adapters/src/dynamo-model-jobs.ts';
afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const f = await durableFixture(implementation => vi.spyOn(DynamoDBClient.prototype, 'send').mockImplementation(implementation as never)); const model = vi.fn(async (_input: Parameters<Parameters<typeof createDurableNegotiationWorker>[0]['model']>[0]): Promise<{ output: unknown; usage: { inputTokens: number; outputTokens: number } }> => { void _input; return ({ output: { values: [], permissionDependencies: [], questionIntents: [], explanationDraft: 'private model explanation' }, usage: { inputTokens: 5, outputTokens: 3 } }); });
  let principal: { kind: 'participant'; subject: string } | null = { kind: 'participant', subject: 'iris' }; let enabled = true;
  const load = vi.fn(async () => ({ principal, fence: f.fence(), enabled }));
  const worker = () => createDurableNegotiationWorker({ now: f.now, store: f.store(), load, model, publicCandidates: () => [[]] });
  return { ...f, model, load, worker, revokeIdentity: () => { principal = null; }, stop: () => { enabled = false; } };
}
it('reconstructs real application context; real kernel/application result and guard commit together', async () => {
  const f = await fixture(); await f.worker().enqueue(f.reference); expect(await f.worker().process({ jobId: f.reference.jobId })).toBe('APPLIED');
  const output = f.parsed(r.decisions, 'ROOM#decision').record;
  expect(output.status).toBe('PROPOSED'); expect(output.job).toBe(null); expect(output.publicProposal.facts.values).toEqual([]);
  expect(JSON.stringify(output.publicProposal)).not.toMatch(/private|explanationDraft|reasoning|MODELJOB/);
  const input = f.model.mock.calls[0]![0]; expect(JSON.stringify(input)).not.toMatch(/private-condition|sourceSummary|rawTurns/);
  expect(f.load.mock.calls).toHaveLength(4); expect(f.get(r.decisions, 'ROOM#decision', 'GUARD').version!.N).toBe('2');
  expect(f.parsed(r.budget, 'TOTAL').reservedTokens).toBe(18_932);
});
it.each(['identity', 'kill', 'account', 'other-account', 'retention', 'other-retention', 'group', 'semantic', 'readiness', 'confirmation', 'confirmation-version', 'job'] as const)('fresh %s withdrawal before dispatch denies paid call', async change => {
  const f = await fixture(); await f.worker().enqueue(f.reference);
  if (change === 'identity') f.revokeIdentity(); else if (change === 'kill') f.stop();
  else if (change === 'account' || change === 'other-account') {
    const cell = f.get(r.partitions, change === 'account' ? 'ACCOUNT#iris' : 'ACCOUNT#omar'); const value = JSON.parse(cell.payload!.S!); value.value.status = 'REJECTED'; cell.payload = { S: JSON.stringify(value) };
  } else if (change === 'retention' || change === 'other-retention') {
    const cell = f.get(r.journal, change === 'retention' ? 'RETENTION#iris' : 'RETENTION#omar', 'STAMP'); const value = JSON.parse(cell.payload!.S!); value.lastActivityAt = '2026-10-01T00:00:00Z'; value.createdAt = value.lastActivityAt; cell.payload = { S: JSON.stringify(value) };
  } else if (change === 'group') {
    const cell = f.get(r.partitions, 'GROUP#garden'); const value = JSON.parse(cell.payload!.S!); value.value.members = ['omar']; cell.payload = { S: JSON.stringify(value) };
  } else {
    const cell = f.get(r.decisions, 'ROOM#decision'), value = JSON.parse(cell.payload!.S!);
    if (change === 'semantic') value.record.definition.semanticVersion++; else if (change === 'readiness') value.record.owners[0].readiness = 'NOT_STARTED';
    else if (change === 'confirmation') value.record.frameConfirmations = []; else if (change === 'confirmation-version') value.record.frameConfirmations[0].frameVersion++; else value.record.job.id = 'replacement-job';
    cell.payload = { S: JSON.stringify(value) };
  }
  expect(await f.worker().process({ jobId: f.reference.jobId })).toBe('DEAD'); expect(f.model).not.toHaveBeenCalled(); expect(f.parsed(r.budget, 'TOTAL').reservedTokens).toBe(500);
});
it.each(['identity', 'kill', 'consent', 'retention'] as const)('fresh %s withdrawal after provider prevents transaction output while preserving charges', async change => {
  const f = await fixture(); await f.worker().enqueue(f.reference); f.model.mockImplementation(async () => {
    if (change === 'identity') f.revokeIdentity(); else if (change === 'kill') f.stop(); else if (change === 'retention') f.setTime(f.now() + 86_400_000);
    else { const cell = f.get(r.decisions, 'ROOM#decision'), value = JSON.parse(cell.payload!.S!); value.record.frameConfirmations = []; cell.payload = { S: JSON.stringify(value) }; }
    return { output: { values: [], permissionDependencies: [], questionIntents: [], explanationDraft: 'private model explanation' }, usage: { inputTokens: 5, outputTokens: 3 } };
  });
  expect(await f.worker().process({ jobId: f.reference.jobId })).toBe('DEAD'); expect(f.parsed(r.decisions, 'ROOM#decision').record.candidate).toBe(null);
  expect(f.parsed(r.budget, 'TOTAL').reservedTokens).toBe(18_932);
});
it('model output beyond the trusted catalog or excess usage cannot become application/public state', async () => {
  const f = await fixture(); await f.worker().enqueue(f.reference);
  f.model.mockImplementation(async () => ({ output: { values: [], permissionDependencies: [], questionIntents: [], explanationDraft: 'private output' }, usage: { inputTokens: 999_999, outputTokens: 3 } }));
  expect(await f.worker().process({ jobId: f.reference.jobId })).toBe('DEAD'); expect(f.parsed(r.decisions, 'ROOM#decision').record.candidate).toBe(null);
  expect(f.parsed(r.journal, `MODELJOB#${f.reference.jobId}`).reason).toBe('INVALID_OUTPUT');
});

it.each(['valid', 'missing', 'duplicate', 'invalid-adjustment'] as const)('real negotiable-consent question path is atomic and fail-closed: %s', async mode => {
  const f = await fixture();
  const record = f.record, owner = record.owners[0]!;
  record.definition.variables = [{ id: 'attend', label: 'Attend', type: 'ENUM', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }], required: true, visibility: 'PUBLIC', ownerParticipantId: null }];
  owner.confirmedConstraints = [{ schemaVersion: 2, kind: 'NEGOTIABLE', constraintId: 'attendance-flexibility', decisionId: 'decision',
    ownerParticipantId: owner.participantId, constraintVersion: 1, ownerVersion: owner.ownerVersion, semanticVersion: 1,
    contextToken: record.definition.contextToken, confirmedAt: new Date(f.now()).toISOString(), status: 'ACTIVE', sourceSummary: 'private synthetic condition',
    rule: { id: 'attendance-condition', visibility: 'TRUSTED_BACKEND', operator: 'COMPARE', variableId: 'attend', comparison: 'EQ', value: { type: 'ENUM', optionId: 'no' } } }];
  const cell = f.get(r.decisions, 'ROOM#decision'), state = JSON.parse(cell.payload!.S!); state.record = record; delete state.record.replays; cell.payload = { S: JSON.stringify(state) };
  const values = [{ variableId: 'attend', value: { type: 'ENUM' as const, optionId: 'yes' } }];
  const intent = { ownerParticipantId: owner.participantId, constraintId: 'attendance-flexibility', constraintVersion: 1,
    adjustment: { id: 'attendance-adjustment', visibility: 'TRUSTED_BACKEND', operator: 'COMPARE', variableId: mode === 'invalid-adjustment' ? 'foreign' : 'attend', comparison: 'EQ', value: { type: 'ENUM', optionId: 'yes' } } };
  const model = vi.fn(async () => ({ output: { values, permissionDependencies: [], questionIntents: mode === 'missing' ? [] : mode === 'duplicate' ? [intent, intent] : [intent] }, usage: { inputTokens: 10, outputTokens: 10 } }));
  const worker = createDurableNegotiationWorker({ now: f.now, store: f.store(), load: async () => ({ principal: { kind: 'participant', subject: 'iris' }, fence: f.fence(), enabled: true }), model, publicCandidates: () => [values] });
  await worker.enqueue(f.reference); const outcome = await worker.process({ jobId: f.reference.jobId }); expect(outcome).toBe(mode === 'valid' ? 'APPLIED' : 'DEAD');
  const result = f.parsed(r.decisions, 'ROOM#decision').record;
  expect(result.publicProposal).toBe(null); expect(result.candidate).toBe(null);
  if (mode === 'valid') {
    expect(result.status).toBe('PRIVATE_NEGOTIATION'); expect(result.owners[0].pendingQuestions).toHaveLength(1);
    expect(result.owners[0].negotiationPermissions).toEqual([]); expect(result.owners[1].pendingQuestions).toEqual([]);
  } else { expect(result.status).toBe('READY'); expect(result.job).toBe(null); expect(result.owners[0].pendingQuestions).toEqual([]); }
  expect(f.parsed(r.budget, 'TOTAL').reservedTokens).toBe(18_932);
});
it('complete inactive native composition reloads bounded snapshots and uses the real one-attempt Bedrock parser/usage', async () => {
  const f = await durableFixture(implementation => vi.spyOn(DynamoDBClient.prototype, 'send').mockImplementation(implementation as never));
  const provider = vi.spyOn(BedrockRuntimeClient.prototype, 'send').mockImplementation(async function(this: BedrockRuntimeClient, command, request) {
    expect(await this.config.region()).toBe('us-east-1'); expect(await this.config.maxAttempts()).toBe(1); expect(request).toHaveProperty('abortSignal');
    expect(command).toBeInstanceOf(ConverseCommand);
    const input = (command as ConverseCommand).input, name = input.toolConfig!.toolChoice!.tool!.name!;
    expect(input.modelId).toBe('amazon.nova-lite-v1:0'); expect(input.inferenceConfig!.maxTokens).toBe(2048);
    expect(JSON.stringify(input.messages)).not.toMatch(/private-condition|sourceSummary|rawTurns/);
    return { $metadata: {}, stopReason: 'tool_use', output: { message: { role: 'assistant', content: [{ toolUse: {
      toolUseId: 'synthetic-tool', name, input: { candidateIndex: 0, permissionDependencies: [], questionIntents: [] },
    } }] } }, usage: { inputTokens: 9, outputTokens: 4, totalTokens: 13 } };
  });
  const options = { verifiedTarget: { account: r.account, region: r.region }, sourceSha: f.reference.sourceSha,
    approval: { paidCallsApproved: true, invocationLoggingDisabled: true, retentionReviewed: true }, publicCandidates: () => [[]], now: f.now };
  const worker = createManagedDurableNegotiationWorker(options); expect(provider).not.toHaveBeenCalled();
  expect(() => worker.enqueue({ kind: 'participant', subject: 'other' }, f.reference)).toThrow('MODEL_JOB_STALE');
  await worker.enqueue({ kind: 'participant', subject: 'iris' }, f.reference);
  expect(await createManagedDurableNegotiationWorker(options).process({ jobId: f.reference.jobId })).toBe('APPLIED');
  expect(provider).toHaveBeenCalledTimes(1); expect(f.parsed(r.journal, `MODELJOB#${f.reference.jobId}`).usage).toEqual({ inputTokens: 9, outputTokens: 4 });
  expect(f.parsed(r.budget, 'TOTAL').reservedTokens).toBe(18_932); expect(f.parsed(r.decisions, 'ROOM#decision').record.status).toBe('PROPOSED');
});
it('inactive native composition denies missing provider controls at construction without network/usage', async () => {
  expect(() => createManagedDurableNegotiationWorker({ verifiedTarget: { account: r.account, region: r.region }, sourceSha: 'a'.repeat(40),
    approval: { paidCallsApproved: true, invocationLoggingDisabled: false, retentionReviewed: true }, publicCandidates: () => [[]] })).toThrow('DISABLED');
});
it('known malformed model result cancels only its matching reasoning in the joined transaction', async () => {
  const f = await fixture(); await f.worker().enqueue(f.reference); f.model.mockImplementation(async () => ({ output: { values: [], permissionDependencies: [], questionIntents: [], extra: 'ignored-private' }, usage: { inputTokens: 4, outputTokens: 3 } }));
  expect(await f.worker().process({ jobId: f.reference.jobId })).toBe('DEAD');
  expect(f.parsed(r.decisions, 'ROOM#decision').record).toMatchObject({ status: 'READY', job: null });
  expect(f.parsed(r.journal, `MODELJOB#${f.reference.jobId}`).usage).toEqual({ inputTokens: 4, outputTokens: 3 });
  expect(f.parsed(r.budget, 'TOTAL').reservedTokens).toBe(18_932);
});
it('unknown paid-call failure leaves reasoning and capacity quarantined; verified recovery cancels current matching work', async () => {
  const f = await fixture();
  const model = vi.fn(async () => { throw new Error('synthetic unknown provider outcome'); });
  const worker = createDurableNegotiationWorker({ now: f.now, store: f.store(), load: async () => ({ principal: { kind: 'participant', subject: 'iris' }, fence: f.fence(), enabled: true }), model,
    publicCandidates: () => [[]], reconcile: async () => ({ providerStopped: true, proofHash: 'd'.repeat(64), usage: { inputTokens: 2, outputTokens: 1 } }) });
  await worker.enqueue(f.reference); expect(await worker.process({ jobId: f.reference.jobId })).toBe('DEAD');
  expect(f.parsed(r.decisions, 'ROOM#decision').record.status).toBe('REASONING'); expect(f.parsed(r.journal, 'OPERATIONS#MODEL_JOBS').slots).toHaveLength(1);
  await worker.reconcile({ jobId: f.reference.jobId }, 'synthetic verified managed proof');
  expect(f.parsed(r.decisions, 'ROOM#decision').record).toMatchObject({ status: 'READY', job: null }); expect(f.parsed(r.journal, 'OPERATIONS#MODEL_JOBS').slots).toHaveLength(0);
  expect(f.parsed(r.budget, 'TOTAL').reservedTokens).toBe(18_932); expect(model).toHaveBeenCalledTimes(1);
});
