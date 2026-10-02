import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, test } from 'vitest';
// @ts-expect-error Installer JavaScript is tested without cloud calls.
import { renderTemplates } from '../../scripts/live-qa/template.mjs';
// @ts-expect-error Recovery JavaScript is tested with guarded control-plane responses.
import { recoverFailedStack, recoveryTemplate, assertRecoveryStack } from '../../scripts/live-qa/recovery.mjs';
// @ts-expect-error Output directory guards are installer JavaScript.
import { privateDirectory } from '../../scripts/live-qa/private-directory.mjs';

const base = JSON.parse(readFileSync('infra/live-qa/config.example.json', 'utf8'));
const config = { ...base, sourceCommit: 'a'.repeat(40), mailboxProvider: 'mailtm', mailDomain: null, hostedZoneId: null,
  authorization: { ...base.authorization, approved: true, expiresAt: '2099-01-01T00:00:00Z', maxRunsPerDay: 4, maxAttemptsPerRun: 200, maxTokensPerRun: 250000, maxCostMicrosPerRun: 250000, attemptCostMicros: 1, maxSignupMessagesPerRun: 2, maxSignupMessagesPerDay: 8, retentionReviewed: true, invocationLoggingDisabled: true } };
const expected = renderTemplates(config, { apiKey: 'b'.repeat(64) + '/api.zip', brokerKey: 'c'.repeat(64) + '/broker.zip' }).core;
const names: Record<string, string> = { Control: 'KnownEnoughQaControl', Decisions: 'KnownEnoughQaDecisions', Groups: 'KnownEnoughQaGroups' };
const oldId = 'arn:aws:cloudformation:us-east-1:092954139775:stack/known-enough-live-qa/old';
const newId = oldId.replace('/old', '/new');
const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });
function directory() { const folder = mkdtempSync(tmpdir() + '/known-enough-recovery-test-'); folders.push(folder); return folder; }
function fixture(options: { foreign?: boolean; unowned?: boolean; active?: boolean; badImport?: boolean; failBeforeImport?: boolean; deletedArnVisible?: boolean; sessionLost?: boolean; recreatedTable?: boolean } = {}) {
  const calls: { service: string; operation: string; input: Record<string, unknown> }[] = [];
  let stackId: string | null = options.sessionLost ? null : oldId;
  let status = 'ROLLBACK_COMPLETE';
  let imported: Record<string, unknown> | null = null;
  let failed = false;
  const oldTemplate = structuredClone(expected);
  oldTemplate.Outputs.SourceCommit.Value = 'e0cd5ddd3ede595eea88aef3481c23bf01363a8a';
  const summaries = () => Object.entries(names).map(([logical, name]) => ({ LogicalResourceId: logical,
    PhysicalResourceId: name, ResourceType: 'AWS::DynamoDB::Table', ResourceStatus: imported ? 'IMPORT_COMPLETE' : 'DELETE_SKIPPED' }));
  const aws = (service: string, operation: string, input: Record<string, unknown>) => {
    calls.push({ service, operation, input });
    if (operation === 'list-stacks') return { StackSummaries: [{ StackName: 'known-enough-live-qa', StackId: oldId, CreationTime: '2026-10-02T03:00:00Z', DeletionTime: '2026-10-02T03:40:00Z' }] };
    if (operation === 'describe-stacks') {
      if (options.sessionLost && input.StackName === oldId) return { Stacks: [{ StackId: oldId, StackStatus: 'DELETE_COMPLETE', Tags: [{ Key: 'KnownEnoughQa', Value: 'true' }] }] };
      if (!stackId && input.StackName === oldId && options.deletedArnVisible) return { Stacks: [{ StackId: oldId, StackStatus: 'DELETE_COMPLETE' }] };
      if (!stackId || (input.StackName === oldId && stackId !== oldId)) throw Object.assign(new Error('missing'), { missing: true });
      return { Stacks: [{ StackId: stackId, StackStatus: status,
        Tags: [{ Key: 'KnownEnoughQa', Value: options.unowned ? 'false' : 'true' }],
        Outputs: imported ? Object.entries((imported as { Outputs: Record<string, { Value: unknown }> }).Outputs)
          .map(([key, value]) => ({ OutputKey: key, OutputValue: typeof value.Value === 'object' ? names[(value.Value as { Ref: string }).Ref] : value.Value })) : [],
      }] };
    }
    if (operation === 'get-template') return { TemplateBody: imported ?? oldTemplate };
    if (operation === 'list-stack-resources') return { StackResourceSummaries: [...summaries(), ...(options.foreign ? [{ LogicalResourceId: 'Foreign', PhysicalResourceId: 'human', ResourceType: 'AWS::S3::Bucket', ResourceStatus: 'DELETE_SKIPPED' }] : [])] };
    if (operation === 'describe-table') return { Table: { TableArn: `arn:aws:dynamodb:us-east-1:092954139775:table/${input.TableName}`, TableStatus: 'ACTIVE', CreationDateTime: options.recreatedTable ? '2030-01-01T00:00:00Z' : '2026-10-02T03:01:00Z',
      KeySchema: [{ AttributeName: 'PK', KeyType: 'HASH' }, { AttributeName: 'SK', KeyType: 'RANGE' }],
      AttributeDefinitions: [{ AttributeName: 'PK', AttributeType: 'S' }, { AttributeName: 'SK', AttributeType: 'S' }], BillingModeSummary: { BillingMode: 'PAY_PER_REQUEST' } } };
    if (operation === 'list-tags-of-resource') return { Tags: [{ Key: 'KnownEnoughQa', Value: 'true' }] };
    if (operation === 'get-item') return options.active ? { Item: { payload: { S: '{"status":"ACTIVE"}' } } } : {};
    if (operation === 'delete-stack') { expect(input.StackName).toBe(oldId); stackId = null; return {}; }
    if (operation === 'create-change-set') {
      if (options.failBeforeImport && !failed) { failed = true; throw new Error('TRANSIENT'); }
      expect(input.ChangeSetType).toBe('IMPORT');
      expect(input.ResourcesToImport).toHaveLength(3);
      imported = JSON.parse(String(input.TemplateBody)); stackId = newId; status = 'REVIEW_IN_PROGRESS';
      return { Id: 'change-id', StackId: newId };
    }
    if (operation === 'describe-change-set') return { Status: 'CREATE_COMPLETE', ExecutionStatus: status === 'IMPORT_COMPLETE' ? 'EXECUTE_COMPLETE' : 'AVAILABLE',
      Changes: Object.keys(names).map(name => ({ ResourceChange: { LogicalResourceId: name, ResourceType: 'AWS::DynamoDB::Table', Action: options.badImport ? 'Modify' : 'Import' } })) };
    if (operation === 'execute-change-set') { status = 'IMPORT_COMPLETE'; return {}; }
    throw new Error('Unexpected operation: ' + service + ':' + operation);
  };
  return { aws, calls };
}

