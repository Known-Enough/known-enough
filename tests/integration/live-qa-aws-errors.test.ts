import { describe, expect, test, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
// @ts-expect-error Operational JavaScript is exercised with fake CLI results, no AWS requests.
import { aws } from '../../scripts/live-qa/aws.mjs';
vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));

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
