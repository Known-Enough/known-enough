import { describe, expect, test, vi, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
// @ts-expect-error Operational JavaScript is exercised with fake CLI results, no AWS requests.
import { aws } from '../../scripts/live-qa/aws.mjs';
vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
afterEach(() => vi.resetAllMocks());

describe('AWS missing-role-policy recovery', () => {
  test.each([
    ['NoSuchEntity', true],
    ['AccessDenied', false],
    ['ExpiredToken', false],
  ])('classifies %s without exposing diagnostics', (code, missing) => {
    vi.mocked(spawnSync).mockReturnValueOnce({ status: 254, stdout: '', stderr: `An error occurred (${code}) when calling GetRolePolicy: PRIVATE_DIAGNOSTIC` } as ReturnType<typeof spawnSync>);
    let caught: unknown;
    try { aws('iam', 'get-role-policy', { RoleName: 'KnownEnoughStageApiRole', PolicyName: 'KnownEnoughStageGroups' }); }
    catch (error) { caught = error; }
    expect(caught).toMatchObject({ message: 'AWS_OPERATION_FAILED:iam:get-role-policy', missing });
    expect(String(caught)).not.toContain('PRIVATE_DIAGNOSTIC');
  });
  test('retains valid existing policies', () => {
    vi.mocked(spawnSync).mockReturnValueOnce({ status: 0, stdout: '{"PolicyDocument":{"Version":"2012-10-17"}}', stderr: '' } as ReturnType<typeof spawnSync>);
    expect(aws('iam', 'get-role-policy', {})).toEqual({ PolicyDocument: { Version: '2012-10-17' } });
  });
});


test.each([0, 254])('large Lambda ZIP uses private binary file with revision guard and cleanup (status %i)', async status => {
  const zip = Buffer.from(Array.from({ length: 555000 }, (_, index) => index % 256));
  const originalInput = { FunctionName: 'known-enough-stage-api', RevisionId: 'exact-current-revision', ZipFile: zip.toString('base64') };
  const native = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  let uploadedFile = '';
  vi.mocked(spawnSync).mockImplementationOnce((_command, args) => {
    const argv = args as string[];
    uploadedFile = argv[argv.indexOf('--zip-file') + 1]!.replace('fileb://', '');
    expect(readFileSync(uploadedFile)).toEqual(zip);
    expect(statSync(uploadedFile).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(uploadedFile)).mode & 0o777).toBe(0o700);
    expect(JSON.parse(argv[argv.indexOf('--cli-input-json') + 1]!)).toEqual({ FunctionName: originalInput.FunctionName, RevisionId: originalInput.RevisionId });
    expect(argv.every(arg => Buffer.byteLength(arg) < 128 * 1024)).toBe(true);
    if (process.platform === 'linux') expect(native.spawnSync('/bin/true', argv).status).toBe(0);
    return { status, stdout: status ? '' : '{"RevisionId":"new-revision"}', stderr: status ? 'AccessDenied PRIVATE_DIAGNOSTIC' : '' } as ReturnType<typeof spawnSync>;
  });
  if (status) expect(() => aws('lambda', 'update-function-code', originalInput)).toThrow('AWS_OPERATION_FAILED:lambda:update-function-code');
  else expect(aws('lambda', 'update-function-code', originalInput)).toEqual({ RevisionId: 'new-revision' });
  expect(originalInput.ZipFile).toBe(zip.toString('base64'));
  expect(existsSync(dirname(uploadedFile))).toBe(false);
});

test('local process launch errors remain sanitized and remove temporary upload bytes', () => {
  let uploadedFile = '';
  vi.mocked(spawnSync).mockImplementationOnce((_command, args) => {
    const argv = args as string[];
    uploadedFile = argv[argv.indexOf('--zip-file') + 1]!.replace('fileb://', '');
    return { pid: 0, output: [], stdout: '', stderr: '', signal: null, status: null,
      error: Object.assign(new Error('PRIVATE_ARGUMENTS'), { code: 'E2BIG' }) };
  });
  expect(() => aws('lambda', 'update-function-code', { ZipFile: Buffer.from('verified bytes').toString('base64') })).toThrow('AWS_CLI_PROCESS_LAUNCH_FAILED');
  expect(existsSync(dirname(uploadedFile))).toBe(false);
});

test('invalid base64 is rejected before launching AWS', () => {
  expect(() => aws('lambda', 'update-function-code', { ZipFile: 'invalid !!' })).toThrow('INVALID_LAMBDA_UPLOAD_BYTES');
  expect(spawnSync).not.toHaveBeenCalled();
});
