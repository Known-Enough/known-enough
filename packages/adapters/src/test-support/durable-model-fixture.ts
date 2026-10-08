import { randomUUID } from 'node:crypto';
import { DynamoDBClient, TransactGetItemsCommand, TransactWriteItemsCommand, type AttributeValue, type TransactWriteItem } from '@aws-sdk/client-dynamodb';
import assert from 'node:assert/strict';
import { KnownEnough as KE } from '@deal-table/contracts';
import { lifecycleFixture, sourceSha, now, policy, stamp } from './partition-lifecycle-fixture.ts';
import { encodeDecisionStateItem, encodeGuardItem } from '../dynamodb-codec.ts';
import { JOB_TARGET as r, createDynamoModelJobStore, type JobPin, type JobFence } from '../dynamo-model-jobs.ts';
import type { JobReference } from '../durable-model-jobs.ts';
import { modelJobAuthorityHash } from '../durable-model-jobs.ts';
type Item = Record<string, AttributeValue>;
const key = (PK: string, SK = 'STATE'): Item => ({ PK: { S: PK }, SK: { S: SK } });
const where = (table: string, item: Item) => `${table}/${item.PK!.S}/${item.SK!.S}`;
export async function durableFixture(intercept: (implementation: (this: DynamoDBClient, command: unknown, request: unknown) => Promise<Record<string, unknown>>) => unknown) {
  const base = await lifecycleFixture(); let time = now;
  const record = base.record; record.solveEpoch = 1; record.job!.epoch = 1; record.status = 'REASONING'; record.owners.forEach(owner => { owner.readiness = 'READY'; });
  record.frameConfirmations = record.definition.requiredParticipantIds.map(participantId => KE.FrameConfirmation.parse({ participantId,
    decisionId: record.decisionId, frameVersion: record.definition.frameVersion, contextToken: record.definition.contextToken, semanticVersion: record.definition.semanticVersion, confirmedAt: new Date(now).toISOString() }));
  const reference: JobReference = { jobId: randomUUID(), kind: 'NEGOTIATION', subject: 'iris', decisionId: 'decision', reasoningJobId: 'pending-job',
    sourceSha, authorityHash: modelJobAuthorityHash({ controlVersion: record.controlVersion, epoch: record.solveEpoch,
      contextToken: record.definition.contextToken, semanticVersion: record.definition.semanticVersion, consentRevision: record.controlVersion }), expiresAt: now + 60_000 };
  const pins: JobPin[] = [
    { table: r.source, key: { PK: 'NP#GROUPS', SK: 'STATE' }, attribute: 'version', revision: 14,
      payload: JSON.stringify({ schemaVersion: 1, kind: 'PARTITION_MIGRATION', phase: 'ACTIVE', planHash: base.migration.planHash, manifestHash: base.migration.manifestHash, manifestVersion: 'immutable-v1', sourceSha, sourceRevision: 12, sourceHash: base.migration.sourceHash, account: r.account, region: r.region, table: 'KnownEnoughPartitions' }) },
    { table: r.partitions, key: { PK: 'MIGRATION#CONTROL', SK: 'STATE' }, attribute: 'revision', revision: 3,
      payload: JSON.stringify({ schemaVersion: 1, revision: 3, account: r.account, region: r.region, table: 'KnownEnoughPartitions', active: true, planHash: base.migration.planHash }) },
    { table: r.journal, key: { PK: `PARTITION#${base.migration.planHash}`, SK: 'JOURNAL' }, attribute: 'revision', revision: base.migration.batches.length + 1,
      payload: JSON.stringify({ schemaVersion: 1, revision: base.migration.batches.length + 1, actorId: 143764700, state: 'COPIED', planHash: base.migration.planHash, manifestHash: base.migration.manifestHash, manifestVersion: 'immutable-v1', sourceSha, sourceRevision: 12, sourceHash: base.migration.sourceHash, rowCount: base.migration.rowCount, nextBatch: base.migration.batches.length, completedRows: base.migration.rowCount }) },
    ...base.data.entries.filter(entry => ['ACCOUNT','GROUP','BINDING'].includes(entry.row.kind) || (entry.row.kind === 'DIRECTORY' && entry.row.value.type === 'DECISION')).map(entry => ({ table: r.partitions, key: entry.key,
      attribute: 'revision' as const, revision: entry.row.revision, payload: JSON.stringify(entry.row) })),
    { table: r.decisions, key: { PK: 'ROOM#decision', SK: 'STATE' }, attribute: null, revision: null, payload: encodeDecisionStateItem(record).payload!.S! },
    { table: r.journal, key: { PK: 'OPERATIONS#RETENTION', SK: 'STATE' }, attribute: 'revision', revision: policy.revision, payload: JSON.stringify(policy) },
    { table: r.journal, key: { PK: 'RETENTION#iris', SK: 'STAMP' }, attribute: 'revision', revision: stamp.revision, payload: JSON.stringify(stamp) },
    { table: r.journal, key: { PK: 'RETENTION#omar', SK: 'STAMP' }, attribute: 'revision', revision: stamp.revision, payload: JSON.stringify(stamp) },
    { table: r.budget, key: { PK: 'AUTH', SK: 'STATE' }, attribute: 'version', revision: 2, payload: JSON.stringify({ mode: 'standing', approved: true, maxAttemptsPerRun: 12, maxTokensPerRun: 100000, maxCostMicrosPerRun: 100000, attemptCostMicros: 10000, maxSignupMessagesPerRun: 2, retentionReviewed: true, invocationLoggingDisabled: true }) },
  ];
  const cells = new Map<string, Item>();
  for (const pin of pins) cells.set(where(pin.table, key(pin.key.PK, pin.key.SK)), { ...key(pin.key.PK, pin.key.SK),
    ...(pin.attribute ? { [pin.attribute]: { N: String(pin.revision) } } : { schemaVersion: { N: '6' } }), payload: { S: pin.payload } });
  cells.set(where(r.decisions, key('ROOM#decision', 'GUARD')), encodeGuardItem('decision', base.guard));
  cells.set(where(r.journal, key('OPERATIONS#MODEL_JOBS')), { ...key('OPERATIONS#MODEL_JOBS'), revision: { N: '1' },
    payload: { S: JSON.stringify({ schemaVersion: 1, revision: 1, enabled: true, sourceSha, active: [], slots: [] }) } });
  cells.set(where(r.budget, key('TOTAL')), { ...key('TOTAL'), version: { N: '5' }, payload: { S: JSON.stringify({ runs: 8, reservedTokens: 500, reservedCostMicros: 700, messages: 6 }) } });
  const writes: TransactWriteItem[][] = []; let before = (items: TransactWriteItem[]) => { void items; }; let ackLost = false;
  const send = intercept(async function(this: DynamoDBClient, command, request) {
    assert.equal(await this.config.region(), r.region); assert.equal(await this.config.maxAttempts(), 1); assert.ok(request && typeof request === 'object' && 'abortSignal' in request);
    if (command instanceof TransactGetItemsCommand) return { Responses: command.input.TransactItems!.map(entry => ({ Item: structuredClone(cells.get(where(entry.Get!.TableName!, entry.Get!.Key!))) })) };
    if (!(command instanceof TransactWriteItemsCommand)) throw new Error('unexpected native command');
    const items = command.input.TransactItems!; writes.push(structuredClone(items)); before(items);
    assert.equal(new Set(items.map(item => { const op = item.Put ?? item.ConditionCheck!; return where(op.TableName!, item.Put?.Item ?? item.ConditionCheck!.Key!); })).size, items.length);
    const matches = items.map(entry => {
      const op = entry.Put ?? entry.ConditionCheck!; const actual = cells.get(where(op.TableName!, entry.Put?.Item ?? entry.ConditionCheck!.Key!));
      if (op.ConditionExpression === 'attribute_not_exists(PK)') return actual === undefined;
      return op.ConditionExpression!.split(' AND ').every(expression => {
        const [left, right] = expression.split('=').map(v => v.trim());
        return JSON.stringify(actual?.[op.ExpressionAttributeNames![left!]!]) === JSON.stringify(op.ExpressionAttributeValues![right!]);
      });
    });
    if (matches.some(value => !value)) throw Object.assign(new Error('synthetic CAS conflict'), { name: 'TransactionCanceledException', CancellationReasons: matches.map(value => ({ Code: value ? 'None' : 'ConditionalCheckFailed' })) });
    for (const item of items) if (item.Put) cells.set(where(item.Put.TableName!, item.Put.Item!), structuredClone(item.Put.Item!));
    if (ackLost) { ackLost = false; throw new Error('synthetic lost ack'); } return {};
  });
  const get = (table: string, PK: string, SK = 'STATE') => cells.get(where(table, key(PK, SK)))!;
  const parsed = (table: string, PK: string, SK = 'STATE') => JSON.parse(get(table, PK, SK).payload!.S!);
  const fence = (): JobFence => ({ reference: structuredClone(reference), guard: structuredClone(base.guard), pins: pins.map(pin => {
    const item = get(pin.table, pin.key.PK, pin.key.SK); return { ...structuredClone(pin), payload: item.payload!.S!, ...(pin.attribute ? { revision: Number(item[pin.attribute]!.N) } : {}) };
  }) });
  return { record, reference, cells, pins, writes, send, base, parsed, get, fence, now: () => time, setTime: (next: number) => { time = next; },
    before: (callback: typeof before) => { before = callback; }, loseAck: () => { ackLost = true; },
    store: () => createDynamoModelJobStore({ verifiedTarget: { account: r.account, region: r.region }, sourceSha }),
  };
}
