import { afterEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const fakeAws = vi.hoisted(() => vi.fn());
vi.mock('../../scripts/live-qa/aws.mjs', async original => ({ ...await original<object>(), aws: fakeAws }));
vi.mock('node:child_process', () => ({ spawnSync: vi.fn(() => ({ status: 0, stdout: 'a'.repeat(40) })) }));
// @ts-expect-error Operational JavaScript is tested with fake AWS, no cloud requests.
import { publish, releaseFailure } from '../../scripts/live-qa/release.mjs';
const target = {
  Account: '092954139775', Region: 'us-east-1', ApiUrl: 'https://d9jmc6pa40.execute-api.us-east-1.amazonaws.com',
  FrontendUrl: 'https://main.d2l23pkzmr1tio.amplifyapp.com/', PoolId: 'us-east-1_hnJQ0S8mT', ParticipantClientId: '7tsbhkca6lb1jet77uh4bqaq31', DisplayClientId: '40hmstvo6sqifp5pef8m3g89od',
  CognitoDomain: 'https://known-enough-qa-092954139775.auth.us-east-1.amazoncognito.com', ApiFunction: 'known-enough-qa-api', BrokerFunction: 'known-enough-qa-fixtures',
  DecisionTable: 'KnownEnoughQaDecisions', GroupTable: 'KnownEnoughQaGroups', ControlTable: 'KnownEnoughQaControl', MailboxBucket: 'NOT_USED_MAILTM', MailboxProvider: 'mailtm',
  LoginSecret: 'arn:aws:secretsmanager:us-east-1:092954139775:secret:known-enough/qa/run-login-example',
  TestRoleArn: 'arn:aws:iam::092954139775:role/KnownEnoughGithubQaTest', ReleaseRoleArn: 'arn:aws:iam::092954139775:role/KnownEnoughGithubQaRelease',
  PrimaryReleaseRoleArn: 'arn:aws:iam::092954139775:role/KnownEnoughGithubPrimaryRelease', SourceCommit: 'a'.repeat(40), AmplifyAppId: 'd2l23pkzmr1tio'
};
afterEach(() => vi.resetAllMocks());
describe('release failure evidence', () => {
  test('actual publisher writes an allowlisted failed operation after frontend denial', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'known-enough-release-error-'));
    const bytes = Buffer.from('synthetic package'), sha = createHash('sha256').update(bytes).digest('hex');
    const resource = 'arn:aws:amplify:us-east-1:092954139775:apps/d2l23pkzmr1tio/branches/main/deployments/*';
    try {
      for (const artifact of ['api', 'broker', 'web']) writeFileSync(join(directory, artifact + '.zip'), bytes);
      writeFileSync(join(directory, 'target.json'), JSON.stringify(target));
      writeFileSync(join(directory, 'expected.json'), JSON.stringify({ sourceCommit: 'a'.repeat(40), artifacts: Object.fromEntries(['api', 'broker', 'web'].map(key => [key, { sha256: sha }])) }));
      fakeAws.mockImplementation((service, operation, input) => {
        if (service === 'sts') return { Account: target.Account, Arn: 'arn:aws:sts::092954139775:assumed-role/KnownEnoughGithubQaRelease/test' };
        if (service === 'dynamodb') return input.Key.PK.S === 'AUTH' ? { Item: { payload: { S: JSON.stringify({ approved: true, expiresAt: new Date(Date.now() + 86400000).toISOString() }) } } } : {};
        if (service === 's3api') return {};
        if (service === 'lambda' && operation === 'get-function-configuration') return { LastUpdateStatus: 'Successful', State: 'Active', CodeSha256: Buffer.from(sha, 'hex').toString('base64') };
        if (service === 'amplify' && operation === 'create-deployment') throw Object.assign(new Error('AWS_OPERATION_FAILED:amplify:create-deployment'), { awsCode: 'AccessDeniedException', deniedResource: resource, privateData: 'PRIVATE_SECRET' });
        throw new Error('Unexpected call');
      });
      await expect(publish(directory)).rejects.toThrow('QA_RELEASE_FAILED');
      const text = readFileSync(join(directory, 'release-failure.json'), 'utf8');
      expect(JSON.parse(text)).toMatchObject({ status: 'FAIL', rollback: 'PASS', failure: { code: 'AWS_OPERATION_FAILED:amplify:create-deployment', awsCode: 'AccessDeniedException', deniedResource: resource } });
      expect(text).not.toContain('PRIVATE_SECRET');
      expect(fakeAws.mock.calls.some(([, operation]) => operation === 'update-function-code')).toBe(false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  test('nested errors retain known causes and omit arbitrary messages, codes and resources', () => {
    const cause = Object.assign(new Error('AWS_OPERATION_FAILED:s3api:put-object'), { awsCode: 'AccessDenied', deniedResource: 'PRIVATE_RESOURCE', body: 'PRIVATE_SECRET' });
    expect(releaseFailure(new Error('QA_RELEASE_FAILED', { cause }))).toEqual({ code: cause.message, awsCode: 'AccessDenied' });
    expect(releaseFailure(new Error('PRIVATE_SECRET'))).toEqual({ code: 'QA_RELEASE_BLOCKED_OR_FAILED' });
    expect(releaseFailure(Object.assign(new Error('AWS_OPERATION_FAILED:amplify:create-deployment'), { awsCode: 'PRIVATE_SECRET', deniedResource: 'PRIVATE_RESOURCE' }))).toEqual({ code: 'AWS_OPERATION_FAILED:amplify:create-deployment' });
    const loop = new Error('PRIVATE_SECRET'); Object.assign(loop, { cause: loop });
    expect(releaseFailure(loop)).toEqual({ code: 'QA_RELEASE_BLOCKED_OR_FAILED' });
  });
});
