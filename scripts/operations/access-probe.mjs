import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { DynamoDBClient, GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { ACCESS_ROLES } from './access-setup.mjs';
import { verifySource } from './verify.mjs';
import { partitionRecoveryStorage } from './partition-recovery.mjs';
const execute = promisify(execFile);
const account = '092954139775'; const region = 'us-east-1';
const journal = `arn:aws:dynamodb:${region}:${account}:table/KnownEnoughOperationsJournal`;
const prefixes = { migration: 'PARTITION#', archive: 'ARCHIVE#', erasure: 'LIFECYCLE#', retention: 'RETENTION#', jobs: 'MODELJOB#' };
const failures = new Set(['ACCESS_INPUT_REJECTED', 'ACCESS_IDENTITY_REJECTED', 'ACCESS_PROBE_CONFLICT',
  'ACCESS_WRITE_UNKNOWN', 'ACCESS_READBACK_FAILED', 'ACCESS_BOUNDARY_NOT_ENFORCED', 'ACCESS_DENIAL_UNVERIFIED', 'ACCESS_STORAGE_FAILED']);
function fail(code) { throw new Error(code); }
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** Synthetic capability proof only: no participant records, consent, TOTAL, source/control or provider invocation. */
export async function probeAccess(env, kind, identity, send, recovery) {
  let sourceSha;
  try { sourceSha = verifySource(env); } catch { fail('ACCESS_INPUT_REJECTED'); }
  const probeId = env.PROBE_ID;
  if (!Object.hasOwn(ACCESS_ROLES, kind) || typeof probeId !== 'string'
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(probeId)
    || typeof send !== 'function') fail('ACCESS_INPUT_REJECTED');
  const role = ACCESS_ROLES[kind];
  if (identity?.Account !== account || typeof identity.Arn !== 'string'
    || !identity.Arn.startsWith(`arn:aws:sts::${account}:assumed-role/${role}/`)) fail('ACCESS_IDENTITY_REJECTED');
  const id = digest(`${sourceSha}:${probeId}:${kind}`);
  const key = { PK: { S: prefixes[kind] + id }, SK: { S: 'OPS00_PROBE' } };
  const body = Buffer.from(JSON.stringify({ schemaVersion: 1, kind: 'OPS00_ACCESS_PROBE', synthetic: true, sourceSha, profile: kind, id }));
  const expected = { ...key, payload: { S: body.toString() } };
  const signal = globalThis.AbortSignal.timeout(20_000); let requests = 0;
  const context = { signal, request() { if (++requests > 16 || signal.aborted) fail('ACCESS_STORAGE_FAILED'); } };
  const request = async command => { context.request(); return send(command, { abortSignal: signal }); };
  const get = () => request(new GetItemCommand({ TableName: journal, Key: key, ConsistentRead: true }));
  const current = await get(); let resumed = false;
  if (current.Item) {
    if (!isDeepStrictEqual(current.Item, expected)) fail('ACCESS_PROBE_CONFLICT');
    resumed = true;
  } else {
    try {
      await request(new TransactWriteItemsCommand({ TransactItems: [{ Put: { TableName: journal,
        Item: expected, ConditionExpression: 'attribute_not_exists(PK)' } }], ClientRequestToken: id.slice(0, 32) }));
    } catch (error) {
      // Never issue a second write after an unknown/conditional acknowledgement; consistent read reconciles it.
      const observed = await get();
      if (!isDeepStrictEqual(observed.Item, expected)) throw new Error('ACCESS_WRITE_UNKNOWN', { cause: error });
      resumed = true;
    }
    if (!isDeepStrictEqual((await get()).Item, expected)) fail('ACCESS_READBACK_FAILED');
  }
  // Safe negative probe: a synthetic key under a forbidden prefix, never a real AUTH/TOTAL/person row.
  try {
    await request(new GetItemCommand({ TableName: journal, Key: { PK: { S: `OPS00_FORBIDDEN#${id}` }, SK: { S: 'OPS00_PROBE' } }, ConsistentRead: true }));
    fail('ACCESS_BOUNDARY_NOT_ENFORCED');
  } catch (error) {
    if (error.message === 'ACCESS_BOUNDARY_NOT_ENFORCED') throw error;
    if (error.name !== 'AccessDeniedException' && error.name !== 'AccessDenied') throw new Error('ACCESS_DENIAL_UNVERIFIED', { cause: error });
  }
  let recoveryVerified = 'NOT_REQUIRED';
  if (kind === 'migration' || kind === 'archive') {
    if (typeof recovery?.preserve !== 'function' || typeof recovery?.read !== 'function') fail('ACCESS_INPUT_REJECTED');
    context.request(); const saved = await recovery.preserve(body, digest(body), context);
    context.request(); const copy = await recovery.read(digest(body), saved.versionId, context);
    if (copy.versionId !== saved.versionId || !Buffer.isBuffer(copy.bytes) || !copy.bytes.equals(body)) fail('ACCESS_READBACK_FAILED');
    recoveryVerified = 'VERSIONED_READBACK_PASS';
  }
  return { schemaVersion: 1, sourceSha, account, region, profile: kind, result: 'ACCESS_CAPABILITY_PROBE_PASS',
    resumed, requests, syntheticJournal: 'READ_WRITE_READBACK_PASS', forbiddenPrefix: 'ACCESS_DENIED', recovery: recoveryVerified,
    retainedProbe: true, participantOperations: 'NOT_EXECUTED', migration: 'NOT_EXECUTED', providerCalls: 0,
    limitation: 'Demonstrated scoped journal/recovery operations; actual service/cutover/consent/provider acceptance remains in OPS01-03.' };
}
export function accessFailure(error) {
  let awsError; let cause = error;
  const known = new Set(['AccessDeniedException', 'AccessDenied', 'CredentialsProviderError', 'ExpiredToken',
    'ResourceNotFoundException', 'TransactionCanceledException', 'PreconditionFailed']);
  for (let depth = 0; cause && depth < 5; depth++, cause = cause.cause) if (known.has(cause.name)) { awsError = cause.name; break; }
  return { result: 'BLOCKED', code: failures.has(error?.message) ? error.message : 'ACCESS_STORAGE_FAILED',
    ...(awsError ? { awsError } : {}), providerCalls: 0, participantOperations: 'NOT_EXECUTED' };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const kind = process.argv[2];
    verifySource(process.env);
    if (!Object.hasOwn(ACCESS_ROLES, kind) || process.argv.length !== 3) fail('ACCESS_INPUT_REJECTED');
    const { stdout } = await execute('aws', ['sts', 'get-caller-identity', '--region', region,
      '--endpoint-url', 'https://sts.us-east-1.amazonaws.com', '--output', 'json', '--no-cli-pager'], { timeout: 10_000, maxBuffer: 8192 });
    const client = new DynamoDBClient({ region, endpoint: 'https://dynamodb.us-east-1.amazonaws.com', maxAttempts: 1 });
    console.log(JSON.stringify(await probeAccess(process.env, kind, JSON.parse(stdout), client.send.bind(client), partitionRecoveryStorage())));
  } catch (error) { console.error(JSON.stringify(accessFailure(error))); process.exitCode = 1; }
}
