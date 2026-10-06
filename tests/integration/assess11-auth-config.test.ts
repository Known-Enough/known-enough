import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
// @ts-expect-error The task helper is runtime JavaScript, exercised by Vitest.
import { privateDirectory, privateWrite, passwordMatchesPolicy, preparePasswordPolicy, SIMPLE_PASSWORD_POLICY, summarizeAuthSnapshot } from '../../scripts/assess11-auth-config.mjs';
// @ts-expect-error The QA template is runtime JavaScript, exercised by Vitest.
import { renderTemplates } from '../../scripts/live-qa/template.mjs';

const poolId = 'us-east-1_V9OMjd0zx';
const frontend = 'https://main.d143q5ravxp5av.amplifyapp.com/';
const client = (id: string, scopes: string[]) => ({
  UserPoolId: poolId, ClientId: id, AllowedOAuthFlowsUserPoolClient: true,
  AllowedOAuthFlows: ['code'], AllowedOAuthScopes: scopes, SupportedIdentityProviders: ['COGNITO'],
  CallbackURLs: [frontend], LogoutURLs: [frontend],
});
const snapshot = {
  account: '092954139775',
  userPool: {
    Id: poolId, Domain: 'known-enough-092954139775',
    AdminCreateUserConfig: { AllowAdminCreateUserOnly: false, InviteMessageTemplate: { EmailSubject: 'unchanged' } },
    AutoVerifiedAttributes: ['email'],
    SchemaAttributes: [{ Name: 'email', Required: false }],
    Policies: { PasswordPolicy: { MinimumLength: 16, RequireUppercase: true, RequireLowercase: true,
      RequireNumbers: true, RequireSymbols: true, TemporaryPasswordValidityDays: 7 } },
    LambdaConfig: { PreSignUp: 'arn:aws:lambda:us-east-1:092954139775:function:existing' },
    DeletionProtection: 'ACTIVE',
  },
  participantClient: client('3accf7paalvon2m8ue8okfi853', ['openid', 'email']),
  displayClient: client('481ru24906sv26f30i569gq8g0', ['openid']),
};
describe('ASSESS11 exact auth readback and offline preparation', () => {
  test('allowlists policy, hosted-email capability and exact client callbacks without private configuration', () => {
    const summary = summarizeAuthSnapshot(snapshot);
    expect(summary).toMatchObject({
      selfSignupEnabled: true, emailAutoVerified: true, emailRequiredForHostedSignup: false,
      participantClient: { secretless: true, codeFlow: true, requiredScopesPresent: true,
        cognitoProvider: true, callbackExact: true, logoutExact: true },
    });
    expect(JSON.stringify(summary)).not.toContain('InviteMessageTemplate');
    expect(() => summarizeAuthSnapshot({ ...snapshot, account: '000000000000' })).toThrow('ASSESS11_POOL_IDENTITY_MISMATCH');
    expect(summarizeAuthSnapshot({ ...snapshot, participantClient: { ...snapshot.participantClient,
      CallbackURLs: ['https://other.example.invalid/'] } }).participantClient.callbackExact).toBe(false);
  });
  test('prepares a reversible policy-only change from the complete private snapshot', () => {
    const skeleton = { UserPoolId: '', Policies: {}, AdminCreateUserConfig: {},
      AutoVerifiedAttributes: [], LambdaConfig: {}, DeletionProtection: '' };
    const { updateInput, rollbackInput } = preparePasswordPolicy(snapshot, skeleton);
    expect(updateInput.Policies.PasswordPolicy).toEqual({
      ...snapshot.userPool.Policies.PasswordPolicy, ...SIMPLE_PASSWORD_POLICY,
    });
    expect(rollbackInput).toEqual({
      UserPoolId: poolId, Policies: snapshot.userPool.Policies,
      AdminCreateUserConfig: snapshot.userPool.AdminCreateUserConfig,
      AutoVerifiedAttributes: ['email'], LambdaConfig: snapshot.userPool.LambdaConfig,
      DeletionProtection: 'ACTIVE',
    });
    expect({ ...updateInput, Policies: rollbackInput.Policies }).toEqual(rollbackInput);
    expect(snapshot.userPool.Policies.PasswordPolicy.MinimumLength).toBe(16);
    expect(() => preparePasswordPolicy({ ...snapshot, userPool: { ...snapshot.userPool, Policies: undefined } },
      skeleton)).toThrow('ASSESS11_POOL_SNAPSHOT_INCOMPLETE');
  });
  test('enforces the requested five/six/long-simple boundary without character classes', () => {
    expect(passwordMatchesPolicy('abcde', SIMPLE_PASSWORD_POLICY)).toBe(false);
    expect(passwordMatchesPolicy('abcdef', SIMPLE_PASSWORD_POLICY)).toBe(true);
    expect(passwordMatchesPolicy('longsimplepassword', SIMPLE_PASSWORD_POLICY)).toBe(true);
  });
  test('isolated QA pool template uses the same policy, without deploying it', () => {
    const base = JSON.parse(readFileSync('infra/live-qa/config.example.json', 'utf8'));
    const config = { ...base, sourceCommit: 'a'.repeat(40), mailDomain: 'qa.example.org', hostedZoneId: 'Z123456789' };
    const { core } = renderTemplates(config, { apiKey: 'b'.repeat(64) + '/api.zip', brokerKey: 'c'.repeat(64) + '/broker.zip' });
    expect(core.Resources.Pool.Properties.Policies.PasswordPolicy).toEqual(SIMPLE_PASSWORD_POLICY);
  });
});

describe('private auth snapshot filesystem boundary', () => {
  test('rejects a repository alias in an existing parent without creating output', () => {
    const temp = mkdtempSync(join(tmpdir(), 'assess11-path-'));
    try {
      symlinkSync(process.cwd(), join(temp, 'alias'), 'dir');
      expect(() => privateDirectory(join(temp, 'alias', 'synthetic-output')))
        .toThrow('ASSESS11_PRIVATE_PATH_REQUIRED');
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
  test('rejects any symlink ancestor, including an external directory alias', () => {
    const temp = mkdtempSync(join(tmpdir(), 'assess11-path-'));
    try {
      mkdirSync(join(temp, 'actual'));
      symlinkSync(join(temp, 'actual'), join(temp, 'alias'), 'dir');
      expect(() => privateDirectory(join(temp, 'alias', 'output')))
        .toThrow('ASSESS11_PRIVATE_PATH_REQUIRED');
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
  test('creates owner-only external output and preserves existing snapshot on collision', () => {
    const temp = mkdtempSync(join(tmpdir(), 'assess11-path-'));
    try {
      const output = join(temp, 'private');
      privateDirectory(output);
      expect(statSync(output).mode & 0o777).toBe(0o700);
      const file = join(output, 'synthetic.json');
      privateWrite(file, { synthetic: true });
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(() => privateWrite(file, { synthetic: false })).toThrow();
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ synthetic: true });
      expect(() => privateDirectory(output)).toThrow();
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
});
