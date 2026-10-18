import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { checkedExpiry, checkedExpiryCommit } from './jobs-expiry-recovery.mjs';
import { JOB_TARGET } from '../../packages/adapters/src/dynamo-model-jobs.ts';
const runtimeSource = 'a'.repeat(40), decisionId = 'owned-synthetic';
const expected = { runtimeSource, ownedHashes: [createHash('sha256').update(decisionId).digest('hex')] };
const control = { enabled: true, sourceSha: runtimeSource, slots: [], active: ['job'] };
const job = { reference: { jobId: 'job', decisionId, kind: 'NEGOTIATION', sourceSha: runtimeSource, expiresAt: 100, reasoningJobId: 'reasoning' },
  phase: 'READY', attempts: 0, failures: 0, lease: null, usage: null, reservedTokens: 0, reservedCostMicros: 0 };
test('accepts only positively owned expired uncalled work', () => {
  assert.doesNotThrow(() => checkedExpiry(control, job, expected, 100));
  for (const changed of [{ phase: 'CALLING' }, { attempts: 1 }, { failures: 1 }, { reservedTokens: 1 }, { reservedCostMicros: 1 }, { usage: {} }, { lease: {} },
    { reference: { ...job.reference, expiresAt: 101 } }, { reference: { ...job.reference, decisionId: 'other' } }, { reference: { ...job.reference, sourceSha: 'b'.repeat(40) } }]) {
    assert.throws(() => checkedExpiry(control, { ...job, ...changed }, expected, 100));
  }
  assert.throws(() => checkedExpiry({ ...control, slots: [{}] }, job, expected, 100));
  assert.throws(() => checkedExpiry({ ...control, enabled: false }, job, expected, 100));
});
test('requires joined native cancellation preserving answers, confirmations and cumulative usage', () => {
  const old = { job: { id: 'reasoning' }, owners: [{ privateAnswer: 'private-canary' }], frameConfirmations: ['confirmed'], solveEpoch: 1, controlVersion: 4 };
  const record = { ...old, job: null, status: 'READY', solveEpoch: 2, controlVersion: 5 };
  const prior = { control, job, totals: { reservedTokens: 55 } };
  const next = { control: { ...control, active: [] }, job: { ...job, phase: 'DEAD', reason: 'EXPIRED' }, totals: prior.totals };
  const fence = { pins: [{ table: JOB_TARGET.decisions, payload: JSON.stringify({ record: old }) }] };
  const effect = { writes: [{ key: { PK: 'ROOM#' + decisionId, SK: 'STATE' }, payload: JSON.stringify({ record }) }] };
  assert.doesNotThrow(() => checkedExpiryCommit(prior, next, fence, effect, expected, 100));
  assert.throws(() => checkedExpiryCommit(prior, next, undefined, undefined, expected, 100));
  assert.throws(() => checkedExpiryCommit(prior, { ...next, totals: { reservedTokens: 0 } }, fence, effect, expected, 100));
  const changed = structuredClone(effect); changed.writes[0].payload = JSON.stringify({ record: { ...record, owners: [] } });
  assert.throws(() => checkedExpiryCommit(prior, next, fence, changed, expected, 100));
});
