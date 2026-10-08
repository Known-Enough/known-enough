import { z } from 'zod';
import { MigrationControlSchema, MigrationJournalSchema } from './partition-migration-runner.ts';
import { checkPartitionRow } from './partitioned-group-repository.ts';
import { DynamoDBClient, TransactGetItemsCommand, TransactWriteItemsCommand, type TransactWriteItem } from '@aws-sdk/client-dynamodb';
import { encodeDecisionStateItem, decodeDecisionStateItem, encodeGuardItem, decodeGuardItem, type GuardRecord, validateDecisionStateGuard, decisionPermissionHistoryCount } from './dynamodb-codec.ts';
import { ControlSchema, JobSchema, TotalsSchema, DurableJobError,
  type DurableJobStore, type JobSnapshot, type JobReference } from './durable-model-jobs.ts';

export const JOB_TARGET = Object.freeze({ account: '092954139775', region: 'us-east-1',
  journal: 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughOperationsJournal',
  budget: 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughQaControl',
  source: 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughGroupsStage',
  partitions: 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughPartitions',
  decisions: 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughStage' });
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1);
const standingSchema = z.strictObject({ mode: z.literal('standing'), approved: z.literal(true), retentionReviewed: z.literal(true), invocationLoggingDisabled: z.literal(true),
  maxAttemptsPerRun: count.min(1), maxTokensPerRun: count.min(1), maxCostMicrosPerRun: count.min(1), attemptCostMicros: count.min(1), maxSignupMessagesPerRun: count.min(1) });
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const keySchema = z.strictObject({ PK: z.string().min(1).max(160), SK: z.string().min(1).max(160) });
const pinSchema = z.strictObject({ table: z.enum([JOB_TARGET.journal, JOB_TARGET.budget, JOB_TARGET.source, JOB_TARGET.partitions, JOB_TARGET.decisions]),
  key: keySchema, attribute: z.enum(['version', 'revision']).nullable(), revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1).nullable(),
  payload: z.string().min(2).max(360_000) });
