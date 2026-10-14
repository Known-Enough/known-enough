import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createMailtmClient } from '../live-qa/mailtm.mjs';
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
  const path = join(root, 'signup-recovery-private.json');
  await writeFile(path, JSON.stringify(intent), { mode: 0o600 });
  await execute('aws', ['s3api', 'put-object', '--bucket', 'known-enough-qa-artifacts-092954139775',
    '--key', 'ops01-owned/' + intent.runId + '/signup-recovery-private.json', '--body', path,
    '--server-side-encryption', 'AES256', '--region', 'us-east-1', '--no-cli-pager'], { timeout: 30000, maxBuffer: 16384 });
}
async function request(accessToken, path, body) {
  const response = await globalThis.fetch(api + path, { method: body ? 'POST' : 'GET',
    signal: globalThis.AbortSignal.timeout(15000), headers: { authorization: 'Bearer ' + accessToken,
      ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, value: await jsonResponse(response) };
}
try {
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
  intent = { runId: state.runId, source: process.env.EXPECTED_SOURCE, username: 'keqa-duplicate-' + randomUUID().replaceAll('-', ''),
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
  report.stage = 'SAFE_EMAIL_CONFLICT';
  const duplicate = await request(token, '/account/register', { displayName: 'New member' });
  if (duplicate.status !== 409 || duplicate.value.registrationFailure !== 'EMAIL_ALREADY_LINKED') throw new Error('ACTIONABLE_CONFLICT_REQUIRED');
  const account = await request(token, '/account'), original = await request(owner.accessToken, '/account');
  if (account.status !== 200 || account.value.account !== null || JSON.stringify(original.value.account) !== JSON.stringify(prior.value.account)
    || (await request(token, '/groups')).status !== 403) throw new Error('EMAIL_AUTHORITY_CHANGED');
  report.checks.push({ operation: 'DUPLICATE_CONFLICT_NO_APPROVAL_NO_ORIGINAL_CHANGE', result: 'PASS', status: 409 });
  report.result = 'SIGNUP_RECOVERY_LIVE_PASS';
} catch (error) {
  report.result = 'BLOCKED'; report.error = /^[A-Z0-9_]{1,80}$/.test(error.message) ? error.message : 'OWN_SIGNUP_PROOF_UNAVAILABLE';
} finally {
  if (intent?.created && !intent.selfDeleted) {
    try {
      token ??= await authenticate(intent.username, intent.password);
      await cognito('DeleteUser', { AccessToken: token }); intent.selfDeleted = true; report.selfDeleted = 1; await preserve();
    } catch { report.result = 'BLOCKED'; report.cleanup = 'OWN_PROVIDER_DELETE_UNCONFIRMED'; }
  }
  await writeFile(join(process.env.RUNNER_TEMP, 'fix04-signup-proof-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
if (report.result === 'BLOCKED') process.exitCode = 1;
