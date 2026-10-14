import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createMailtmClient } from '../live-qa/mailtm.mjs';
import { createPartitionManagedDriver } from '../../packages/adapters/src/partition-managed.ts';
import { createPartitionedGroupRepository } from '../../packages/adapters/src/partitioned-group-repository.ts';
import { partitionDeploymentOptions } from '../../apps/api/src/partition-deployment.ts';
import { operatorFromVerifiedPackage } from './runtime.mjs';
import { ownFixture, jsonResponse } from '../operations/partition-live-behavior.mjs';

const execute = promisify(execFile), root = join(process.env.RUNNER_TEMP, 'partition-cutover-private');
const api = 'https://u94iyvt6p9.execute-api.us-east-1.amazonaws.com', poolId = 'us-east-1_V9OMjd0zx', clientId = '3accf7paalvon2m8ue8okfi853';
const report = { source: process.env.EXPECTED_SOURCE, result: 'NOT_EXECUTED', stage: 'START', checks: [],
  signupEmailRequests: 0, selfDeleted: 0, modelCalls: 0 };
let intent, token;
async function cognito(operation, body) {
  const response = await globalThis.fetch('https://cognito-idp.us-east-1.amazonaws.com/', {
    method: 'POST', redirect: 'error', signal: globalThis.AbortSignal.timeout(10000),
    headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.' + operation },
    body: JSON.stringify(body) });
  const value = await jsonResponse(response);
  if (!response.ok) throw new Error('OWN_COGNITO_' + operation.toUpperCase() + '_FAILED');
  return value;
}
async function authenticate(username, password) {
  const require = createRequire(new URL('../live-qa/package.json', import.meta.url));
  const { CognitoUserPool, CognitoUser, AuthenticationDetails } = require('amazon-cognito-identity-js');
  const pool = new CognitoUserPool({ UserPoolId: poolId, ClientId: clientId }); let calls = 0;
  pool.client.request = (operation, body, callback) => {
    if (++calls > 4) return callback(new Error('OWN_SRP_LIMIT'));
    cognito(operation, body).then(value => callback(null, value), callback);
  };
  const user = new CognitoUser({ Username: username, Pool: pool });
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error('OWN_SRP_TIMEOUT')), 30000);
    user.authenticateUser(new AuthenticationDetails({ Username: username, Password: password }), {
      onSuccess: session => { globalThis.clearTimeout(timer); resolve(session.getAccessToken().getJwtToken()); },
      onFailure: () => { globalThis.clearTimeout(timer); reject(new Error('OWN_SRP_FAILED')); }
    });
  });
}
async function preserve() {
  const path = join(root, 'shared-email-recovery-private.json');
  await writeFile(path, JSON.stringify(intent), { mode: 0o600 });
  await execute('aws', ['s3api', 'put-object', '--bucket', 'known-enough-qa-artifacts-092954139775',
    '--key', 'ops01-owned/' + intent.runId + '/shared-email-recovery-private.json', '--body', path,
    '--server-side-encryption', 'AES256', '--region', 'us-east-1', '--no-cli-pager'], { timeout: 30000, maxBuffer: 16384 });
}
async function request(accessToken, path, body) {
  const response = await globalThis.fetch(api + path, { method: body ? 'POST' : 'GET',
    signal: globalThis.AbortSignal.timeout(15000), headers: { authorization: 'Bearer ' + accessToken,
      ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, value: await jsonResponse(response) };
}
const phase = process.argv[2];
const privatePath = join(root, 'shared-email-recovery-private.json');
try {
 if (phase === 'create') {
  const state = JSON.parse(await readFile(join(root, 'owned-fixtures-private.json')));
  if (state.sourceSha !== process.env.EXPECTED_SOURCE || state.fixtures.length !== 2) throw new Error('OWN_SOURCE_REQUIRED');
  const owner = ownFixture(state.fixtures[0], state.runId);
  const prior = await request(owner.accessToken, '/account');
  if (prior.status !== 200 || prior.value.account?.status !== 'APPROVED') throw new Error('OWN_APPROVED_ACCOUNT_REQUIRED');
  report.stage = 'DIRECT_PROFILE_LOOKUP';
  const direct = await authenticate(owner.mailbox.address, owner.password);
  const replay = await request(direct, '/account/register', { displayName: 'New member' });
  if (replay.status !== 200 || replay.value.account?.status !== 'APPROVED'
    || JSON.stringify(replay.value.account) !== JSON.stringify(prior.value.account)) throw new Error('DIRECT_VERIFIED_RECOVERY_FAILED');
  report.checks.push({ operation: 'SRP_GETUSER_REGISTRATION_REPLAY', result: 'PASS', admission: 'UNCHANGED_APPROVED' });

  report.stage = 'DUPLICATE_EMAIL_CONFIRMATION';
  intent = { runId: state.runId, source: process.env.EXPECTED_SOURCE, username: 'keqa-shared-' + randomUUID().replaceAll('-', ''),
    password: randomBytes(24).toString('base64url') + 'aA1!', created: false, confirmAttempted: false, selfDeleted: false };
  await preserve();
  const since = Math.max(owner.mailbox.createdAt, Math.floor(Date.now() / 1000) * 1000);
  const signup = await cognito('SignUp', { ClientId: clientId, Username: intent.username, Password: intent.password,
    UserAttributes: [{ Name: 'email', Value: owner.mailbox.address }] });
  intent.created = true; intent.subject = signup.UserSub; report.signupEmailRequests = 1; await preserve();
  if (!/^[a-f0-9-]{36}$/.test(intent.subject)) throw new Error('OWN_CREATED_SUBJECT_REQUIRED');
  const mail = createMailtmClient(); let code;
  for (let attempt = 0; attempt < 3 && !code; attempt++) code = await mail.code({ ...owner.mailbox, createdAt: since });
  if (!code) throw new Error('OWN_CONFIRMATION_MAIL_NOT_OBSERVED');
  intent.confirmAttempted = true; await preserve();
  await cognito('ConfirmSignUp', { ClientId: clientId, Username: intent.username, ConfirmationCode: code });
  intent.confirmed = true; await preserve();
  token = await authenticate(intent.username, intent.password);
  const profile = await cognito('GetUser', { AccessToken: token });
  const attributes = Object.fromEntries(profile.UserAttributes.map(value => [value.Name, value.Value]));
  if (attributes.sub !== intent.subject || attributes.email_verified !== 'true' || attributes.email !== owner.mailbox.address)
    throw new Error('OWN_VERIFIED_DUPLICATE_REQUIRED');
  report.checks.push({ operation: 'DUPLICATE_EMAIL_CONFIRMATION', result: 'PASS', callbackError: false });
  report.stage = 'SHARED_EMAIL_REGISTRATION';
  const duplicate = await request(token, '/account/register', { displayName: 'New member' });
  if (duplicate.status !== 200 || duplicate.value.account?.status !== 'PENDING') throw new Error('SHARED_PENDING_ACCOUNT_REQUIRED');
  intent.registered = true; intent.accessToken = token; intent.original = prior.value.account; await preserve();
  const account = await request(token, '/account'), original = await request(owner.accessToken, '/account');
  if (account.status !== 200 || account.value.account?.status !== 'PENDING' || JSON.stringify(original.value.account) !== JSON.stringify(prior.value.account)
    || (await request(token, '/groups')).status !== 403) throw new Error('SHARED_EMAIL_AUTHORITY_CHANGED');
  report.checks.push({ operation: 'SAME_EMAIL_INDEPENDENT_PENDING_NO_ORIGINAL_CHANGE', result: 'PASS' });
  report.result = 'SHARED_EMAIL_REGISTRATION_LIVE_PASS';
 } else {
  try { intent = JSON.parse(await readFile(privatePath)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!intent) { report.result = 'OWN_SHARED_ACCOUNT_NOT_CREATED'; }
  else {
   const state = JSON.parse(await readFile(join(root, 'owned-fixtures-private.json')));
   if (intent.source !== process.env.EXPECTED_SOURCE || intent.runId !== state.runId || !/^keqa-shared-[a-f0-9]{32}$/.test(intent.username)
       || !/^[a-f0-9-]{36}$/.test(intent.subject ?? '')) throw new Error('OWN_SHARED_IDENTITY_REQUIRED');
   const owner = ownFixture(state.fixtures[0], state.runId);
   if (phase === 'approve') {
    const operator = await operatorFromVerifiedPackage(root), listed = await operator.listPending();
    if (!listed.pending.some(row => row.username === intent.username && row.eligible)) throw new Error('OWN_SHARED_PENDING_LIST_REQUIRED');
    const approval = await operator.approve(intent.username);
    if (approval.result !== 'APPROVED' || approval.dataWrites !== 1) throw new Error('OWN_SHARED_APPROVAL_FAILED');
    const repeated = await operator.approve(intent.username);
    if (repeated.result !== 'ALREADY_APPROVED' || repeated.dataWrites !== 0) throw new Error('OWN_SHARED_REPLAY_FAILED');
    const own = await request(intent.accessToken, '/account'), original = await request(owner.accessToken, '/account');
    const groups = await request(intent.accessToken, '/groups');
    if (own.value.account?.status !== 'APPROVED' || JSON.stringify(original.value.account) !== JSON.stringify(intent.original)
        || groups.status !== 200 || groups.value.groups.length !== 0) throw new Error('OWN_SHARED_APPROVAL_NOT_INDEPENDENT');
    report.checks.push({ operation: 'PRIVATE_LIST_SELECTED_APPROVAL_NO_SHARED_MEMBERSHIP', result: 'PASS' });
    report.result = 'SHARED_EMAIL_OPERATOR_LIVE_PASS';
   } else if (phase === 'disable') {
    const configBytes = await readFile(join(root, 'configuration-private.json'));
    const options = partitionDeploymentOptions(configBytes, await readFile(join(root, 'manifest-private.json')), JSON.parse(await readFile(join(root, 'release-private.json'))));
    const driver = createPartitionManagedDriver(options.managed), repo = createPartitionedGroupRepository(driver.groups);
    const config = JSON.parse(configBytes), hash = createHmac('sha256', config.emailKey).update(owner.mailbox.address).digest('hex');
    await repo.transaction({ accountSubjects: [intent.subject] }, snapshot => {
      const account = snapshot.accounts.find(row => row.subject === intent.subject);
      if (!account) return;
      if (account.sharedTestEmail !== true || account.emailHash !== hash || account.profile?.loginUsername !== intent.username) throw new Error('OWN_SHARED_NATIVE_IDENTITY_REQUIRED');
      if (account.status !== 'DISABLED') { account.status = 'DISABLED'; account.version++; }
    });
    intent.disabled = true; await writeFile(privatePath, JSON.stringify(intent), { mode: 0o600 });
    report.result = 'SHARED_EMAIL_NATIVE_DISABLE_PASS';
   } else if (phase === 'delete') {
    if (!intent.disabled) throw new Error('OWN_NATIVE_DISABLE_REQUIRED');
    token = await authenticate(intent.username, intent.password);
    await cognito('DeleteUser', { AccessToken: token }); intent.selfDeleted = true; report.selfDeleted = 1; await preserve();
    report.result = 'SHARED_EMAIL_SELF_DELETE_PASS';
   } else throw new Error('OWN_PHASE_INVALID');
  }
 }
} catch (error) {
 report.result = 'BLOCKED'; report.error = /^[A-Z0-9_]{1,80}$/.test(error.message) ? error.message : 'OWN_SHARED_EMAIL_PROOF_UNAVAILABLE';
} finally {
 await writeFile(join(process.env.RUNNER_TEMP, 'fix04-shared-email-' + phase + '-report.json'), JSON.stringify(report, null, 2));
 console.log(JSON.stringify(report));
}
if (report.result === 'BLOCKED') process.exitCode = 1;
