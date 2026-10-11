import { z } from 'zod';
import { DynamoDBClient, GetItemCommand, QueryCommand, TransactGetItemsCommand,
  type AttributeValue, type TransactWriteItem } from '@aws-sdk/client-dynamodb';
import type { TrustedPrincipal } from '@deal-table/application';
import { partitionIO, partitionCall, checkPartitionRow, PartitionRowSchema, type PartitionIOContext, type PartitionKey } from './partitioned-group-repository.ts';
import { partitionMemberId } from './partition-group-session.ts';
import { ErasingAccount } from './partition-erasure-contract.ts';
import { ArchivedGroupRow, loadPartitionArchive, type ArchiveExpected } from './partition-archive.ts';
import { decodeDecisionStateItem, decodeGuardItem, encodeDecisionStateItem, encodeGuardItem, decisionPermissionHistoryCount } from './dynamodb-codec.ts';
import { RetentionPolicy, RetentionStamp, LifecycleConsent, LifecycleJournal, lifecycleFail as fail, lifecycleHash,
  lifecycleSubject, retentionDeadline, prepareLifecyclePlan, sealLifecyclePlan, loadLifecyclePlan, eraseDecisionOwner, ownerLifecycleExport,
  createLifecycleRunner, type LifecyclePlan, type LifecycleInventory, type LifecyclePorts } from './partition-lifecycle.ts';

// Native inactive port. Only the managed factory supplies activation, independently binding the legacy marker/control/copied journal.
export const LIFECYCLE_RESOURCES = Object.freeze({ account: '092954139775', region: 'us-east-1',
  partitions: 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughPartitions',
  decisions: 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughStage',
  journal: 'arn:aws:dynamodb:us-east-1:092954139775:table/KnownEnoughOperationsJournal' });
export interface LifecycleActivation {
  read(context: PartitionIOContext): Promise<void>;
  /** Must atomically join source/control/copied-journal conditions; coordinator has charged this physical write. */
  write(items: TransactWriteItem[], context: PartitionIOContext): Promise<void>;
}
export interface DynamoLifecycleOptions {
  verifiedTarget: { account: string; region: string }; sourceSha: string; signingKey: Buffer; activation: LifecycleActivation;
  clock?: () => number; limits?: { timeoutMs?: number; maxRequests?: number };
  archiveRecoveries?: { manifestBytes: Buffer; expected: ArchiveExpected; manifestVersion: string }[];
}
type Item = Record<string, AttributeValue>;
const attrs = (key: PartitionKey): Item => ({ PK: { S: key.PK }, SK: { S: key.SK } });
const keyOf = (item: Item): PartitionKey => {
  if (!item.PK?.S || !item.SK?.S) return fail('LIFECYCLE_INVALID');
  return { PK: item.PK.S, SK: item.SK.S };
};
const policyKey = { PK: 'OPERATIONS#RETENTION', SK: 'STATE' };
const envelope = z.strictObject({ PK: z.strictObject({ S: z.string() }), SK: z.strictObject({ S: z.string() }),
  revision: z.strictObject({ N: z.string().regex(/^[1-9][0-9]*$/) }), payload: z.strictObject({ S: z.string().max(352 * 1024) }) });
