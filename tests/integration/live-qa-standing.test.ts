import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
// @ts-expect-error Operational JS tested offline.
import { authorizationActive, standingAuthorization, validateAuthorization } from '../../scripts/live-qa/config.mjs';
// @ts-expect-error Operational JS tested offline.
import { beginLease, reserveAttempt } from '../../scripts/live-qa/fixture-core.mjs';
// @ts-expect-error Operational JS tested offline.
import { emptyTotals, reserveTotal, authorizationTransaction } from '../../scripts/live-qa/cumulative.mjs';
// @ts-expect-error Operational JS tested offline.
import { assertInstalledEnvelope, assertCleanLease } from '../../scripts/live-qa/release.mjs';
// @ts-expect-error Operational JS tested offline.
import { assertStandingRun } from '../../scripts/live-qa/standing.mjs';
const legacy = { ...JSON.parse(readFileSync('infra/live-qa/config.example.json', 'utf8')).authorization,
  approved: true, expiresAt: '2026-10-01T00:00:00Z', maxRunsPerDay: 4, maxAttemptsPerRun: 2,
  maxTokensPerRun: 1000, maxCostMicrosPerRun: 1000, attemptCostMicros: 1,
  maxSignupMessagesPerRun: 2, maxSignupMessagesPerDay: 8, retentionReviewed: true, invocationLoggingDisabled: true };
const standing = standingAuthorization(legacy);
const now = Date.parse('2026-10-04T20:00:00Z');
const item = (value: unknown) => ({ payload: { S: JSON.stringify(value) }, version: { N: '4' } });
test('explicit standing conversion removes expired administrative fields while keeping finite run and privacy controls', () => {
  const snapshot = structuredClone(legacy);
  expect(authorizationActive(legacy, now)).toBe(false);
  expect(authorizationActive(standing, now)).toBe(true);
  expect(standing).not.toHaveProperty('expiresAt'); expect(standing).not.toHaveProperty('maxRunsPerDay');
  expect(standing).not.toHaveProperty('maxRunsTotal'); expect(standing.maxAttemptsPerRun).toBe(2);
  expect(standing.retentionReviewed).toBe(true); expect(legacy).toEqual(snapshot);
  expect(() => assertInstalledEnvelope(legacy, now)).toThrow();
  expect(() => assertInstalledEnvelope(standing, now)).not.toThrow();
});
test('malformed standing records, omitted limits, and disabled privacy controls fail closed', () => {
  for (const value of [{ ...standing, expiresAt: legacy.expiresAt }, { ...standing, maxRunsTotal: 28 },
    { ...standing, maxTokensPerRun: undefined }, { ...standing, maxSignupMessagesPerRun: 0 },
    { ...standing, invocationLoggingDisabled: false }, { ...standing, mode: 'standing-ish' }]) {
    expect(() => validateAuthorization(value)).toThrow(); expect(authorizationActive(value, now)).toBe(false);
  }
  expect(authorizationActive({ ...standing, approved: false }, now)).toBe(false);
});
test('standing usage crosses historical ceilings without erasing totals and rejects unsafe or malformed counters', () => {
  const prior = { runs: 28, reservedTokens: 7000000, reservedCostMicros: 7000000, messages: 56 };
  expect(reserveTotal(prior, standing, { runs: 1, messages: 1 })).toEqual({ ...prior, runs: 29, messages: 57 });
  expect(prior.runs).toBe(28);
  for (const value of [null, { ...emptyTotals(), runs: -1 }, { ...emptyTotals(), messages: NaN },
    { ...emptyTotals(), runs: Number.MAX_SAFE_INTEGER }, { ...emptyTotals(), extra: 1 }])
    expect(() => reserveTotal(value, standing, { runs: 1 })).toThrow();
  expect(() => reserveTotal(prior, standing, { messages: -1 })).toThrow();
  const transaction = authorizationTransaction('control', item(legacy), item({ status: 'CLEAN' }), item(prior), standing);
  expect(transaction.TransactItems.some((op: { Put?: { Item: { PK: { S: string } } } }) => op.Put?.Item.PK.S === 'TOTAL')).toBe(false);
  expect(transaction.TransactItems[1].Put.ConditionExpression).toBe('#v=:v');
  expect(() => authorizationTransaction('control', item(legacy), item({ status: 'ACTIVE' }), item(prior), standing)).toThrow('ACTIVE_LEASE');
  expect(() => authorizationTransaction('control', item(legacy), item({ status: 'CLEAN' }), undefined, standing)).toThrow('RECONCILIATION');
});
test('standing runs retain operational timeout, exclusive cleanup lease, single use and finite model reservations', () => {
  const lease = beginLease(null, 'gh-12345-1', standing, now);
  expect(lease.expiresAt).toBe(now + 45 * 60000);
  expect(beginLease(lease, lease.id, standing, now)).toEqual(lease);
  expect(() => beginLease(lease, 'gh-12346-1', standing, now)).toThrow('LEASE_OR_CLEANUP_BLOCKED');
  expect(() => beginLease({ ...lease, status: 'CLEAN' }, lease.id, standing, now)).toThrow('RUN_ID_ALREADY_USED');
  expect(() => assertCleanLease(item(lease))).toThrow();
  const first = reserveAttempt(lease, standing, now, 100, 100);
  const second = reserveAttempt(first, standing, now, 100, 100);
  expect(() => reserveAttempt(second, standing, now, 100, 100)).toThrow('MODEL_BUDGET_EXHAUSTED');
  expect(() => reserveAttempt(lease, standing, lease.expiresAt, 100, 100)).toThrow('MODEL_BUDGET_BLOCKED');
  expect(() => reserveAttempt(lease, standing, now, 1000, 100)).toThrow('MODEL_BUDGET_EXHAUSTED');
});
const run = { id: 12345, run_attempt: 1, actor: { login: 'Battosai1806', id: 143764700 },
  triggering_actor: { login: 'Battosai1806', id: 143764700 }, repository: { id: 1377587215 }, head_repository: { id: 1377587215 },
  head_branch: 'main', event: 'workflow_run', status: 'in_progress', path: '.github/workflows/live-qa-release-and-check.yml', head_sha: 'a'.repeat(40) };
test('standing work needs verified B/A workflow provenance without A-only dated approval receipts', () => {
  expect(assertStandingRun('gh-12345-1', run)).toBe(true);
  expect(assertStandingRun('gh-12345-1', { ...run, actor: { login: 'martelaxe', id: 44531296 }, triggering_actor: { login: 'martelaxe', id: 44531296 } })).toBe(true);
  for (const value of [{ ...run, head_branch: 'other' }, { ...run, actor: { ...run.actor, id: 44531296 } },
    { ...run, triggering_actor: { login: 'martelaxe', id: 44531296 } }, { ...run, repository: { id: 1 } },
    { ...run, path: '.github/workflows/approve-live-qa-runs.yml' }, { ...run, run_attempt: 2 }, { ...run, status: 'completed' }])
    expect(() => assertStandingRun('gh-12345-1', value)).toThrow('STANDING_RUN_PROVENANCE_UNVERIFIED');
});
