import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { afterEach, expect, it, vi } from 'vitest';
import { createDurableNegotiationWorker } from './durable-model-worker.ts';
import { durableFixture } from '../../../packages/adapters/src/test-support/durable-model-fixture.ts';
import { createDynamoModelJobLoader, JOB_TARGET as target } from '../../../packages/adapters/src/dynamo-model-jobs.ts';

afterEach(() => vi.restoreAllMocks());

const changes = ['actor-disabled', 'peer-disabled', 'member-removed', 'binding-revised', 'decision-retargeted'] as const;
type Change = typeof changes[number];
type Fixture = Awaited<ReturnType<typeof durableFixture>>;

function withdraw(f: Fixture, change: Change) {
  const PK = change === 'actor-disabled' ? 'ACCOUNT#iris' : change === 'peer-disabled' ? 'ACCOUNT#omar'
    : change === 'decision-retargeted' ? 'DECISION#decision' : 'GROUP#garden';
  const SK = change === 'decision-retargeted' ? 'GROUP' : change === 'binding-revised' ? 'BINDING#decision' : 'STATE';
  const cell = f.get(target.partitions, PK, SK), row = JSON.parse(cell.payload!.S!);
  row.revision++;
  if (change === 'actor-disabled' || change === 'peer-disabled') { row.value.status = 'DISABLED'; row.value.version++; }
  else if (change === 'member-removed') { row.value.members = ['iris']; row.value.version++; }
  else if (change === 'binding-revised') row.value.version++;
  else row.value.groupId = 'another-group';
  cell.revision = { N: String(row.revision) }; cell.payload = { S: JSON.stringify(row) };
  return { PK, SK, payload: cell.payload.S };
}

for (const stage of ['provider-pending', 'output-commit'] as const) {
  it.each(changes)('late %s at ' + stage + ' cannot publish, restore consent, or repeat a charged call', async change => {
    const f = await durableFixture(implementation => vi.spyOn(DynamoDBClient.prototype, 'send').mockImplementation(implementation as never));
    let entered!: () => void, release!: () => void;
    const providerEntered = new Promise<void>(resolve => { entered = resolve; });
    const providerReleased = new Promise<void>(resolve => { release = resolve; });
    const model = vi.fn(async () => {
      entered(); await providerReleased;
      return { output: { values: [], permissionDependencies: [], questionIntents: [], explanationDraft: 'FIN02_PRIVATE_OUTPUT_CANARY' },
        usage: { inputTokens: 5, outputTokens: 3 } };
    });
    const load = createDynamoModelJobLoader({ verifiedTarget: { account: target.account, region: target.region }, sourceSha: f.reference.sourceSha });
    const worker = () => createDurableNegotiationWorker({ now: f.now, store: f.store(), load, model, publicCandidates: () => [[]] });
    await worker().enqueue(f.reference);
    const stateBefore = structuredClone(f.get(target.decisions, 'ROOM#decision'));
    const guardBefore = structuredClone(f.get(target.decisions, 'ROOM#decision', 'GUARD'));
    let changed: ReturnType<typeof withdraw> | null = null, outputAttempted = false;
    f.before(items => {
      if (!items.some(item => item.Put?.TableName === target.decisions)) return;
      outputAttempted = true;
      if (stage === 'output-commit' && !changed) changed = withdraw(f, change);
    });
    const processing = worker().process({ jobId: f.reference.jobId });
    await providerEntered;
    if (stage === 'provider-pending') changed = withdraw(f, change);
    release();
    expect(await processing).toBe('DEAD');
    expect(outputAttempted).toBe(stage === 'output-commit');
    expect(changed).not.toBeNull();
    expect(f.get(target.partitions, changed!.PK, changed!.SK).payload!.S).toBe(changed!.payload);
    // Reject the complete joined output: public proposal, private owner state, confirmations and guard are unchanged.
    expect(f.get(target.decisions, 'ROOM#decision')).toEqual(stateBefore);
    expect(f.get(target.decisions, 'ROOM#decision', 'GUARD')).toEqual(guardBefore);
    const disposition = f.parsed(target.journal, `MODELJOB#${f.reference.jobId}`);
    expect(disposition).toMatchObject({ phase: 'DEAD', reason: 'STALE', usage: { inputTokens: 5, outputTokens: 3 } });
    expect(JSON.stringify(disposition)).not.toContain('FIN02_PRIVATE_OUTPUT_CANARY');
    const charges = f.parsed(target.budget, 'TOTAL');
    expect(charges).toEqual({ runs: 8, messages: 6, reservedTokens: 18_932, reservedCostMicros: 10_700 });
    expect(await worker().process({ jobId: f.reference.jobId })).toBe('SKIPPED');
    expect(f.parsed(target.budget, 'TOTAL')).toEqual(charges);
    expect(model).toHaveBeenCalledTimes(1);
  });
}
