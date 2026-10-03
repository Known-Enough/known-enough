import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, test, vi } from 'vitest';
// @ts-expect-error Node-only GitHub receipt verification, no live requests.
import { approvalInputs, approvalContext, approvalReceipt, githubApprovals, githubAllowance } from '../../scripts/live-qa/github-allowance.mjs';
// @ts-expect-error Activation is exercised against local files and a fake workload, no AWS call.
import { activateRunApprovals } from '../../scripts/live-qa/activate-run-approvals.mjs';
import { createHash } from 'node:crypto';

const now = Date.parse('2026-10-03T21:00:00Z');
const requestId = '12345678-1234-4123-8123-123456789abc';
const inputs = { runs: '2', for_user: 'Battosai1806', day: '2026-10-03', request_id: requestId };
const context = { repository: 'Known-Enough/known-enough', repositoryId: '1377587215', ref: 'refs/heads/main',
  event: 'workflow_dispatch', actor: 'martelaxe', actorId: '44531296', triggeringActor: 'martelaxe' };
const receipt = { id: 88, display_title: `QA allowance: 2 runs for Battosai1806 on 2026-10-03 [${requestId}]`,
  actor: { login: 'martelaxe', id: 44531296 }, triggering_actor: { login: 'martelaxe', id: 44531296 },
  repository: { id: 1377587215 }, head_repository: { id: 1377587215 }, head_branch: 'main', head_sha: 'a'.repeat(40),
  path: '.github/workflows/approve-live-qa-runs.yml', event: 'workflow_dispatch', status: 'completed', conclusion: 'success', created_at: '2026-10-03T20:00:00Z' };
const testRun = { id: 123, run_attempt: 1, actor: { login: 'Battosai1806' }, triggering_actor: { login: 'Battosai1806' },
  repository: { id: 1377587215 }, head_repository: { id: 1377587215 }, head_branch: 'main', head_sha: 'b'.repeat(40),
  path: '.github/workflows/live-qa-release-and-check.yml', event: 'workflow_run', status: 'in_progress' };
const authorization = { approved: true, expiresAt: '2026-10-09T03:16:41.171626Z', maxRunsPerDay: 4,
  maxAttemptsPerRun: 200, maxTokensPerRun: 250000, maxCostMicrosPerRun: 250000, attemptCostMicros: 1,
  maxSignupMessagesPerRun: 2, maxSignupMessagesPerDay: 8, retentionReviewed: true, invocationLoggingDisabled: true };
const daily = { runs: 6, messages: 4 };
const total = { runs: 6, reservedTokens: 100, reservedCostMicros: 100, messages: 4 };

