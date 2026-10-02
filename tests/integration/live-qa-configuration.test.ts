import { readFileSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'vitest';
// @ts-expect-error Offline setup JavaScript is exercised at runtime.
import { configure, configurationStatus, draftConfiguration, writeDraft } from '../../scripts/live-qa/configure.mjs';
// @ts-expect-error Setup JavaScript is exercised at runtime.
import { isMailDomain, validateConfig } from '../../scripts/live-qa/config.mjs';
// @ts-expect-error Setup preflight JavaScript is exercised without AWS.
import { mailboxGuard } from '../../scripts/live-qa/install.mjs';
const inputs = { mailDomain: 'qa-mail.example.org', hostedZoneId: 'Z123456789', sourceCommit: 'a'.repeat(40) };

describe('LIVE04 configurable offline preparation, no AWS calls', () => {
  test('unknown details remain explicit draft placeholders without granting paid or primary rollout access', () => {
    const draft = draftConfiguration();
    expect(configurationStatus(draft)).toEqual({ status: 'NEEDS_INPUTS', missing: ['mailDomain', 'hostedZoneId', 'sourceCommit'],
      authorizationEnabled: false, primaryRollout: false, cloudWrites: false });
    expect(draft.authorization.maxRunsPerDay).toBe(0);
    expect(() => validateConfig(draft)).toThrow();
    const partial = draftConfiguration({ mailDomain: inputs.mailDomain });
    expect(configurationStatus(partial).missing).toEqual(['hostedZoneId', 'sourceCommit']);
    expect(() => draftConfiguration({ authorization: { approved: true } })).toThrow('UNKNOWN_CONFIGURATION_INPUT');
    expect(configurationStatus({ ...draft, account: '000000000000' }).status).toBe('INVALID_CONFIGURATION');
  });
  test('copyable Route53 values are normalized; complete syntax is only ready for read-only validation', () => {
    const draft = draftConfiguration({ ...inputs, mailDomain: 'QA-Mail.Example.Org.', hostedZoneId: '/hostedzone/Z123456789' });
    expect(draft.mailDomain).toBe(inputs.mailDomain);
    expect(draft.hostedZoneId).toBe(inputs.hostedZoneId);
    expect(validateConfig(draft).authorization.approved).toBe(false);
    expect(configurationStatus(draft).status).toBe('READY_FOR_READ_ONLY_VALIDATION');
    expect(configurationStatus({ ...draft, hostedZoneId: 'NOT_A_ZONE' })).toEqual({ status: 'INVALID_CONFIGURATION', fields: ['hostedZoneId'], cloudWrites: false });
  });
  test('private draft creation preserves existing files and rejects symlinks and invalid CLI input', () => {
    const directory = mkdtempSync(join(tmpdir(), 'known-enough-configure-'));
    try {
      const output = join(directory, 'draft.json');
      expect(configure(['init', output]).status).toBe('NEEDS_INPUTS');
      expect(statSync(output).mode & 0o777).toBe(0o600);
      const previous = readFileSync(output, 'utf8');
      expect(() => writeDraft(output, inputs)).toThrow();
      expect(readFileSync(output, 'utf8')).toBe(previous);
      const secret = join(directory, 'private.txt');
      writeFileSync(secret, 'PRIVATE_CANARY');
      const link = join(directory, 'linked.json');
      symlinkSync(secret, link);
      expect(() => writeDraft(link, inputs)).toThrow();
      expect(readFileSync(secret, 'utf8')).toBe('PRIVATE_CANARY');
      for (const args of [['init', 'relative.json'], ['init', join(directory, 'new.json'), '--approve', 'true'],
        ['init', join(directory, 'new.json'), '--mail-domain'], ['check', output, '--mail-domain', inputs.mailDomain]]) {
        expect(() => configure(args)).toThrow();
      }
      expect(configure(['check', output]).missing).toHaveLength(3);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  test('DNS names reject invalid labels, email addresses, URLs and overlong domains', () => {
    for (const name of ['qa..example.org', '-qa.example.org', 'qa-.example.org', 'a'.repeat(64) + '.example.org',
      'https://qa.example.org', 'me@qa.example.org', 'qa_mail.example.org', 'qa.example.org.', 'QA.example.org',
      Array(5).fill('a'.repeat(63)).join('.') + '.org']) {
      expect(isMailDomain(name), name).toBe(false);
      expect(() => validateConfig({ ...draftConfiguration(inputs), mailDomain: name })).toThrow();
    }
    expect(isMailDomain('qa-mail.example.org')).toBe(true);
  });
  test('mail preflight refuses private zones but accepts either public parent or delegated subdomain zones', () => {
    const config = draftConfiguration(inputs);
    expect(() => mailboxGuard(config, {}, { HostedZone: { Name: 'example.org.', Config: { PrivateZone: true } } }, {}, false)).toThrow('PUBLIC_MAIL_ZONE_REQUIRED');
    for (const name of ['example.org.', inputs.mailDomain + '.']) {
      expect(() => mailboxGuard(config, {}, { HostedZone: { Name: name, Config: { PrivateZone: false } } }, {}, false)).not.toThrow();
    }
    expect(() => mailboxGuard(config, {}, { HostedZone: { Name: 'wrong-example.org.', Config: { PrivateZone: false } } }, {}, false)).toThrow('MAIL_DOMAIN_ZONE_MISMATCH');
  });
});