describe('LIVE04 low-quota recovery', () => {
  test('uses shared Lambda capacity while retaining model guards and API throttling', () => {
    for (const name of ['ApiFunction', 'Broker', 'PreSignup', 'CustomMessage']) expect(expected.Resources[name].Properties).not.toHaveProperty('ReservedConcurrentExecutions');
    expect(expected.Resources.Stage.Properties.DefaultRouteSettings).toEqual({ ThrottlingBurstLimit: 10, ThrottlingRateLimit: 5 });
    expect(expected.Resources.ApiFunction.Properties.Environment.Variables.QA_CONTROL_TABLE).toEqual({ Ref: 'Control' });
  });
  test('imports exactly the three retained tables without deleting tables or data; repeat is read-only', async () => {
    const f = fixture(); const folder = directory();
    expect(await recoverFailedStack(config, expected, folder, f.aws, async () => {})).toMatchObject({ status: 'RETAINED_TABLES_IMPORTED', tablesPreserved: 3 });
    expect(f.calls.filter(call => call.operation === 'delete-stack')).toHaveLength(1);
    expect(f.calls.some(call => /delete-table|delete-item|put-item|update-table/.test(call.operation))).toBe(false);
    const start = f.calls.length;
    await recoverFailedStack(config, expected, folder, f.aws, async () => {});
    expect(f.calls.slice(start).some(call => /delete|create|execute|update/.test(call.operation))).toBe(false);
  });
  test.each([{ foreign: true }, { unowned: true }, { active: true }])('blocks foreign resources, ownership failure or active fixtures before mutation: %j', async options => {
    const f = fixture(options);
    await expect(recoverFailedStack(config, expected, directory(), f.aws, async () => {})).rejects.toThrow();
    expect(f.calls.some(call => /delete|create|execute|update/.test(call.operation))).toBe(false);
  });
  test('rebuilds the exact journal from AWS history after all temporary files are lost', async () => {
    const f = fixture({ sessionLost: true });
    await expect(recoverFailedStack(config, expected, directory(), f.aws, async () => {})).resolves.toMatchObject({ tablesPreserved: 3 });
    expect(f.calls.some(call => call.operation === 'delete-stack')).toBe(false);
    expect(f.calls.filter(call => call.operation === 'create-change-set')).toHaveLength(1);
  });
  test('refuses tables recreated outside the failed stack lifetime', async () => {
    const f = fixture({ sessionLost: true, recreatedTable: true });
    await expect(recoverFailedStack(config, expected, directory(), f.aws, async () => {})).rejects.toThrow('EXACT_DELETED_STACK_ORIGIN_REQUIRED');
    expect(f.calls.some(call => /delete|create|execute|update/.test(call.operation))).toBe(false);
  });
  test('permits only private temporary or persistent state folders, rejecting symlinks and repo output', () => {
    const persistent = join(homedir(), 'known-enough-live-qa-state', 'directory-guard-test-' + Date.now());
    folders.push(persistent);
    expect(privateDirectory(persistent, '/example/repo')).toBe(persistent);
    expect(statSync(persistent).mode & 0o777).toBe(0o700);
    expect(() => privateDirectory(join(homedir(), 'public'), '/example/repo')).toThrow('PRIVATE_OUTPUT_DIRECTORY_REQUIRED');
    const temporary = directory();
    expect(() => privateDirectory(temporary, temporary)).toThrow('PRIVATE_OUTPUT_DIRECTORY_REQUIRED');
    const link = join(directory(), 'redirect'); symlinkSync(persistent, link);
    expect(() => privateDirectory(link + '/nested', '/example/repo')).toThrow('PRIVATE_DIRECTORY_SYMLINK_REJECTED');
  });

  test.each([2, 10])('resume preserves the original authorization and refuses expiry (October %i)', day => {
    const helper = readFileSync('scripts/live-qa/resume.sh', 'utf8').split("config=$(python3 - \"$commit\" <<'PY'\n")[1]?.split("\nPY\n)")[0];
    expect(helper).toBeDefined();
    const saved = { ...config, sourceCommit: '5d6d5e169c166c900564623b49704a1eed59db42', primaryRollout: true,
      authorization: { ...config.authorization, expiresAt: '2026-10-09T03:16:41.171626Z' } };
    const result = spawnSync('python3', ['-c', `
import json, sys, subprocess, datetime as dates
from pathlib import Path
root = Path(sys.argv[1])
path = root / 'known-enough-free-qa.fixture' / 'config.json'
path.parent.mkdir()
original = json.loads(sys.argv[3])
path.write_text(json.dumps(original))
Path.home = classmethod(lambda cls: root)
day = int(sys.argv[4])
class Clock(dates.datetime):
    @classmethod
    def now(cls, tz=None): return cls(2026, 10, day, tzinfo=tz)
dates.datetime = Clock
calls = []
def cloud(*args, **kwargs):
    calls.append(args)
    return json.dumps({'LastUpdateStatus':'Successful', 'RevisionId':'fresh', 'Environment':{'Variables':{'KE14_MODEL_MODE':'DISABLED','KE14_PAID_CALLS_APPROVED':'false'}}})
subprocess.check_output = cloud
helper = sys.argv[2]
sys.argv = ['resume', 'a' * 40]
try:
    exec(helper)
except SystemExit as error:
    assert day == 10 and str(error) == 'ORIGINAL_AUTHORIZATION_EXPIRED'
    assert not calls and json.loads(path.read_text()) == original
else:
    current = json.loads(path.read_text())
    assert day == 2 and len(calls) == 1
    assert current['authorization'] == original['authorization']
    assert current['sourceCommit'] == 'a' * 40 and current['primaryExpectedRevision'] == 'fresh'
`, directory(), helper!, JSON.stringify(saved), String(day)], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
  test('continues when AWS still describes a deleted stack by its ARN', async () => {
    const f = fixture({ deletedArnVisible: true });
    await expect(recoverFailedStack(config, expected, directory(), f.aws, async () => { throw new Error('SHOULD_NOT_WAIT'); })).resolves.toMatchObject({ tablesPreserved: 3 });
  });
  test('resumes after metadata removal without deleting anything twice', async () => {
    const f = fixture({ failBeforeImport: true }); const folder = directory();
    await expect(recoverFailedStack(config, expected, folder, f.aws, async () => {})).rejects.toThrow('TRANSIENT');
    await expect(recoverFailedStack(config, expected, folder, f.aws, async () => {})).resolves.toMatchObject({ tablesPreserved: 3 });
    expect(f.calls.filter(call => call.operation === 'delete-stack')).toHaveLength(1);
  });
  test('never executes a change set that modifies instead of importing tables', async () => {
    const f = fixture({ badImport: true });
    await expect(recoverFailedStack(config, expected, directory(), f.aws, async () => {})).rejects.toThrow('RECOVERY_CHANGE_SET_SCOPE_MISMATCH');
    expect(f.calls.some(call => call.operation === 'execute-change-set')).toBe(false);
  });
  test('requires live authorization and rejects a forged recovery marker/template', async () => {
    const f = fixture();
    await expect(recoverFailedStack({ ...config, authorization: { ...config.authorization, approved: false } }, expected, directory(), f.aws)).rejects.toThrow('RECOVERY_AUTHORIZATION_REQUIRED');
    expect(f.calls).toHaveLength(0);
    const template = recoveryTemplate(config, expected);
    template.Resources.Control.Properties.TableName = 'human-data';
    expect(() => assertRecoveryStack(config, { StackStatus: 'IMPORT_COMPLETE', Tags: [{ Key: 'KnownEnoughQa', Value: 'true' }], Outputs: [] }, [], template, expected)).toThrow();
  });
});