describe('GitHub-only finite run approval', () => {
  test('A approves an exact count and recipient for today with a reusable request ID', () => {
    expect(() => approvalContext(context)).not.toThrow();
    expect(approvalInputs(inputs, now)).toEqual({ runs: 2, actor: 'Battosai1806', day: '2026-10-03', requestId });
    for (const change of [{ runs: '0' }, { runs: '11' }, { runs: '2.0' }, { runs: '02' }, { runs: '2;PRIVATE' },
      { for_user: 'outsider' }, { day: '2026-10-04' }, { request_id: 'PRIVATE' }, { unexpected: 'PRIVATE' }])
      expect(() => approvalInputs({ ...inputs, ...change }, now)).toThrow('INVALID_RUN_APPROVAL');
  });
  test('B, a renamed account, fork, other branch, or automatic event cannot approve', () => {
    for (const change of [{ actor: 'Battosai1806' }, { actorId: '1' }, { triggeringActor: 'Battosai1806' },
      { repositoryId: '1' }, { repository: 'fork/known-enough' }, { ref: 'refs/heads/other' }, { event: 'push' }])
      expect(() => approvalContext({ ...context, ...change })).toThrow('A_GITHUB_APPROVAL_REQUIRED');
  });
  test('only a successful dated main dispatch by both verified A actor fields is a receipt', () => {
    expect(approvalReceipt(receipt, now)).toEqual(approvalInputs(inputs, now));
    for (const change of [{ actor: { login: 'martelaxe', id: 1 } }, { triggering_actor: { login: 'Battosai1806', id: 44531296 } },
      { repository: { id: 1 } }, { head_repository: { id: 1 } }, { head_branch: 'other' }, { head_sha: 'PRIVATE' },
      { event: 'push' }, { path: '.github/workflows/other.yml' }, { status: 'in_progress' }, { conclusion: 'failure' },
      { created_at: '2026-10-02T20:00:00Z' }, { created_at: '2026-10-03T22:00:00Z' }, { display_title: 'PRIVATE' }])
      expect(() => approvalReceipt({ ...receipt, ...change }, now)).toThrow();
    expect(() => approvalReceipt(receipt, Date.parse('2026-10-04T00:00:00Z'))).toThrow();
  });
  test('two extra starts consume the same receipt twice; reruns never replenish it', async () => {
    let saved: { value: Record<string, unknown> | null; version: number } = { value: null, version: 0 };
    const read = vi.fn(async () => structuredClone(saved));
    const reserve = () => githubAllowance([receipt, { ...receipt, id: 89 }], authorization, 3, daily, total, 'gh-123-1', testRun, now, read);
    const first = await reserve();
    expect(first.id).toBe('GITHUB-EXTRA#' + requestId); expect(first.next.usedRuns).toBe(1); expect(saved.value).toBeNull();
    saved = { value: first.next, version: 1 };
    const second = await reserve(); expect(second.prior.version).toBe(1); expect(second.next.usedRuns).toBe(2);
    saved = { value: second.next, version: 2 };
    await expect(reserve()).rejects.toThrow('NO_APPROVED_EXTRA_RUNS');
    expect(authorization.maxRunsPerDay).toBe(4); expect(daily.runs).toBe(6); expect(total.runs).toBe(6);
  });
  test('reusing an approval ID with a changed count is rejected; changed usage/version cannot reset it', async () => {
    const changed = { ...receipt, id: 89, display_title: receipt.display_title.replace(': 2 runs', ': 3 runs') };
    const read = vi.fn(async () => ({ value: null, version: 0 }));
    await expect(githubAllowance([receipt, changed], authorization, 3, daily, total, 'gh-123-1', testRun, now, read)).rejects.toThrow('GITHUB_APPROVAL_REQUEST_DRIFT');
    expect(read).not.toHaveBeenCalled();
    const first = await githubAllowance([receipt], authorization, 3, daily, total, 'gh-123-1', testRun, now, read);
    for (const value of [{ ...first.next, usedRuns: -1 }, { ...first.next, runs: 10 }, { ...first.next, authorizationVersion: 4 },
      { ...first.next, private: 'PRIVATE' }])
      await expect(githubAllowance([receipt], authorization, 3, daily, total, 'gh-123-1', testRun, now,
        async () => ({ value, version: 1 }))).rejects.toThrow('GITHUB_APPROVAL_USAGE_DRIFT');
  });
  test('an A receipt for B cannot be used by A, a fork or an unverified test workflow', async () => {
    for (const change of [{ actor: { login: 'outsider' } }, { triggering_actor: { login: 'martelaxe' } },
      { repository: { id: 1 } }, { head_branch: 'other' }, { event: 'workflow_dispatch' }, { run_attempt: 2 }])
      await expect(githubAllowance([receipt], authorization, 3, daily, total, 'gh-123-1', { ...testRun, ...change }, now,
        async () => ({ value: null, version: 0 }))).rejects.toThrow('EXTRA_RUN_ACTOR_UNVERIFIED');
    await expect(githubAllowance([receipt], authorization, 3, daily, total, 'gh-123-1',
      { ...testRun, actor: { login: 'martelaxe' }, triggering_actor: { login: 'martelaxe' } }, now,
      async () => ({ value: null, version: 0 }))).rejects.toThrow('NO_APPROVED_EXTRA_RUNS');
  });
  test('a receipt never raises expired, email or cumulative token/cost/run budgets', async () => {
    const reserve = (a = authorization, d = daily, t = total) => githubAllowance([receipt], a, 3, d, t, 'gh-123-1', testRun, now, async () => ({ value: null, version: 0 }));
    await expect(reserve({ ...authorization, expiresAt: '2026-10-03T20:00:00Z' })).rejects.toThrow();
    await expect(reserve(authorization, { ...daily, messages: 7 })).rejects.toThrow('EXTRA_RUN_BUDGET_BLOCKED');
    for (const change of [{ runs: 28 }, { reservedTokens: 7000000 }, { reservedCostMicros: 7000000 }, { messages: 56 }])
      await expect(reserve(authorization, daily, { ...total, ...change })).rejects.toThrow();
  });
  test('lookup is fixed, bounded and private; incomplete or failed history cannot add runs', async () => {
    const fetcher = vi.fn(async (url: string, options: Record<string, unknown>) => {
      expect(url).toContain('/Known-Enough/known-enough/actions/workflows/approve-live-qa-runs.yml/runs?');
      expect(new URL(url).searchParams.get('created')).toBe('2026-10-03');
      expect(options.redirect).toBe('error'); expect(options.signal).toBeDefined();
      return { ok: true, json: async () => ({ total_count: 1, workflow_runs: [receipt] }) };
    });
    expect(await githubApprovals(now, fetcher)).toEqual([receipt]);
    for (const data of [{ total_count: 101, workflow_runs: [] }, { total_count: 2, workflow_runs: [receipt] }])
      await expect(githubApprovals(now, async () => ({ ok: true, json: async () => data }))).rejects.toThrow('GITHUB_APPROVALS_UNAVAILABLE');
    await expect(githubApprovals(now, async () => { throw new Error('PRIVATE_PROVIDER_PAYLOAD'); })).rejects.toThrow('GITHUB_APPROVALS_UNAVAILABLE');
  });
  test('the actual workflow recorder needs only GitHub context and produces no AWS write', () => {
    const folder = mkdtempSync(join(tmpdir(), 'qa-github-approval-'));
    try {
      const day = new Date().toISOString().slice(0, 10);
      writeFileSync(join(folder, 'event.json'), JSON.stringify({ inputs: { ...inputs, day } }));
      const env = { ...process.env, GITHUB_REPOSITORY: context.repository, GITHUB_REPOSITORY_ID: context.repositoryId,
        GITHUB_REF: context.ref, GITHUB_EVENT_NAME: context.event, GITHUB_ACTOR: context.actor, GITHUB_ACTOR_ID: context.actorId,
        GITHUB_TRIGGERING_ACTOR: context.triggeringActor, GITHUB_EVENT_PATH: join(folder, 'event.json'), GITHUB_STEP_SUMMARY: join(folder, 'summary.md') };
      const result = spawnSync(process.execPath, ['scripts/live-qa/record-run-approval.mjs'], { env, encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ status: 'GITHUB_RUN_ALLOWANCE_RECORDED', runs: 2, cloudWrites: false });
      const denied = spawnSync(process.execPath, ['scripts/live-qa/record-run-approval.mjs'], { env: { ...env, GITHUB_ACTOR: 'Battosai1806' }, encoding: 'utf8' });
      expect(denied.status).toBe(1); expect(denied.stderr).toContain('A_GITHUB_RUN_APPROVAL_REQUIRED');
      const workflow = readFileSync('.github/workflows/approve-live-qa-runs.yml', 'utf8');
      expect(workflow).not.toMatch(/id-token:|AWS_|role-to-assume|workflow_run:|push:/);
      for (const match of workflow.matchAll(/uses: (\S+)/g)) expect(match[1]).toMatch(/@[a-f0-9]{40}$/);
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });
  test('one-time activation updates only broker code with a revision guard; retry does not write', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'qa-approval-activation-'));
    try {
      const bytes = Buffer.from('local broker package'); const sha = createHash('sha256').update(bytes).digest('hex');
      writeFileSync(join(folder, 'broker.zip'), bytes);
      writeFileSync(join(folder, 'package.json'), JSON.stringify({ sourceCommit: 'a'.repeat(40), artifacts: { broker: { sha256: sha, entry: 'broker.handler' } } }));
      let current = { State: 'Active', LastUpdateStatus: 'Successful', Handler: 'broker.handler', RevisionId: 'original-revision',
        CodeSha256: Buffer.from('b'.repeat(64), 'hex').toString('base64'), Environment: { Variables: { QA_CONTROL_TABLE: 'KnownEnoughQaControl', PRIVATE: 'DO_NOT_PRINT' } } };
      const updates: Record<string, unknown>[] = [];
      const call = (service: string, operation: string, parameters: Record<string, unknown> = {}) => {
        if (service === 'sts') return { Account: '092954139775', Arn: 'arn:aws:sts::092954139775:assumed-role/KnownEnoughGithubQaRelease/test' };
        if (service === 'dynamodb') {
          expect(operation).toBe('get-item'); const pk = (parameters.Key as { PK: { S: string } }).PK.S;
          expect(['AUTH', 'LEASE']).toContain(pk);
          return { Item: { payload: { S: JSON.stringify(pk === 'AUTH' ? { approved: true, expiresAt: new Date(Date.now() + 600000).toISOString() } : { status: 'CLEAN' }) } } };
        }
        if (service === 's3api') { expect(['head-object', 'put-object']).toContain(operation); return {}; }
        expect(service).toBe('lambda'); expect(parameters.FunctionName).toBe('known-enough-qa-fixtures');
        if (operation === 'get-function-configuration') return structuredClone(current);
        expect(operation).toBe('update-function-code'); expect(parameters.RevisionId).toBe('original-revision');
        expect(parameters).not.toHaveProperty('Environment'); updates.push(parameters);
        current = { ...current, CodeSha256: Buffer.from(sha, 'hex').toString('base64'), RevisionId: 'after-revision' }; return current;
      };
      const first = await activateRunApprovals(folder, call); expect(first).toMatchObject({ status: 'GITHUB_RUN_APPROVALS_ACTIVATED', testStarted: false, cloudWrites: true });
      expect(updates).toHaveLength(1); expect(JSON.stringify(first)).not.toMatch(/PRIVATE|DO_NOT_PRINT/);
      const second = await activateRunApprovals(folder, call); expect(second.cloudWrites).toBe(false); expect(updates).toHaveLength(1);
      const workflow = readFileSync('.github/workflows/activate-qa-run-approvals.yml', 'utf8');
      expect(workflow).toContain('known-enough-isolated-qa-release-and-test'); expect(workflow).not.toMatch(/workflow_run:|push:|runner\.mjs|deploy-amplify/);
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });
  test('one-time activation rejects a personal or wrong workload before any code write', async () => {
    const call = vi.fn(() => ({ Account: '092954139775', Arn: 'arn:aws:sts::092954139775:assumed-role/ReadOnlyAccess/test' }));
    await expect(activateRunApprovals('/tmp/unused', call)).rejects.toThrow('RUN_APPROVAL_ACTIVATION_BLOCKED');
    expect(call).toHaveBeenCalledTimes(1);
  });
});