export type JobPin = z.infer<typeof pinSchema>;
export interface JobFence { reference: JobReference; pins: JobPin[]; guard: GuardRecord }
export interface JobEffect { writes: { key: { PK: string; SK: string }; payload: string | null }[] }
const controlKey = { PK: 'OPERATIONS#MODEL_JOBS', SK: 'STATE' }, totalKey = { PK: 'TOTAL', SK: 'STATE' };
const jobKey = (jobId: string) => ({ PK: `MODELJOB#${z.string().uuid().parse(jobId)}`, SK: 'STATE' });
const attributes = (key: { PK: string; SK: string }) => ({ PK: { S: key.PK }, SK: { S: key.SK } });
const fail = (code: DurableJobError['code']): never => { throw new DurableJobError(code); };
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function condition(pin: JobPin) {
  return { TableName: pin.table, Key: attributes(pin.key), ConditionExpression: pin.attribute ? '#v = :v AND #p = :p' : '#p = :p',
    ExpressionAttributeNames: { ...(pin.attribute ? { '#v': pin.attribute } : {}), '#p': 'payload' },
    ExpressionAttributeValues: { ...(pin.attribute ? { ':v': { N: String(pin.revision) } } : {}), ':p': { S: pin.payload } } };
}
const pinIdentity = (pin: Pick<JobPin, 'table' | 'key'>) => `${pin.table}/${pin.key.PK}/${pin.key.SK}`;
/** Trusted reload snapshots only; bounded physical allowlist, exact source/identity/consent pins. */
export function checkedJobFence(raw: JobFence): JobFence {
  const parsed = z.strictObject({ reference: JobSchema.shape.reference, pins: z.array(pinSchema).min(8).max(64), guard: z.unknown() }).safeParse(raw);
  if (!parsed.success) return fail('INVALID'); const fence = parsed.data, ref = fence.reference;
  if (new Set(fence.pins.map(pinIdentity)).size !== fence.pins.length) fail('INVALID');
  const has = (table: JobPin['table'], PK: string, SK: string) => fence.pins.some(pin => pin.table === table && pin.key.PK === PK && pin.key.SK === SK);
  if (!has(JOB_TARGET.source, 'NP#GROUPS', 'STATE') || !has(JOB_TARGET.partitions, 'MIGRATION#CONTROL', 'STATE')
    || !fence.pins.some(pin => pin.table === JOB_TARGET.journal && /^PARTITION#[a-f0-9]{64}$/.test(pin.key.PK) && pin.key.SK === 'JOURNAL')
    || !has(JOB_TARGET.partitions, `ACCOUNT#${ref.subject}`, 'STATE') || !has(JOB_TARGET.decisions, `ROOM#${ref.decisionId}`, 'STATE')
    || !has(JOB_TARGET.journal, 'OPERATIONS#RETENTION', 'STATE')
    || !has(JOB_TARGET.journal, `RETENTION#${ref.subject}`, 'STAMP') || !has(JOB_TARGET.partitions, `DECISION#${ref.decisionId}`, 'GROUP')
    || !has(JOB_TARGET.budget, 'AUTH', 'STATE')) fail('STALE');
  let guard: GuardRecord;
  try { guard = decodeGuardItem(encodeGuardItem(ref.decisionId, fence.guard as GuardRecord), ref.decisionId); } catch { return fail('INVALID'); }
  for (const pin of fence.pins) {
    if (pin.table === JOB_TARGET.decisions ? pin.attribute !== null || pin.revision !== null : pin.attribute === null || pin.revision === null) fail('INVALID');
    const allowed = pin.table === JOB_TARGET.source ? pin.key.PK === 'NP#GROUPS' && pin.key.SK === 'STATE'
      : pin.table === JOB_TARGET.budget ? pin.key.PK === 'AUTH' && pin.key.SK === 'STATE'
      : pin.table === JOB_TARGET.decisions ? pin.key.PK === `ROOM#${ref.decisionId}` && pin.key.SK === 'STATE'
      : pin.table === JOB_TARGET.partitions ? /^(ACCOUNT|GROUP|MEMBER|DECISION)#[A-Za-z0-9_-]{1,80}$/.test(pin.key.PK) || pin.key.PK === 'MIGRATION#CONTROL'
      : pin.key.PK === 'OPERATIONS#RETENTION' || /^(PARTITION|CONSENT|RETENTION)#[A-Za-z0-9_-]{1,128}$/.test(pin.key.PK);
    if (!allowed || Buffer.byteLength(pin.payload) > 352 * 1024) fail('INVALID');
    try { const value = JSON.parse(pin.payload); if (JSON.stringify(value) !== pin.payload || (pin.attribute === 'revision' && value.revision !== pin.revision)) fail('INVALID'); } catch { fail('INVALID'); }
  }
  try { const state = fence.pins.find(pin => pin.table === JOB_TARGET.decisions)!; const value = JSON.parse(state.payload);
    const record = decodeDecisionStateItem({ ...attributes(state.key), schemaVersion: { N: String(value.schemaVersion) }, payload: { S: state.payload } }, ref.decisionId);
    validateDecisionStateGuard(record, guard);
    for (const member of record.memberships.filter(member => member.active)) {
      const account = fence.pins.find(pin => pin.table === JOB_TARGET.partitions && pin.key.PK === `ACCOUNT#${member.subject}` && pin.key.SK === 'STATE');
      if (!account) return fail('STALE'); const row = checkPartitionRow(JSON.parse(account.payload), account.key);
      if (row.kind !== 'ACCOUNT' || row.value.status !== 'APPROVED' || !has(JOB_TARGET.journal, `RETENTION#${member.subject}`, 'STAMP')) return fail('STALE');
    }
    const headers = fence.pins.filter(pin => pin.table === JOB_TARGET.partitions && pin.key.PK.startsWith('GROUP#') && pin.key.SK === 'STATE');
    if (!headers.some(pin => { const row = checkPartitionRow(JSON.parse(pin.payload), pin.key);
      const directoryPin = fence.pins.find(entry => entry.table === JOB_TARGET.partitions && entry.key.PK === `DECISION#${ref.decisionId}` && entry.key.SK === 'GROUP')!;
      const directory = checkPartitionRow(JSON.parse(directoryPin.payload), directoryPin.key);
      const bindingPin = fence.pins.find(entry => entry.table === JOB_TARGET.partitions && entry.key.PK === pin.key.PK && entry.key.SK === `BINDING#${ref.decisionId}`);
      const binding = bindingPin ? checkPartitionRow(JSON.parse(bindingPin.payload), bindingPin.key) : null;
      return directory.kind === 'DIRECTORY' && directory.value.type === 'DECISION' && directory.value.groupId === pin.key.PK.slice(6)
        && binding?.kind === 'BINDING' && row.kind === 'GROUP' && binding.value.version === row.value.version && row.kind === 'GROUP' && row.value.decisionIds.includes(ref.decisionId) && row.value.members.includes(ref.subject)
        && record.memberships.filter(member => member.active).every(member => row.value.members.includes(member.subject))
        && has(JOB_TARGET.partitions, pin.key.PK, `BINDING#${ref.decisionId}`); })) return fail('STALE');
    const marker = JSON.parse(fence.pins.find(pin => pin.table === JOB_TARGET.source)!.payload);
    const control = MigrationControlSchema.parse(JSON.parse(fence.pins.find(pin => pin.table === JOB_TARGET.partitions && pin.key.PK === 'MIGRATION#CONTROL')!.payload));
    const journal = MigrationJournalSchema.parse(JSON.parse(fence.pins.find(pin => pin.table === JOB_TARGET.journal && pin.key.PK.startsWith('PARTITION#'))!.payload));
    if (marker.kind !== 'PARTITION_MIGRATION' || marker.phase !== 'ACTIVE' || marker.account !== JOB_TARGET.account || marker.region !== JOB_TARGET.region
      || marker.table !== 'KnownEnoughPartitions' || !control.active || control.revision < 3 || journal.state !== 'COPIED'
      || fence.pins.find(pin => pin.table === JOB_TARGET.source)!.revision !== journal.sourceRevision + 2 || journal.revision !== journal.nextBatch + 1
      || journal.completedRows !== journal.rowCount || journal.planHash !== control.planHash || marker.planHash !== journal.planHash
      || marker.manifestHash !== journal.manifestHash || marker.manifestVersion !== journal.manifestVersion || marker.sourceSha !== journal.sourceSha
      || marker.sourceRevision !== journal.sourceRevision || marker.sourceHash !== journal.sourceHash) return fail('STALE');
    if (!record.job || record.job.id !== ref.reasoningJobId || record.status !== 'REASONING' || record.job.epoch !== record.solveEpoch
      || record.job.contextToken !== record.definition.contextToken || record.job.semanticVersion !== record.definition.semanticVersion) return fail('STALE');
  } catch { return fail('STALE'); }
  const auth = standingSchema.safeParse(JSON.parse(fence.pins.find(pin => pin.table === JOB_TARGET.budget)!.payload));
  if (!auth.success || auth.data.maxCostMicrosPerRun < auth.data.attemptCostMicros) fail('DISABLED'); // no fabricated legacy allowance/expiry or total reset
  return structuredClone({ ...fence, guard });
}
const wire = z.strictObject({ PK: z.strictObject({ S: z.string() }), SK: z.strictObject({ S: z.string() }),
  payload: z.strictObject({ S: z.string() }), revision: z.strictObject({ N: z.string().regex(/^[1-9][0-9]*$/).refine(value => Number.isSafeInteger(Number(value)) && Number(value) < Number.MAX_SAFE_INTEGER) }) });
function decode<T>(raw: unknown, key: { PK: string; SK: string }, schema: z.ZodType<T>, budget = false): T {
  const result = (budget ? wire.omit({ revision: true }).extend({ version: wire.shape.revision }) : wire).safeParse(raw);
  if (!result.success || result.data.PK.S !== key.PK || result.data.SK.S !== key.SK || Buffer.byteLength(result.data.payload.S) > 32_768) return fail('INVALID');
  try { const parsed = schema.parse(JSON.parse(result.data.payload.S)); if (JSON.stringify(parsed) !== result.data.payload.S) return fail('INVALID'); return parsed; }
  catch { return fail('INVALID'); }
}
/** No seed/reset path. Exact initialized control, existing TOTAL and verified target are mandatory. */
export function createDynamoModelJobStore(options: { verifiedTarget: { account: string; region: string }; sourceSha: string }): DurableJobStore<JobFence, JobEffect> {
  if (!z.strictObject({ account: z.literal(JOB_TARGET.account), region: z.literal(JOB_TARGET.region) }).safeParse(options.verifiedTarget).success || !/^[a-f0-9]{40}$/.test(options.sourceSha)) return fail('INVALID');
  const sourceSha = options.sourceSha;
  const client = new DynamoDBClient({ region: JOB_TARGET.region, maxAttempts: 1, endpoint: 'https://dynamodb.us-east-1.amazonaws.com' });
  const snapshots = new WeakMap<JobSnapshot, { jobId: string; totalRevision: number; bytes: string }>();
  let requests = 0;
  // Per store/owned delivery execution bound; construct a fresh store for each ≤64-ID reconciliation batch.
  const send = async (command: TransactGetItemsCommand | TransactWriteItemsCommand) => {
    if (++requests > 64) return fail('CAPACITY');
    try { const io = { abortSignal: AbortSignal.timeout(20_000) }; return command instanceof TransactGetItemsCommand ? await client.send(command, io) : await client.send(command, io); }
    catch (error) {
      if (error && typeof error === 'object' && 'name' in error && error.name === 'TransactionCanceledException') {
        const reasons = (error as { CancellationReasons?: { Code?: string }[] }).CancellationReasons;
        if (Array.isArray(reasons) && reasons.every(reason => ['None', 'ConditionalCheckFailed', 'TransactionConflict'].includes(reason.Code ?? ''))
          && reasons.some(reason => ['ConditionalCheckFailed', 'TransactionConflict'].includes(reason.Code ?? ''))) fail('CONFLICT');
      }
      return fail('RETRYABLE');
    }
  };
  function put(table: string, key: { PK: string; SK: string }, payload: unknown, revision: number, prior: JobPin | null): TransactWriteItem {
    return { Put: { TableName: table, Item: { ...attributes(key), payload: { S: JSON.stringify(payload) },
      [prior?.attribute ?? 'revision']: { N: String(revision) } },
      ...(prior ? condition(prior) : { ConditionExpression: 'attribute_not_exists(PK)' }) } };
  }
  function pin(table: JobPin['table'], key: JobPin['key'], value: unknown, revision: number, attribute: JobPin['attribute'] = 'revision'): JobPin {
    return { table, key, attribute, revision, payload: JSON.stringify(value) };
  }
  return {
    async read(jobId) {
      const result = await send(new TransactGetItemsCommand({ TransactItems: [
        { Get: { TableName: JOB_TARGET.journal, Key: attributes(jobKey(jobId)) } },
        { Get: { TableName: JOB_TARGET.journal, Key: attributes(controlKey) } },
        { Get: { TableName: JOB_TARGET.budget, Key: attributes(totalKey) } },
      ] }));
      if (!('Responses' in result) || result.Responses?.length !== 3) return fail('INVALID');
      const control = decode(result.Responses[1]?.Item, controlKey, ControlSchema);
      const totalRaw = result.Responses[2]?.Item; const totals = decode(totalRaw, totalKey, TotalsSchema, true);
      const totalVersion = wire.omit({ revision: true }).extend({ version: wire.shape.revision }).parse(totalRaw).version.N;
      if (wire.parse(result.Responses[1]?.Item).revision.N !== String(control.revision)) return fail('INVALID');
      const job = result.Responses[0]?.Item ? decode(result.Responses[0].Item, jobKey(jobId), JobSchema) : null;
      if (job && wire.parse(result.Responses[0]?.Item).revision.N !== String(job.revision)) return fail('INVALID');
      if (control.sourceSha !== sourceSha || (job && job.reference.jobId !== jobId)) return fail('STALE');
      const snapshot = { job, control, totals }; snapshots.set(snapshot, { jobId, totalRevision: Number(totalVersion), bytes: JSON.stringify(snapshot) }); return snapshot;
    },
    async commit(prior, next, rawFence, rawEffect) {
      const observed = snapshots.get(prior); if (!observed || observed.bytes !== JSON.stringify(prior)) return fail('INVALID');
      const checkedControl = ControlSchema.parse(next.control), checkedJob = JobSchema.parse(next.job), checkedTotal = TotalsSchema.parse(next.totals);
      if (checkedControl.enabled !== prior.control.enabled || (prior.job && !equal(checkedJob.reference, prior.job.reference))
        || checkedTotal.reservedTokens - prior.totals.reservedTokens !== checkedJob.reservedTokens - (prior.job?.reservedTokens ?? 0)
        || checkedTotal.reservedCostMicros - prior.totals.reservedCostMicros !== checkedJob.reservedCostMicros - (prior.job?.reservedCostMicros ?? 0)
        || checkedControl.sourceSha !== sourceSha || checkedJob.reference.jobId !== observed.jobId
        || checkedJob.revision !== (prior.job?.revision ?? 0) + 1 || checkedControl.revision !== prior.control.revision + 1
        || checkedTotal.runs !== prior.totals.runs || checkedTotal.messages !== prior.totals.messages
        || checkedTotal.reservedTokens < prior.totals.reservedTokens || checkedTotal.reservedCostMicros < prior.totals.reservedCostMicros) return fail('INVALID');
      if (observed.totalRevision >= Number.MAX_SAFE_INTEGER - 1) return fail('BUDGET');
      const items = [put(JOB_TARGET.journal, jobKey(observed.jobId), checkedJob, checkedJob.revision,
        prior.job ? pin(JOB_TARGET.journal, jobKey(observed.jobId), prior.job, prior.job.revision) : null),
      put(JOB_TARGET.journal, controlKey, checkedControl, checkedControl.revision, pin(JOB_TARGET.journal, controlKey, prior.control, prior.control.revision)),
      put(JOB_TARGET.budget, totalKey, checkedTotal, observed.totalRevision + 1, pin(JOB_TARGET.budget, totalKey, prior.totals, observed.totalRevision, 'version'))];
      if (rawFence) {
        const fence = checkedJobFence(rawFence);
        const auth = standingSchema.parse(JSON.parse(fence.pins.find(pin => pin.table === JOB_TARGET.budget)!.payload));
        if (checkedJob.attempts > auth.maxAttemptsPerRun || checkedJob.reservedTokens > auth.maxTokensPerRun || checkedJob.reservedCostMicros > auth.maxCostMicrosPerRun
          || (checkedJob.attempts > (prior.job?.attempts ?? 0) && checkedJob.reservedCostMicros - (prior.job?.reservedCostMicros ?? 0) < auth.attemptCostMicros)) return fail('BUDGET');
        if (!equal(fence.reference, checkedJob.reference)) return fail('STALE');
        const guardItem = encodeGuardItem(checkedJob.reference.decisionId, fence.guard);
        const guardCondition = { TableName: JOB_TARGET.decisions, Key: attributes({ PK: `ROOM#${checkedJob.reference.decisionId}`, SK: 'GUARD' }),
          ConditionExpression: '#v = :v AND #i = :i', ExpressionAttributeNames: { '#v': 'version', '#i': 'incarnation' },
          ExpressionAttributeValues: { ':v': guardItem.version!, ':i': guardItem.incarnation! } };
        let nextGuard = fence.guard;
        const writes = z.strictObject({ writes: z.array(z.strictObject({ key: keySchema, payload: z.string().max(352 * 1024).nullable() })).max(1) }).parse(rawEffect ?? { writes: [] }).writes;
        if ((rawEffect || checkedJob.phase === 'SUCCEEDED') && writes.length !== 1) return fail('INVALID');
        for (const entry of fence.pins) {
          const effect = writes.find(write => entry.table === JOB_TARGET.decisions && equal(write.key, entry.key));
          if (effect) {
            if (effect.payload === null || entry.key.PK !== `ROOM#${id.parse(checkedJob.reference.decisionId)}`) return fail('INVALID');
            let output; try { const value = JSON.parse(effect.payload); output = decodeDecisionStateItem({ ...attributes(entry.key), schemaVersion: { N: String(value.schemaVersion) }, payload: { S: effect.payload } }, checkedJob.reference.decisionId); } catch { return fail('INVALID'); }
            const count = decisionPermissionHistoryCount(output);
            nextGuard = { ...fence.guard, version: fence.guard.version + 1, permissionHistoryReceipts: count,
              totalReceipts: fence.guard.totalReceipts + Math.max(0, count - fence.guard.permissionHistoryReceipts) };
            try { validateDecisionStateGuard(output, nextGuard); decodeGuardItem(encodeGuardItem(checkedJob.reference.decisionId, nextGuard), checkedJob.reference.decisionId); } catch { return fail('INVALID'); }
            items.push({ Put: { Item: encodeDecisionStateItem({ ...output, replays: [] }), ...condition(entry) } });
          } else items.push({ ConditionCheck: condition(entry) });
        }
        if (writes.length) items.push({ Put: { Item: encodeGuardItem(checkedJob.reference.decisionId, nextGuard), ...guardCondition } });
        else items.push({ ConditionCheck: guardCondition });
        if (writes.some(write => !fence.pins.some(entry => entry.table === JOB_TARGET.decisions && equal(entry.key, write.key)))) return fail('INVALID');
      } else if (rawEffect || (checkedJob.phase === 'CALLING' && prior.job?.phase !== 'CALLING') || checkedJob.phase === 'SUCCEEDED') return fail('STALE');
      if (items.length > 100 || Buffer.byteLength(JSON.stringify(items)) > 3_500_000) return fail('CAPACITY');
      try { await send(new TransactWriteItemsCommand({ TransactItems: items })); return true; }
      catch (error) { if (error instanceof DurableJobError && error.code === 'CONFLICT') return false; throw error; }
    },
    async deliveries() {
      const result = await send(new TransactGetItemsCommand({ TransactItems: [{ Get: { TableName: JOB_TARGET.journal, Key: attributes(controlKey) } }] }));
      if (!('Responses' in result) || result.Responses?.length !== 1) return fail('INVALID');
      const value = decode(result.Responses[0]?.Item, controlKey, ControlSchema); if (value.sourceSha !== sourceSha) return fail('STALE');
      return value.active.map(jobId => ({ jobId }));
    },
  };
}

/** Native bounded discovery and atomic snapshot reload. Principal is reconstructed only for an already
 * persisted server-issued job; the enqueue composition separately requires a verified server principal. */
export function createDynamoModelJobLoader(options: { verifiedTarget: { account: string; region: string }; sourceSha: string }) {
  if (!z.strictObject({ account: z.literal(JOB_TARGET.account), region: z.literal(JOB_TARGET.region) }).safeParse(options.verifiedTarget).success || !/^[a-f0-9]{40}$/.test(options.sourceSha)) return fail('INVALID');
  const sourceSha = options.sourceSha;
  const client = new DynamoDBClient({ region: JOB_TARGET.region, maxAttempts: 1, endpoint: 'https://dynamodb.us-east-1.amazonaws.com' });
  let requests = 0;
  type Ref = { table: JobPin['table']; key: JobPin['key']; attribute: JobPin['attribute'] };
  async function read(refs: Ref[]) {
    if (++requests > 64 || refs.length > 64 || new Set(refs.map(pinIdentity)).size !== refs.length) return fail('CAPACITY');
    let result; try { result = await client.send(new TransactGetItemsCommand({ TransactItems: refs.map(ref => ({ Get: { TableName: ref.table, Key: attributes(ref.key) } })) }), { abortSignal: AbortSignal.timeout(20_000) }); }
    catch { return fail('RETRYABLE'); }
    if (result.Responses?.length !== refs.length) return fail('INVALID');
    return refs.map((ref, index) => {
      const item = result.Responses![index]!.Item; if (!item || item.PK?.S !== ref.key.PK || item.SK?.S !== ref.key.SK) return fail('STALE');
      if (ref.key.SK === 'GUARD') return { ref, item, pin: null };
      const payload = item.payload?.S; if (!payload || Buffer.byteLength(payload) > 352 * 1024) return fail('INVALID');
      const revision = ref.attribute ? Number(item[ref.attribute]?.N) : null;
      const parsed = pinSchema.safeParse({ ...ref, payload, revision }); if (!parsed.success) return fail('INVALID');
      return { ref, item, pin: parsed.data };
    });
  }
  return async (raw: JobReference) => {
    const reference = JobSchema.shape.reference.parse(raw); if (reference.sourceSha !== sourceSha) return fail('STALE');
    const directoryRef: Ref = { table: JOB_TARGET.partitions, key: { PK: `DECISION#${reference.decisionId}`, SK: 'GROUP' }, attribute: 'revision' };
    const controlRef: Ref = { table: JOB_TARGET.partitions, key: { PK: 'MIGRATION#CONTROL', SK: 'STATE' }, attribute: 'revision' };
    const first = await read([directoryRef, controlRef]);
    const directory = checkPartitionRow(JSON.parse(first[0]!.pin!.payload), directoryRef.key);
    const activation = MigrationControlSchema.parse(JSON.parse(first[1]!.pin!.payload));
    if (directory.kind !== 'DIRECTORY' || directory.value.type !== 'DECISION' || directory.value.decisionId !== reference.decisionId || !activation.active || !activation.planHash) return fail('STALE');
    const groupRef: Ref = { table: JOB_TARGET.partitions, key: { PK: `GROUP#${directory.value.groupId}`, SK: 'STATE' }, attribute: 'revision' };
    const second = await read([groupRef]); const group = checkPartitionRow(JSON.parse(second[0]!.pin!.payload), groupRef.key);
    if (group.kind !== 'GROUP' || !group.value.members.includes(reference.subject) || !group.value.decisionIds.includes(reference.decisionId) || group.value.members.length > 16) return fail('STALE');
    const refs: Ref[] = [directoryRef, controlRef, groupRef,
      { table: JOB_TARGET.partitions, key: { PK: groupRef.key.PK, SK: `BINDING#${reference.decisionId}` }, attribute: 'revision' },
      { table: JOB_TARGET.source, key: { PK: 'NP#GROUPS', SK: 'STATE' }, attribute: 'version' },
      { table: JOB_TARGET.journal, key: { PK: `PARTITION#${activation.planHash}`, SK: 'JOURNAL' }, attribute: 'revision' },
      { table: JOB_TARGET.journal, key: { PK: 'OPERATIONS#RETENTION', SK: 'STATE' }, attribute: 'revision' },
      { table: JOB_TARGET.budget, key: { PK: 'AUTH', SK: 'STATE' }, attribute: 'version' },
      { table: JOB_TARGET.decisions, key: { PK: `ROOM#${reference.decisionId}`, SK: 'STATE' }, attribute: null },
      { table: JOB_TARGET.decisions, key: { PK: `ROOM#${reference.decisionId}`, SK: 'GUARD' }, attribute: null },
      ...group.value.members.flatMap(subject => [
        { table: JOB_TARGET.partitions, key: { PK: `ACCOUNT#${subject}`, SK: 'STATE' }, attribute: 'revision' } as Ref,
        { table: JOB_TARGET.journal, key: { PK: `RETENTION#${subject}`, SK: 'STAMP' }, attribute: 'revision' } as Ref,
      ]),
    ];
    const snapshot = await read(refs);
    const currentGroup = snapshot.find(entry => entry.ref.key.PK === groupRef.key.PK && entry.ref.key.SK === 'STATE')!;
    const currentDirectory = snapshot[0]!, currentControl = snapshot[1]!;
    if (currentGroup.pin!.payload !== second[0]!.pin!.payload || currentDirectory.pin!.payload !== first[0]!.pin!.payload || currentControl.pin!.payload !== first[1]!.pin!.payload) return fail('STALE');
    const guard = decodeGuardItem(snapshot.find(entry => entry.ref.key.SK === 'GUARD')!.item, reference.decisionId);
    const fence = checkedJobFence({ reference, guard, pins: snapshot.flatMap(entry => entry.pin ? [entry.pin] : []) });
    return { principal: { kind: 'participant' as const, subject: reference.subject }, fence, enabled: true };
  };
}
