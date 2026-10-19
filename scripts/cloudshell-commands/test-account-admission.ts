/** Administrator-only setup. Reuses native registration and exact-user approval;
 * never expose this program as a participant API or upload it to Lambda. */
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { partitionDeploymentOptions } from '../../apps/api/src/partition-deployment.ts';
import { createPartitionManagedDriver } from '../../packages/adapters/src/partition-managed.ts';
import { createPartitionGroupSession } from '../../packages/adapters/src/partition-group-session.ts';
import { createPartitionAccountOperator } from '../../packages/adapters/src/partition-account-operator.ts';
import { providerByUsername, sanitizeError } from '../fix04/runtime.mjs';

function fail(code: string): never { throw new Error(code); }
const [directory, stateFile, mode] = process.argv.slice(2);
try {
  if (!directory || !stateFile || !['prepare', 'approve'].includes(mode ?? '')) fail('INVALID_ARGUMENT');
  const bytes = await readFile(join(directory!, 'configuration-private.json'));
  const config = JSON.parse(bytes.toString());
  const options = partitionDeploymentOptions(bytes, await readFile(join(directory!, 'manifest-private.json')),
    JSON.parse(await readFile(join(directory!, 'release-private.json'), 'utf8')));
  if (config.userPoolId !== 'us-east-1_V9OMjd0zx'
    || config.allowedOrigin !== 'https://main.d143q5ravxp5av.amplifyapp.com') fail('TARGET_MISMATCH');
  const managed = createPartitionManagedDriver(options.managed);
  if (mode === 'prepare') {
    // Native release/manifest validation and actual activation/source read;
    // no participant record or other data is written by this check.
    await managed.groups.read({ PK: 'ACCOUNT#test-account-preflight', SK: 'STATE' });
    console.log(JSON.stringify({ result: 'ACCOUNT_ADMISSION_TOOL_READY' }));
  } else {
    const state = JSON.parse(await readFile(stateFile!, 'utf8'));
    const named = state.batchKind === 'NAMED_FIFTEEN';
    const count = named ? 15 : 10;
    const expectedNames = Array.from({ length: 15 }, (_, index) => 'test' + String(index + 4).padStart(2, '0'));
    if (state.account !== '092954139775' || state.pool !== config.userPoolId
      || state.email !== 'martelaxe@gmail.com' || !Array.isArray(state.users)
      || state.users.length !== count || new Set(state.users.map((u: { username: string }) => u.username)).size !== count
      || (named && state.users.some((user: { username: string }, index: number) => user.username !== expectedNames[index])))
      fail('BATCH_IDENTITY_MISMATCH');
    const session = createPartitionGroupSession(managed.groups, {
      emailKey: options.emailKey,
      ...(options.sharedTestEmailHashes ? { sharedTestEmailHashes: options.sharedTestEmailHashes } : {}) });
    const operator = createPartitionAccountOperator({ target: { account: '092954139775', region: 'us-east-1' },
      emailKey: options.emailKey, groups: managed.groups,
      catalog: async function* () { /* This program never lists or approves other accounts. */ },
      byUsername: providerByUsername,
      bySubject: async subject => {
        const saved = state.users.find((u: { subject: string }) => u.subject === subject);
        const identity = saved ? await providerByUsername(saved.username) : null;
        return identity ? [identity] : [];
      } });
    const save = async () => {
      await writeFile(stateFile! + '.new', JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
      await rename(stateFile! + '.new', stateFile!);
    };
    for (const [index, user] of state.users.entries()) {
      if ((!named && !/^ke-test-[a-f0-9]{6}-\d{2}$/.test(user.username)) || user.status !== 'LOGIN_CREATED')
        fail('CONFIRMED_OWNED_LOGIN_REQUIRED');
      const identity = await providerByUsername(user.username);
      if (!identity || identity.subject !== user.subject || identity.username !== user.username
        || identity.email !== state.email || !identity.verified || !identity.enabled) fail('BATCH_IDENTITY_MISMATCH');
      user.appStatus = 'REGISTER_REQUESTED'; await save();
      // Identity comes from the administrator's fresh IAM-authenticated Cognito
      // lookup, not an invented JWT, user-supplied subject, or browser mock.
      const account = await session.register({ kind: 'participant', subject: identity.subject },
        { subject: identity.subject, email: identity.email, verified: true, username: identity.username },
        { displayName: named ? user.username : 'Test ' + String(index + 1).padStart(2, '0') });
      if (!['PENDING', 'APPROVED'].includes(account.status)) fail('ACCOUNT_NOT_ELIGIBLE');
      user.appStatus = 'APPROVAL_REQUESTED'; await save();
      const approved = await operator.approve(identity.username);
      if (!['APPROVED', 'ALREADY_APPROVED'].includes(approved.result)) fail('APPROVAL_NOT_CONFIRMED');
      const observed = await session.status({ kind: 'participant', subject: identity.subject });
      if (observed?.status !== 'APPROVED') fail('APPROVAL_READBACK_FAILED');
      user.appStatus = 'APPROVED'; await save();
      console.log(JSON.stringify({ username: identity.username, appAccess: 'APPROVED' }));
    }
    state.appAccess = 'APPROVED'; await save();
    console.log(JSON.stringify({ result: named ? 'FIFTEEN_TEST_ACCOUNTS_READY' : 'TEN_TEST_ACCOUNTS_READY', count,
      appAccess: 'APPROVED', credentialsFile: stateFile, emailSent: false,
      modelCalls: 0, groupsCreated: 0, consentGranted: false }));
  }
} catch (error) {
  const native = sanitizeError(error);
  const message = error instanceof Error ? error.message : '';
  console.log(JSON.stringify({ result: 'ACCOUNT_ADMISSION_STOPPED',
    code: /^[A-Z_]{1,80}$/.test(message) ? message : native.code,
    operation: native.operation, automaticRetry: false }));
  process.exitCode = 1;
}
