import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';
import { safeAwsFailureDetail } from '../../scripts/shared-staging-error.mjs';

describe('shared staging diagnostics protect private data', () => {
  test('keeps the exact known denied resource and reason without the principal or secret', () => {
    const resource = 'arn:aws:amplify:us-east-1:092954139775:apps/d143q5ravxp5av/branches/main/jobs/*';
    const result = safeAwsFailureDetail(`An error occurred (AccessDeniedException) when calling the ListJobs operation: User: PRIVATE_PRINCIPAL is not authorized to perform: amplify:ListJobs on resource: ${resource} because no identity-based policy allows the action; PRIVATE_SECRET`);
    expect(result).toContain(`resource=${resource}`);
    expect(result).toContain('reason=no identity-based allow');
    expect(result).not.toMatch(/PRIVATE_PRINCIPAL|PRIVATE_SECRET/);
  });

  test('does not publish arbitrary resources, private codes or payloads', () => {
    const result = safeAwsFailureDetail('An error occurred (PRIVATE_VALUE) on resource: arn:aws:secretsmanager:us-east-1:092954139775:secret:PRIVATE_SECRET payload=PRIVATE_INPUT');
    expect(result).toBe('');
    expect(safeAwsFailureDetail('An error occurred (AccessDenied) on resource: arn:aws:amplify:us-east-1:092954139775:apps/d143q5ravxp5av/branches/main-PRIVATE_NAME')).toBe(' (code=AccessDenied)');
  });

  test('handles absent or generic stderr without leaking its text', () => {
    expect(safeAwsFailureDetail(null)).toBe('');
    expect(safeAwsFailureDetail('PRIVATE_UNKNOWN_FAILURE')).toBe('');
  });
});

test('a failed inventory never reports ready features or a passing shared run', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'shared-staging-report-test-'));
  try {
    const inventoryPath = resolve(directory, 'inventory.json');
    const publicPath = resolve(directory, 'public.json');
    const reportPath = resolve(directory, 'report.md');
    writeFileSync(inventoryPath, JSON.stringify({ collection: { status: 'failed', issue: 'Amplify denied' }, checks: [{ name: 'AWS inspection collection', status: 'failed', detail: 'Amplify denied' }] }));
    writeFileSync(publicPath, JSON.stringify({ suites: [{ specs: Array.from({ length: 10 }, (_, index) => ({ title: `public ${index}`, tests: [{ results: [{ status: 'passed' }] }] })) }] }));
    const result = spawnSync(process.execPath, ['scripts/render-shared-staging-report.mjs'], {
      encoding: 'utf8',
      env: { ...process.env, RUN_ON_MAIN: 'true', PUBLIC_TEST_OUTCOME: 'success', AWS_INSPECTOR_OUTCOME: 'success', STAGING_INSPECTION_JSON: inventoryPath, PLAYWRIGHT_RESULT_JSON: publicPath, SHARED_STAGING_REPORT_PATH: reportPath, GITHUB_STEP_SUMMARY: '' },
    });
    expect(result.status).toBe(1);
    const report = readFileSync(reportPath, 'utf8');
    expect(report).toContain('**Execution:** FAIL');
    expect(report).toContain('AWS feature readiness could not be checked');
    expect(report).not.toContain('No AWS feature checks are blocked');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
