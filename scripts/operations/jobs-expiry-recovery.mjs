/** Recover positively owned expired, never-called deliveries through the normal fenced application cancellation. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { ControlSchema, JobSchema, TotalsSchema } from '../../packages/adapters/src/durable-model-jobs.ts';
import { createDynamoModelJobStore, createDynamoModelJobLoader, JOB_TARGET as target } from '../../packages/adapters/src/dynamo-model-jobs.ts';
import { createDurableNegotiationWorker } from '../../apps/api/src/durable-model-worker.ts';
import { verifySource } from './verify.mjs';
const execute = promisify(execFile), digest = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw Object.assign(Error(code), { safeCode: code }); };
export function checkedExpiry(control, job, expected, now) {
  if (!control.enabled || control.sourceSha !== expected.runtimeSource || control.slots.length
    || !control.active.includes(job?.reference.jobId) || control.active.length > expected.ownedHashes.length) fail('EXPIRY_CONTROL_CHANGED');
  if (job.reference.sourceSha !== expected.runtimeSource || job.reference.kind !== 'NEGOTIATION'
    || !expected.ownedHashes.includes(digest(job.reference.decisionId))) fail('EXPIRY_NOT_OWNED');
  if (job.phase !== 'READY' || job.attempts !== 0 || job.failures !== 0 || job.lease !== null || job.usage !== null
    || job.reservedTokens !== 0 || job.reservedCostMicros !== 0 || job.reference.expiresAt > now) fail('EXPIRY_NOT_PROVEN_UNCALLED');
}
export function checkedExpiryCommit(prior, next, fence, effect, expected, now) {
  checkedExpiry(prior.control, prior.job, expected, now);
  if (!fence || !effect || effect.writes.length !== 1 || effect.writes[0].key.PK !== `ROOM#${prior.job.reference.decisionId}`
    || effect.writes[0].key.SK !== 'STATE' || next.job.phase !== 'DEAD' || next.job.reason !== 'EXPIRED'
    || next.job.attempts !== 0 || next.job.reservedTokens !== 0 || next.job.reservedCostMicros !== 0
    || !next.control.enabled || next.control.sourceSha !== expected.runtimeSource || next.control.slots.length
    || !isDeepStrictEqual(next.control.active, prior.control.active.filter(id => id !== prior.job.reference.jobId))
    || !isDeepStrictEqual(prior.totals, next.totals)) fail('EXPIRY_ATOMIC_CANCELLATION_REQUIRED');
  const old = JSON.parse(fence.pins.find(pin => pin.table === target.decisions).payload).record;
  const result = JSON.parse(effect.writes[0].payload).record;
  if (old.job?.id !== prior.job.reference.reasoningJobId || result.job !== null || result.status !== 'READY'
    || !isDeepStrictEqual(old.owners, result.owners) || !isDeepStrictEqual(old.frameConfirmations, result.frameConfirmations)
    || result.solveEpoch !== old.solveEpoch + 1 || result.controlVersion !== old.controlVersion + 1) fail('EXPIRY_APPLICATION_EFFECT_INVALID');
}
async function main(phase) {
  const sourceSha = verifySource(process.env), runtimeSource = process.env.RUNTIME_SOURCE;
  const ownedHashes = (process.env.OWNED_HASHES ?? '').split(',');
  if (!/^[a-f0-9]{40}$/.test(runtimeSource ?? '') || ownedHashes.length < 1 || ownedHashes.length > 8
    || new Set(ownedHashes).size !== ownedHashes.length || ownedHashes.some(hash => !/^[a-f0-9]{64}$/.test(hash))) fail('EXPIRY_INPUT_INVALID');
  const expected = { runtimeSource, ownedHashes }, root = process.env.RUNNER_TEMP, path = join(root, 'expiry-recovery-private.json');
  const aws = async (...args) => { const { stdout } = await execute('aws', [...args, '--region', target.region, '--output', 'json', '--no-cli-pager'], { timeout: 30000, maxBuffer: 1048576 }); return stdout.trim() ? JSON.parse(stdout) : {}; };
  const identity = await aws('sts', 'get-caller-identity');
  const role = phase === 'backup' ? 'KnownEnoughGithubQaRelease' : 'KnownEnoughGithubModelJobOperations';
  if (identity.Account !== target.account || !identity.Arn?.startsWith(`arn:aws:sts::${target.account}:assumed-role/${role}/`)) fail('EXPIRY_IDENTITY_INVALID');
  const client = new DynamoDBClient({ region: target.region, maxAttempts: 1 });
  const get = async (TableName, PK) => { const item = (await client.send(new GetItemCommand({ TableName, Key: { PK: { S: PK }, SK: { S: 'STATE' } }, ConsistentRead: true }), { abortSignal: globalThis.AbortSignal.timeout(10000) })).Item; return JSON.parse(item.payload.S); };
  const control = async () => ControlSchema.parse(await get(target.journal, 'OPERATIONS#MODEL_JOBS'));
  const totals = async () => TotalsSchema.parse(await get(target.budget, 'TOTAL'));
  if (phase === 'inspect') {
    const current = await control(), before = await totals(), jobs = [];
    if (current.active.length !== ownedHashes.length) fail('EXPIRY_ACTIVE_SET_CHANGED');
    const load = createDynamoModelJobLoader({ verifiedTarget: { account: target.account, region: target.region }, sourceSha: runtimeSource });
    for (const id of current.active) {
      const job = JobSchema.parse(await get(target.journal, 'MODELJOB#' + id)); checkedExpiry(current, job, expected, Date.now());
      const context = await load(job.reference); if (!context.enabled) fail('EXPIRY_AUTHORITY_DISABLED');
      jobs.push({ job, fence: context.fence });
    }
    if (new Set(jobs.map(value => digest(value.job.reference.decisionId))).size !== ownedHashes.length) fail('EXPIRY_OWNERSHIP_SET_CHANGED');
    await writeFile(path, JSON.stringify({ sourceSha, expected, control: current, totals: before, jobs, backupKey: `ops01-owned/${randomUUID()}/e2e02-expiry-private.json` }), { mode: 0o600 });
  } else {
    const saved = JSON.parse(await readFile(path, 'utf8'));
    if (saved.sourceSha !== sourceSha || !isDeepStrictEqual(saved.expected, expected)) fail('EXPIRY_CHECKPOINT_CHANGED');
    if (phase === 'backup') {
      await aws('s3api', 'put-object', '--bucket', `known-enough-qa-artifacts-${target.account}`, '--key', saved.backupKey,
        '--body', path, '--server-side-encryption', 'AES256', '--if-none-match', '*');
      await writeFile(join(root, 'expiry-backup-private.json'), JSON.stringify({ digest: digest(await readFile(path)), key: saved.backupKey }), { mode: 0o600 });
    } else if (phase === 'recover') {
      const backup = JSON.parse(await readFile(join(root, 'expiry-backup-private.json'), 'utf8'));
      if (backup.digest !== digest(await readFile(path)) || backup.key !== saved.backupKey
        || !isDeepStrictEqual(await control(), saved.control) || !isDeepStrictEqual(await totals(), saved.totals)) fail('EXPIRY_BACKUP_OR_STATE_CHANGED');
      const native = createDynamoModelJobStore({ verifiedTarget: { account: target.account, region: target.region }, sourceSha: runtimeSource });
      const store = { read: native.read, deliveries: native.deliveries, async commit(prior, next, fence, effect) {
        checkedExpiryCommit(prior, next, fence, effect, expected, Date.now()); return native.commit(prior, next, fence, effect);
      } };
      const worker = createDurableNegotiationWorker({ store, now: Date.now,
        load: createDynamoModelJobLoader({ verifiedTarget: { account: target.account, region: target.region }, sourceSha: runtimeSource }),
        model: async () => fail('EXPIRY_PROVIDER_FORBIDDEN'), publicCandidates: () => fail('EXPIRY_PREPARE_FORBIDDEN') });
      for (const { job } of saved.jobs) {
        const current = await native.read(job.reference.jobId); checkedExpiry(current.control, current.job, expected, Date.now());
        if (!isDeepStrictEqual(current.job, job) || !isDeepStrictEqual(current.totals, saved.totals)) fail('EXPIRY_JOB_CHANGED');
        if (await worker.process({ jobId: job.reference.jobId }) !== 'DEAD') fail('EXPIRY_NOT_TERMINATED');
        const after = await native.read(job.reference.jobId);
        if (after.job.phase !== 'DEAD' || after.job.reason !== 'EXPIRED' || after.job.attempts !== 0) fail('EXPIRY_TERMINAL_READBACK_FAILED');
        const decision = await get(target.decisions, `ROOM#${job.reference.decisionId}`);
        const original = JSON.parse(saved.jobs.find(value => value.job.reference.jobId === job.reference.jobId).fence.pins.find(pin => pin.table === target.decisions).payload).record;
        if (decision.record.status !== 'READY' || decision.record.job !== null || !isDeepStrictEqual(original.owners, decision.record.owners)
          || !isDeepStrictEqual(original.frameConfirmations, decision.record.frameConfirmations)) fail('EXPIRY_NATIVE_READBACK_FAILED');
      }
      const end = await control(); if (!end.enabled || end.sourceSha !== runtimeSource || end.active.length || end.slots.length
        || !isDeepStrictEqual(await totals(), saved.totals)) fail('EXPIRY_FINAL_STATE_CHANGED');
    } else fail('EXPIRY_PHASE_INVALID');
  }
  return { sourceSha, runtimeSource, phase, result: 'OWNED_EXPIRY_RECOVERY_PASS', jobs: ownedHashes.length, providerCalls: 0,
    ...(phase === 'recover' ? { decisionsReady: ownedHashes.length, answersAndConfirmationsPreserved: true, totalsValuesUnchanged: true, active: 0, slots: 0 } : {}) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let report;
  try { report = await main(process.argv[2]); }
  catch (error) { report = { result: 'OWNED_EXPIRY_RECOVERY_BLOCKED', code: error.safeCode ?? (/^(AccessDenied|AccessDeniedException|TransactionCanceledException)$/.test(error.name) ? error.name : 'EXPIRY_UNVERIFIED'), providerCalls: 0 }; process.exitCode = 1; }
  await writeFile(join(process.env.RUNNER_TEMP, `expiry-${process.argv[2]}-report.json`), JSON.stringify(report) + '\n');
}