function decode<T extends { revision: number }>(raw: unknown, key: PartitionKey, schema: z.ZodType<T>): T {
  const parsed = envelope.safeParse(raw); if (!parsed.success || parsed.data.PK.S !== key.PK || parsed.data.SK.S !== key.SK) return fail('LIFECYCLE_INVALID');
  let value: T; try { value = schema.parse(JSON.parse(parsed.data.payload.S)); } catch { return fail('LIFECYCLE_INVALID'); }
  if (String(value.revision) !== parsed.data.revision.N || JSON.stringify(value) !== parsed.data.payload.S) return fail('LIFECYCLE_INVALID');
  return value;
}
function row(raw: Item, key: PartitionKey) { return checkPartitionRow(decode(raw, key, PartitionRowSchema), key); }
function item(key: PartitionKey, value: { revision: number }): Item {
  const output = { ...attrs(key), revision: { N: String(value.revision) }, payload: { S: JSON.stringify(value) } };
  if (Buffer.byteLength(JSON.stringify(output)) > 352 * 1024) return fail('LIFECYCLE_CAPACITY');
  return output;
}
/** All existing attributes participate in the CAS, including native state/guard/replay counters and results. */
function condition(raw: Item | null) {
  if (raw === null) return { ConditionExpression: 'attribute_not_exists(PK)' };
  const names: Record<string, string> = {}; const values: Item = {}; const expressions: string[] = [];
  Object.entries(raw).filter(([name]) => name !== 'PK' && name !== 'SK').sort(([a], [b]) => a.localeCompare(b)).forEach(([name, value], index) => {
    names[`#c${index}`] = name; values[`:c${index}`] = structuredClone(value); expressions.push(`#c${index} = :c${index}`);
  });
  if (!expressions.length) return fail('LIFECYCLE_INVALID');
  return { ConditionExpression: expressions.join(' AND '), ExpressionAttributeNames: names, ExpressionAttributeValues: values };
}
const check = (table: string, key: PartitionKey, raw: Item | null): TransactWriteItem => ({ ConditionCheck: { TableName: table, Key: attrs(key), ...condition(raw) } });
const put = (table: string, key: PartitionKey, raw: Item | null, value: Item): TransactWriteItem => ({ Put: { TableName: table, Item: value, ...condition(raw) } });
const remove = (table: string, key: PartitionKey, raw: Item): TransactWriteItem => ({ Delete: { TableName: table, Key: attrs(key), ...condition(raw) } });
function cancellation(error: unknown, size: number) {
  const value = error as { name?: string; CancellationReasons?: { Code?: string }[] };
  return value?.name === 'TransactionCanceledException' && Array.isArray(value.CancellationReasons) && value.CancellationReasons.length === size + 3
    && value.CancellationReasons.every(reason => ['None', 'ConditionalCheckFailed', 'TransactionConflict'].includes(reason?.Code ?? ''))
    && value.CancellationReasons.some(reason => reason.Code === 'ConditionalCheckFailed' || reason.Code === 'TransactionConflict');
}
export function createDynamoPartitionLifecycle(rawOptions: DynamoLifecycleOptions) {
  if (rawOptions.verifiedTarget?.account !== LIFECYCLE_RESOURCES.account || rawOptions.verifiedTarget?.region !== LIFECYCLE_RESOURCES.region
    || !/^[a-f0-9]{40}$/.test(rawOptions.sourceSha) || /^0+$/.test(rawOptions.sourceSha)
    || !Buffer.isBuffer(rawOptions.signingKey) || rawOptions.signingKey.length !== 32
    || typeof rawOptions.activation?.read !== 'function' || typeof rawOptions.activation?.write !== 'function') return fail('LIFECYCLE_INVALID');
  const sourceSha = rawOptions.sourceSha; const signingKey = Buffer.from(rawOptions.signingKey);
  const limits = { ...rawOptions.limits }; partitionIO(limits);
  const archiveRecoveries = (rawOptions.archiveRecoveries ?? []).map(value => ({ ...structuredClone(value),
    plan: loadPartitionArchive(Buffer.from(value.manifestBytes), value.expected) }));
  const activation = { ...rawOptions.activation }; const clock = rawOptions.clock ?? Date.now; const resources = LIFECYCLE_RESOURCES;
  const client = new DynamoDBClient({ region: resources.region, endpoint: 'https://dynamodb.us-east-1.amazonaws.com', maxAttempts: 1 });
  async function get(table: string, key: PartitionKey, io: PartitionIOContext): Promise<Item | null> {
    const result = await client.send(new GetItemCommand({ TableName: table, Key: attrs(key), ConsistentRead: true }), { abortSignal: io.signal });
    return result.Item ?? null;
  }
  async function read(table: string, key: PartitionKey, io: PartitionIOContext) { return partitionCall(io, () => get(table, key, io)); }
  async function query(table: string, PK: string, io: PartitionIOContext) {
    const result: Item[] = []; const seen = new Set<string>(); let cursor: Item | undefined;
    do {
      const response = await partitionCall(io, () => client.send(new QueryCommand({ TableName: table, ConsistentRead: true,
        KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': { S: PK } }, Limit: 80,
        ...(cursor ? { ExclusiveStartKey: cursor } : {}) }), { abortSignal: io.signal }));
      for (const value of response.Items ?? []) {
        const key = keyOf(value); if (key.PK !== PK || seen.has(key.SK)) fail('LIFECYCLE_INVALID');
        seen.add(key.SK); result.push(value); if (result.length > 4610) fail('LIFECYCLE_CAPACITY');
      }
      cursor = response.LastEvaluatedKey;
      if (cursor && (keyOf(cursor).PK !== PK || !response.Items?.length || keyOf(cursor).SK !== keyOf(response.Items.at(-1)!).SK)) fail('LIFECYCLE_INVALID');
    } while (cursor);
    return result;
  }
  async function policy(io: PartitionIOContext) { return decode(await get(resources.journal, policyKey, io), policyKey, RetentionPolicy); }
  async function inventory(subject: string | null, groupId: string | null, decisionId: string | null, io: PartitionIOContext) {
    const data: LifecycleInventory = { entries: [], decisions: [], archives: [], erasedDecisions: [] }; const refs: { table: string; key: PartitionKey; raw: Item }[] = [];
    const add = (table: string, raw: Item) => { const key = keyOf(raw); if (refs.some(ref => ref.table === table && ref.key.PK === key.PK && ref.key.SK === key.SK)) return;
      refs.push({ table, key, raw }); if (table === resources.partitions) data.entries.push({ key, row: row(raw, key) }); };
    let decisionGroup: string | null = null;
    const groupIds = new Set(groupId ? [groupId] : []); const accountSubjects = new Set(subject ? [subject] : []);
    if (subject) {
      const account = await read(resources.partitions, { PK: `ACCOUNT#${subject}`, SK: 'STATE' }, io); if (!account) fail('LIFECYCLE_AUTHORITY_DENIED'); add(resources.partitions, account);
      for (const edge of await query(resources.partitions, `MEMBER#${subject}`, io)) {
        const parsed = row(edge, keyOf(edge)); if (parsed.kind !== 'MEMBERSHIP' || parsed.value.subject !== subject) fail('LIFECYCLE_INVALID');
        groupIds.add(parsed.value.groupId); add(resources.partitions, edge);
      }
      if (groupIds.size > 32) fail('LIFECYCLE_CAPACITY');
    }
    if (decisionId) {
      const directory = await read(resources.partitions, { PK: `DECISION#${decisionId}`, SK: 'GROUP' }, io);
      if (!directory) fail('LIFECYCLE_INVALID'); const value = row(directory, keyOf(directory));
      if (value.kind !== 'DIRECTORY' || value.value.type !== 'DECISION' || value.value.decisionId !== decisionId) fail('LIFECYCLE_INVALID');
      decisionGroup = value.value.groupId; groupIds.add(value.value.groupId); add(resources.partitions, directory);
    }
    const decisionIds = new Set(decisionId ? [decisionId] : []);
    for (const selected of groupIds) {
      const before = await read(resources.partitions, { PK: `GROUP#${selected}`, SK: 'STATE' }, io);
      const rows = await query(resources.partitions, `GROUP#${selected}`, io); const header = rows.find(value => value.SK?.S === 'STATE');
      if (!header || lifecycleHash(before) !== lifecycleHash(header)) fail('LIFECYCLE_SOURCE_CHANGED');
      if (selected === decisionGroup && !rows.some(value => value.SK?.S === `BINDING#${decisionId}`)) fail('LIFECYCLE_INVALID');
      const archived = ArchivedGroupRow.safeParse(JSON.parse(header.payload?.S ?? '{}'));
      if (archived.success) {
        const marker = decode(header, keyOf(header), ArchivedGroupRow); if (marker.groupId !== selected) fail('LIFECYCLE_INVALID');
        refs.push({ table: resources.partitions, key: keyOf(header), raw: header });
        const recovery = archiveRecoveries.find(value => value.expected.groupId === selected);
        if (recovery && (recovery.expected.sourceSha !== marker.sourceSha || recovery.expected.sourceHash !== marker.sourceHash
          || recovery.expected.manifestHash !== marker.manifestHash || recovery.manifestVersion !== marker.manifestVersion)) fail('LIFECYCLE_SOURCE_CHANGED');
        data.archives!.push({ key: keyOf(header), row: marker, ...(recovery ? { originalHeader: recovery.plan.header } : {}) });
        recovery?.plan.header.value.members.forEach(value => accountSubjects.add(value));
        rows.filter(value => value !== header).forEach(value => { add(resources.partitions, value); const child = row(value, keyOf(value));
          if (child.kind === 'BINDING' && !decisionId) decisionIds.add(child.value.id); });
      } else {
        const parsed = row(header, keyOf(header)); if (parsed.kind !== 'GROUP') fail('LIFECYCLE_INVALID');
        if (rows.length !== 1 + parsed.value.draftIds.length + parsed.value.decisionIds.length
          || parsed.value.draftIds.some(id => !rows.some(value => value.SK?.S === `DRAFT#${id}`))
          || parsed.value.decisionIds.some(id => !rows.some(value => value.SK?.S === `BINDING#${id}`))) fail('LIFECYCLE_INVALID');
        rows.forEach(value => add(resources.partitions, value)); parsed.value.members.forEach(value => accountSubjects.add(value));
        if (!decisionId) parsed.value.decisionIds.forEach(value => decisionIds.add(value));
      }
    }
    if (decisionIds.size > 128) fail('LIFECYCLE_CAPACITY');
    for (const selected of decisionIds) {
      const rows = await query(resources.decisions, `ROOM#${selected}`, io); const state = rows.find(value => value.SK?.S === 'STATE'); const guard = rows.find(value => value.SK?.S === 'GUARD');
      if (!guard || rows.some(value => !['STATE', 'GUARD'].includes(value.SK!.S!) && !/^REPLAY#[a-f0-9]{64}$/.test(value.SK!.S!))) fail('LIFECYCLE_INVALID');
      if (!state) {
        const deleted = decodeGuardItem(guard, selected);
        if (!/^erase-[a-f0-9]{40}$/.test(deleted.incarnation) || deleted.totalReceipts !== 0 || rows.length !== 1) fail('LIFECYCLE_INVALID');
        data.erasedDecisions!.push(selected); add(resources.decisions, guard); continue;
      }
      const record = decodeDecisionStateItem(state, selected); const decodedGuard = decodeGuardItem(guard, selected);
      data.decisions.push({ record, guard: decodedGuard, replayKeys: rows.filter(value => value.SK!.S!.startsWith('REPLAY#')).map(value => ({ key: keyOf(value), hash: lifecycleHash(value) })) });
      record.memberships.filter(value => value.active).forEach(value => accountSubjects.add(value.subject));
      add(resources.decisions, state); add(resources.decisions, guard);
    }
    // Query is not a multi-item snapshot. Reload state/guard pairs atomically and reject a replay/version race.
    const active = data.decisions;
    for (let start = 0; start < active.length; start += 48) {
      const batch = active.slice(start, start + 48);
      const response = await partitionCall(io, () => client.send(new TransactGetItemsCommand({ TransactItems: batch.flatMap(value => ['STATE', 'GUARD'].map(SK => ({ Get: {
        TableName: resources.decisions, Key: attrs({ PK: `ROOM#${value.record.decisionId}`, SK }),
      } }))) }), { abortSignal: io.signal }));
      if (response.Responses?.length !== batch.length * 2) fail('LIFECYCLE_INVALID');
      for (const [index, value] of batch.entries()) {
        const state = response.Responses![index * 2]?.Item; const guard = response.Responses![index * 2 + 1]?.Item;
        const old = refs.find(ref => ref.table === resources.decisions && ref.key.PK === `ROOM#${value.record.decisionId}` && ref.key.SK === 'GUARD');
        if (!state || !guard || !old || lifecycleHash(old.raw) !== lifecycleHash(guard)) fail('LIFECYCLE_SOURCE_CHANGED');
        value.record = decodeDecisionStateItem(state, value.record.decisionId); value.guard = decodeGuardItem(guard, value.record.decisionId);
        const prior = refs.find(ref => ref.table === resources.decisions && ref.key.PK === `ROOM#${value.record.decisionId}` && ref.key.SK === 'STATE')!;
        prior.raw = state;
      }
    }
    for (const selected of accountSubjects) {
      const value = await read(resources.partitions, { PK: `ACCOUNT#${selected}`, SK: 'STATE' }, io); if (!value) fail('LIFECYCLE_INVALID'); add(resources.partitions, value);
    }
    // Root revision guards make pagination/discovery phantoms visible; every membership transition advances the account.
    for (const ref of refs.filter(ref => ref.table === resources.partitions && ref.key.SK === 'STATE')) {
      if (lifecycleHash(await read(ref.table, ref.key, io)) !== lifecycleHash(ref.raw)) fail('LIFECYCLE_SOURCE_CHANGED');
    }
    return { data, refs };
  }
  async function barrier(refs: { table: string; key: PartitionKey; raw: Item }[], p: Item, io: PartitionIOContext) {
    const writes = [check(resources.journal, policyKey, p), ...refs.filter(ref => ref.table === resources.decisions ? ref.key.SK === 'GUARD'
      : ref.table === resources.partitions ? ref.key.SK === 'STATE' : true).map(ref => check(ref.table, ref.key, ref.raw))];
    await write(writes, io);
  }
  async function write(items: TransactWriteItem[], io: PartitionIOContext) {
    if (!items.length || items.length > 97 || Buffer.byteLength(JSON.stringify(items)) > 3_500_000) fail('LIFECYCLE_CAPACITY');
    const keys = items.map(value => { const action = value.ConditionCheck ?? value.Put ?? value.Delete!; const key = value.Put?.Item ?? ('Key' in action ? action.Key! : {});
      return `${action.TableName}/${key.PK?.S}/${key.SK?.S}`; });
    if (new Set(keys).size !== keys.length) fail('LIFECYCLE_INVALID');
    return partitionCall(io, () => activation.write(structuredClone(items), io));
  }
  function captured(bytes: Buffer, expected: { planHash: string; opId: string }) {
    return loadLifecyclePlan(Buffer.from(bytes), signingKey, { ...expected, sourceSha });
  }
  const journalKey = (plan: LifecyclePlan) => ({ PK: `LIFECYCLE#${plan.opId}`, SK: 'JOURNAL' });
  const consentKey = (plan: LifecyclePlan, subject: string) => ({ PK: `CONSENT#${plan.opId}`, SK: `SUBJECT#${subject}` });
  const planKey = (plan: LifecyclePlan) => ({ PK: `LIFECYCLE#${plan.opId}`, SK: 'PLAN' });
  return {
    /** Operator-only publication; stores only sealed IDs/hashes, before asking each owner for consent. */
    async publishPlan(bytes: Buffer, expected: { planHash: string; opId: string }) {
      const sealed = Buffer.from(bytes); const plan = captured(sealed, { ...expected });
      const io = partitionIO(limits); await activation.read(io);
      const policyRaw = await read(resources.journal, policyKey, io); if (!policyRaw) fail('LIFECYCLE_POLICY_DENIED');
      const p = decode(policyRaw, policyKey, RetentionPolicy);
      if (!p.enabled || p.revision !== plan.policyRevision) fail('LIFECYCLE_POLICY_DENIED');
      const key = planKey(plan); const prior = await read(resources.journal, key, io);
      if (prior) { if (prior.sealed?.S !== sealed.toString('utf8') || prior.planHash?.S !== expected.planHash) fail('LIFECYCLE_SOURCE_CHANGED'); return { opId: plan.opId, planHash: expected.planHash }; }
      const value: Item = { ...attrs(key), sealed: { S: sealed.toString('utf8') }, planHash: { S: expected.planHash } };
      let stored: Item | null;
      try { await write([check(resources.journal, policyKey, policyRaw), put(resources.journal, key, null, value)], io); }
      catch {
        // Never reissue an uncertain publication: reconcile exact persisted bytes first.
        try { stored = await read(resources.journal, key, io); } catch { return fail('LIFECYCLE_COMMIT_UNKNOWN'); }
        if (stored?.sealed?.S === value.sealed!.S && stored?.planHash?.S === expected.planHash) return { opId: plan.opId, planHash: expected.planHash };
        return fail('LIFECYCLE_COMMIT_UNKNOWN');
      }
      try { stored = await read(resources.journal, key, io); } catch { return fail('LIFECYCLE_COMMIT_UNKNOWN'); }
      if (stored?.sealed?.S !== value.sealed!.S || stored?.planHash?.S !== expected.planHash) fail('LIFECYCLE_COMMIT_UNKNOWN');
      return { opId: plan.opId, planHash: expected.planHash };
    },
    /** Only verified affected owners can load server-held source-bound bytes; never expose them publicly. */
    async loadOwnPlan(opId: string, principal: TrustedPrincipal | null) {
      const subject = lifecycleSubject(principal);
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(opId)) fail('LIFECYCLE_INVALID');
      const io = partitionIO(limits); await activation.read(io);
      const raw = await read(resources.journal, { PK: `LIFECYCLE#${opId}`, SK: 'PLAN' }, io);
      if (!raw?.sealed?.S || !raw.planHash?.S || Buffer.byteLength(raw.sealed.S) > 300000) fail('LIFECYCLE_AUTHORITY_DENIED');
      const bytes = Buffer.from(raw.sealed.S); const expected = { opId, planHash: raw.planHash.S }; const plan = captured(bytes, expected);
      if (!plan.requiredSubjects.includes(subject)) fail('LIFECYCLE_AUTHORITY_DENIED');
      return { bytes, expected };
    },
    async prepare(rawScope: LifecyclePlan['scope'], opId: string) {
      const scope = structuredClone(rawScope);
      const io = partitionIO(limits); await activation.read(io); const p = await partitionCall(io, () => policy(io));
      const snapshot = await inventory(scope.kind === 'ACCOUNT' || scope.kind === 'OWNER' ? scope.subject : null,
        scope.kind === 'GROUP' ? scope.groupId : null, scope.kind === 'DECISION' || scope.kind === 'OWNER' ? scope.decisionId : null, io);
      const plan = prepareLifecyclePlan(snapshot.data, scope, sourceSha, opId, p);
      // Capture all group/discovery guards in the account freeze transaction, preventing decision-link races.
      if (scope.kind === 'ACCOUNT') plan.steps[0]!.rows = snapshot.refs.filter(ref => ref.key.SK === 'GUARD' || ref.table === resources.partitions
        && (ref.key.PK.startsWith('GROUP#') && ref.key.SK === 'STATE' || ref.key.PK.startsWith('MEMBER#')))
        .map(ref => ({ key: ref.key, hash: lifecycleHash(ref.raw) }));
      if (scope.kind === 'GROUP') plan.steps[0]!.rows = snapshot.refs.filter(ref => ref.key.SK === 'GUARD')
        .map(ref => ({ key: ref.key, hash: lifecycleHash(ref.raw) }));
      if (plan.steps[0]!.rows.length + plan.requiredSubjects.length + 6 > 100) fail('LIFECYCLE_CAPACITY');
      const bytes = sealLifecyclePlan(plan, signingKey); if (bytes.length > 300_000) fail('LIFECYCLE_CAPACITY');
      const policyRaw = await read(resources.journal, policyKey, io); if (!policyRaw) fail('LIFECYCLE_POLICY_DENIED');
      await barrier(snapshot.refs, policyRaw, io); return { bytes, planHash: lifecycleHash(plan), opId: plan.opId };
    },
    /** ID-only logical-use gate for future distributed jobs; absent/unapproved/expired stamps deny use. */
    async assertRetained(principal: TrustedPrincipal | null) {
      const subject = lifecycleSubject(principal); const io = partitionIO(limits); await activation.read(io);
      const p = await read(resources.journal, policyKey, io); if (!p) fail('LIFECYCLE_POLICY_DENIED');
      const key = { PK: `RETENTION#${subject}`, SK: 'STAMP' }; const raw = await read(resources.journal, key, io);
      const stamp = decode(raw, key, RetentionStamp); const deadline = retentionDeadline(decode(p, policyKey, RetentionPolicy), stamp);
      const accountKey = { PK: `ACCOUNT#${subject}`, SK: 'STATE' }; const account = await read(resources.partitions, accountKey, io);
      if (!account) fail('LIFECYCLE_AUTHORITY_DENIED'); const parsed = row(account, accountKey);
      if (parsed.kind !== 'ACCOUNT' || parsed.value.status !== 'APPROVED') fail('LIFECYCLE_AUTHORITY_DENIED');
      if (clock() < Date.parse(stamp.lastActivityAt) || clock() >= deadline) fail('LIFECYCLE_EXPIRED');
      await barrier([{ table: resources.journal, key, raw: raw! }, { table: resources.partitions, key: accountKey, raw: account }], p, io);
      if (clock() >= deadline) fail('LIFECYCLE_EXPIRED'); return { subject, policyRevision: stamp.policyRevision, expiresAt: new Date(deadline).toISOString() };
    },
    async exportOwn(principal: TrustedPrincipal | null) {
      const subject = lifecycleSubject(principal); const io = partitionIO(limits); await activation.read(io);
      const p = await read(resources.journal, policyKey, io); if (!p) fail('LIFECYCLE_POLICY_DENIED');
      const stampKey = { PK: `RETENTION#${subject}`, SK: 'STAMP' };
      const stampRaw = await read(resources.journal, stampKey, io); const stamp = decode(stampRaw, stampKey, RetentionStamp);
      const snapshot = await inventory(subject, null, null, io);
      const result = ownerLifecycleExport(snapshot.data, principal, decode(p, policyKey, RetentionPolicy), stamp, clock());
      await barrier([...snapshot.refs, { table: resources.journal, key: stampKey, raw: stampRaw! }], p, io);
      if (clock() >= retentionDeadline(decode(p, policyKey, RetentionPolicy), stamp)) fail('LIFECYCLE_EXPIRED');
      return result;
    },
    async consent(bytes: Buffer, rawExpected: { planHash: string; opId: string }, principal: TrustedPrincipal | null,
      expiresAt: string, revoked = false) {
      const expected = { ...rawExpected };
      const subject = lifecycleSubject(principal); const plan = captured(bytes, expected); const io = partitionIO(limits); await activation.read(io);
      if (!plan.requiredSubjects.includes(subject)) fail('LIFECYCLE_AUTHORITY_DENIED');
      const now = clock(); const expiry = Date.parse(expiresAt);
      if (!Number.isSafeInteger(now) || !Number.isFinite(expiry) || expiry <= now || expiry - now > 86_400_000) fail('LIFECYCLE_INVALID');
      const accountKey = { PK: `ACCOUNT#${subject}`, SK: 'STATE' }; const accountRaw = await read(resources.partitions, accountKey, io);
      if (!accountRaw) fail('LIFECYCLE_AUTHORITY_DENIED');
      const erasing = ErasingAccount.safeParse(JSON.parse(accountRaw.payload?.S ?? '{}'));
      if (erasing.success) {
        const frozen = decode(accountRaw, accountKey, ErasingAccount);
        if (frozen.subject !== subject || !revoked && (frozen.opId !== plan.opId || frozen.planHash !== expected.planHash)) fail('LIFECYCLE_AUTHORITY_DENIED');
      } else {
        const account = row(accountRaw, accountKey);
        if (account.kind !== 'ACCOUNT' || account.value.subject !== subject || account.value.status !== 'APPROVED' && !revoked && !(plan.scope.kind === 'ACCOUNT' && plan.scope.subject === subject
          && account.value.status === 'DISABLED' && account.value.displayName === 'Erased account' && account.value.emailHash === '0'.repeat(64))) fail('LIFECYCLE_AUTHORITY_DENIED');
      }
      const p = await read(resources.journal, policyKey, io); if (!p) fail('LIFECYCLE_POLICY_DENIED'); const parsed = decode(p, policyKey, RetentionPolicy);
      if (!parsed.enabled || parsed.revision !== plan.policyRevision) fail('LIFECYCLE_POLICY_DENIED');
      const key = consentKey(plan, subject); const prior = await read(resources.journal, key, io);
      const revision = prior ? decode(prior, key, LifecycleConsent).revision + 1 : 1;
      const consent = LifecycleConsent.parse({ schemaVersion: 1, kind: 'ERASURE_CONSENT', revision, subject, opId: plan.opId,
        planHash: expected.planHash, sourceSha, policyRevision: parsed.revision, grantedAt: new Date(now).toISOString(), expiresAt: new Date(expiry).toISOString(), revoked });
      await write([check(resources.partitions, accountKey, accountRaw), check(resources.journal, policyKey, p), put(resources.journal, key, prior, item(key, consent))], io);
      return { opId: plan.opId, granted: !revoked, expiresAt: consent.expiresAt };
    },
    /** Owned coarse progress remains readable after grant expiry; no consent/refusal/private details are projected. */
    async status(bytes: Buffer, rawExpected: { planHash: string; opId: string }, principal: TrustedPrincipal | null) {
      const expected = { ...rawExpected };
      const subject = lifecycleSubject(principal); const plan = captured(bytes, expected);
      if (!plan.requiredSubjects.includes(subject)) fail('LIFECYCLE_AUTHORITY_DENIED');
      const io = partitionIO(limits); await activation.read(io); const key = journalKey(plan);
      const raw = await read(resources.journal, key, io); if (!raw) return { state: 'NOT_PREPARED', nextStep: 0, totalSteps: plan.steps.length };
      const j = decode(raw, key, LifecycleJournal);
      if (j.opId !== plan.opId || j.planHash !== expected.planHash || j.sourceSha !== sourceSha || j.policyRevision !== plan.policyRevision
        || j.nextStep > plan.steps.length || j.revision !== j.nextStep + 1
        || j.state !== (j.nextStep === 0 ? 'PREPARED' : j.nextStep === plan.steps.length ? 'ERASED' : 'ERASING')) fail('LIFECYCLE_INVALID');
      return { state: j.state, nextStep: j.nextStep, totalSteps: plan.steps.length };
    },
    runner(bytes: Buffer, rawExpected: { planHash: string; opId: string }) {
      const expected = { ...rawExpected };
      const sealed = Buffer.from(bytes); const plan = captured(sealed, expected);
      const ports: LifecyclePorts = {
        policy: async io => { await activation.read(io); return policy(io); },
        consent: async (subject, io) => { const key = consentKey(plan, subject); const value = await get(resources.journal, key, io); return value ? decode(value, key, LifecycleConsent) : null; },
        journal: async io => { const key = journalKey(plan); const value = await get(resources.journal, key, io); return value ? decode(value, key, LifecycleJournal) : null; },
        recovery: async io => {
          const key = planKey(plan); const raw = await get(resources.journal, key, io);
          if (raw) return raw.sealed?.S === sealed.toString('utf8') && raw.planHash?.S === expected.planHash;
          const value: Item = { ...attrs(key), sealed: { S: sealed.toString('utf8') }, planHash: { S: expected.planHash } };
          await write([put(resources.journal, key, null, value)], io);
          const stored = await read(resources.journal, key, io); return stored?.sealed?.S === value.sealed!.S && stored?.planHash?.S === expected.planHash;
        },
        commit: async (submitted, prior, next, grants, io) => {
          if (lifecycleHash(submitted) !== expected.planHash) fail('LIFECYCLE_INVALID');
          const p = await read(resources.journal, policyKey, io); if (!p) fail('LIFECYCLE_POLICY_DENIED');
          const policyValue = decode(p, policyKey, RetentionPolicy); if (!policyValue.enabled || policyValue.revision !== plan.policyRevision) fail('LIFECYCLE_POLICY_DENIED');
          const writes: TransactWriteItem[] = [check(resources.journal, policyKey, p)];
          for (const grant of grants) {
            if (grant.revoked || Date.parse(grant.expiresAt) <= clock()) fail('LIFECYCLE_AUTHORITY_DENIED');
            const key = consentKey(plan, grant.subject);
            // Exact canonical grant CAS detects revocation/change without a redundant read.
            writes.push(check(resources.journal, key, item(key, grant)));
          }
          const key = journalKey(plan); const oldJournal = prior ? item(key, prior) : null;
          const step = prior ? plan.steps[prior.nextStep] : null;
          const rootKey = plan.scope.kind === 'ACCOUNT' ? { PK: `ACCOUNT#${plan.scope.subject}`, SK: 'STATE' }
            : plan.scope.kind === 'GROUP' ? { PK: `GROUP#${plan.scope.groupId}`, SK: 'STATE' } : null;
          if (rootKey && prior && prior.nextStep > 0 && step?.kind !== 'ACCOUNT_FINAL') {
            const root = await read(resources.partitions, rootKey, io); if (!root) fail('LIFECYCLE_SOURCE_CHANGED');
            if (plan.scope.kind === 'ACCOUNT') {
              const frozen = decode(root, rootKey, ErasingAccount); if (frozen.opId !== plan.opId || frozen.planHash !== expected.planHash) fail('LIFECYCLE_SOURCE_CHANGED');
            } else {
              const frozen = decode(root, rootKey, ArchivedGroupRow); if (frozen.manifestHash !== expected.planHash || frozen.manifestVersion !== `ERASURE-${plan.opId}`) fail('LIFECYCLE_SOURCE_CHANGED');
            }
            writes.push(check(resources.partitions, rootKey, root));
          }
          if (step?.kind === 'ACCOUNT_FENCE' || step?.kind === 'GROUP_FENCE') {
            const selected = { PK: `${step.kind === 'ACCOUNT_FENCE' ? 'ACCOUNT' : 'GROUP'}#${step.target}`, SK: 'STATE' };
            const source = await read(resources.partitions, selected, io); if (!source) fail('LIFECYCLE_SOURCE_CHANGED'); const archived = ArchivedGroupRow.safeParse(JSON.parse(source.payload?.S ?? '{}'));
            const current = archived.success ? decode(source, selected, ArchivedGroupRow) : row(source, selected);
            if (lifecycleHash(current) !== step.sourceHash) fail('LIFECYCLE_SOURCE_CHANGED');
            let target: { revision: number; [key: string]: unknown };
            if (step.kind === 'ACCOUNT_FENCE' && current.kind === 'ACCOUNT') target = ErasingAccount.parse({ schemaVersion: 1, kind: 'ERASING_ACCOUNT', revision: current.revision + 1,
              subject: current.value.subject, accountVersion: current.value.version + 1, opId: plan.opId, planHash: expected.planHash });
            else if (step.kind === 'GROUP_FENCE' && (current.kind === 'GROUP' || current.kind === 'ARCHIVED_GROUP')) target = ArchivedGroupRow.parse({ schemaVersion: 1, kind: 'ARCHIVED_GROUP',
              revision: current.revision + 1, groupId: step.target, organizer: current.kind === 'GROUP' ? current.value.organizer : current.organizer,
              groupVersion: (current.kind === 'GROUP' ? current.value.version : current.groupVersion) + 1,
              sourceSha, sourceHash: step.sourceHash, manifestHash: expected.planHash, manifestVersion: `ERASURE-${plan.opId}`, archivedAt: next.updatedAt });
            else return fail('LIFECYCLE_INVALID');
            if (step.rows.length) {
              const response = await partitionCall(io, () => client.send(new TransactGetItemsCommand({ TransactItems: step.rows.map(ref => ({ Get: {
                TableName: ref.key.PK.startsWith('ROOM#') ? resources.decisions : resources.partitions, Key: attrs(ref.key),
              } })) }), { abortSignal: io.signal }));
              if (response.Responses?.length !== step.rows.length) fail('LIFECYCLE_INVALID');
              for (const [index, ref] of step.rows.entries()) {
                const value = response.Responses![index]?.Item;
                if (!value || lifecycleHash(value) !== ref.hash) fail('LIFECYCLE_SOURCE_CHANGED');
                writes.push(check(ref.key.PK.startsWith('ROOM#') ? resources.decisions : resources.partitions, ref.key, value));
              }
            }
            writes.push(put(resources.partitions, selected, source, item(selected, target)));
          } else if (step?.kind === 'ACCOUNT_FINAL') {
            const key = { PK: `ACCOUNT#${step.target}`, SK: 'STATE' }; const raw = await read(resources.partitions, key, io);
            const frozen = decode(raw, key, ErasingAccount);
            if (frozen.opId !== plan.opId || frozen.planHash !== expected.planHash || frozen.subject !== step.target) fail('LIFECYCLE_SOURCE_CHANGED');
            const disabled = PartitionRowSchema.parse({ schemaVersion: 1, kind: 'ACCOUNT', revision: frozen.revision + 1, value: { subject: step.target,
              version: frozen.accountVersion, displayName: 'Erased account', status: 'DISABLED', emailHash: '0'.repeat(64) } });
            writes.push(put(resources.partitions, key, raw, item(key, disabled)));
          } else if (step?.kind === 'OWNER_STATE' || step?.kind === 'DECISION_STATE') {
            const stateKey = { PK: `ROOM#${step.target}`, SK: 'STATE' }; const guardKey = { PK: `ROOM#${step.target}`, SK: 'GUARD' };
            const state = await read(resources.decisions, stateKey, io); const guardRaw = await read(resources.decisions, guardKey, io);
            if (!state || !guardRaw || lifecycleHash(guardRaw) !== step.guardHash) fail('LIFECYCLE_SOURCE_CHANGED'); const record = decodeDecisionStateItem(state, step.target); const guard = decodeGuardItem(guardRaw, step.target);
            if (step.kind === 'OWNER_STATE') {
              if (!step.subject || !record.memberships.some(member => member.subject === step.subject && member.participantId === partitionMemberId(step.subject!))
                && !record.retiredPermissions.some(owner => owner.participantId === partitionMemberId(step.subject!))) fail('LIFECYCLE_AUTHORITY_DENIED');
            } else if (record.owners.some(owner => (owner.draft || owner.confirmedConstraints.length || owner.negotiationPermissions.length || owner.disclosurePermissions.length || owner.refusedRequests.length)
              && !plan.requiredSubjects.some(subject => partitionMemberId(subject) === owner.participantId))
              || record.memberships.some(member => member.active && !plan.requiredSubjects.includes(member.subject))
              || record.retiredPermissions.some(owner => !plan.requiredSubjects.some(subject => partitionMemberId(subject) === owner.participantId))) fail('LIFECYCLE_AUTHORITY_DENIED');
            const replacement = step.kind === 'OWNER_STATE' ? eraseDecisionOwner(record, step.subject!) : null;
            const permissionCount = replacement ? decisionPermissionHistoryCount(replacement) : 0;
            const nextGuard = { version: guard.version + 1, incarnation: `erase-${expected.planHash.slice(0, 40)}`, ordinaryReceipts: 0,
              safetyReserveReceipts: 0, permissionHistoryReceipts: permissionCount, totalReceipts: permissionCount };
            const guardItem = encodeGuardItem(step.target, nextGuard);
            writes.push(put(resources.decisions, guardKey, guardRaw, guardItem));
            writes.push(replacement ? put(resources.decisions, stateKey, state, encodeDecisionStateItem(replacement)) : remove(resources.decisions, stateKey, state));
          } else if (step?.kind === 'REPLAYS' || step?.kind === 'PARTITION_ROWS' || step?.kind === 'ACCOUNT_DRAFTS') {
            const table = step.kind === 'REPLAYS' ? resources.decisions : resources.partitions;
            for (const ref of step.rows) {
              const value = await read(table, ref.key, io); if (!value) continue;
              if (lifecycleHash(step.kind !== 'REPLAYS' ? row(value, ref.key) : value) !== ref.hash) {
                if (step.kind === 'REPLAYS' && value.incarnation?.S === `erase-${expected.planHash.slice(0, 40)}`) continue;
                fail('LIFECYCLE_SOURCE_CHANGED');
              }
              if (step.kind === 'ACCOUNT_DRAFTS') {
                const draft = row(value, ref.key); if (draft.kind !== 'DRAFT' || !step.subject) fail('LIFECYCLE_INVALID');
                draft.value.frame.participants.forEach(participant => { if (participant.id === partitionMemberId(step.subject!)) participant.displayName = 'Erased participant'; });
                draft.revision++; draft.value.revision++;
                writes.push(put(table, ref.key, value, item(ref.key, PartitionRowSchema.parse(draft))));
              } else writes.push(remove(table, ref.key, value));
            }
          }
          writes.push(put(resources.journal, key, oldJournal, item(key, next)));
          try {
            // Coordinator charged the write; additional source reads above charge separately.
            if (writes.length > 97 || Buffer.byteLength(JSON.stringify(writes)) > 3_500_000) fail('LIFECYCLE_CAPACITY');
            await activation.write(writes, io); return true;
          } catch (error) { if (cancellation(error, writes.length)) return false; throw error; }
        },
      };
      return createLifecycleRunner(ports, plan, { ...limits, clock });
    },
  };
}
