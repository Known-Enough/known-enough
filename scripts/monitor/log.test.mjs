import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyObservation, latestLegacyTime, renderRecord, validateReceipt } from './log.mjs';

const now = Date.parse('2026-10-04T23:30:00Z');
const input = { event: 'finished', result: 'failed', task: 'ASSESS07', scheduled_at: '2026-10-04T23:11:08.572Z', source_sha: 'a'.repeat(40), chat_summary: 'The decision test failed. I will investigate the missing confirmation.' };
const receipt = { ...validateReceipt(input, 143764700), observedAt: '2026-10-04T23:25:00Z', runUrl: 'https://github.com/Known-Enough/known-enough/actions/runs/123' };

test('B identity is required; A cannot impersonate the worker', () => {
  assert.throws(() => validateReceipt(input, 44531296), /B_IDENTITY_REQUIRED/);
});
test('finished reply summary and actual failed outcome survive validation', () => {
  assert.equal(receipt.chatSummary, input.chat_summary);
  assert.equal(receipt.chatSummarySource, 'agent-published-answer-summary');
  assert.equal(receipt.result, 'failed');
});
test('unfinished lifecycle cannot be reported as completed', () => {
  assert.throws(() => validateReceipt({ ...input, event: 'started' }, 143764700), /INVALID_WORKING_STATE/);
  assert.throws(() => validateReceipt({ ...input, result: 'working' }, 143764700), /INVALID_FINISHED_STATE/);
});
test('sensitive credentials, addresses and active markup are rejected', () => {
  for (const chat_summary of ['Bearer privateValue', 'email person@example.com', 'password=unsafeValue', 'secret: unsafeValue', '<script>alert(1)</script>', 'https://example.com/?token=value']) {
    assert.throws(() => validateReceipt({ ...input, chat_summary }, 143764700), /PRIVATE_OR_UNSAFE_SUMMARY/);
  }
});
test('summary is bounded and control characters are rejected', () => {
  for (const chat_summary of ['', 'a'.repeat(801), 'text\nsecond line']) assert.throws(() => validateReceipt({ ...input, chat_summary }, 143764700), /INVALID_CHAT_SUMMARY/);
});
test('legacy heading is historical evidence, not a new worker receipt', () => {
  const time = latestLegacyTime('## Scheduled run 001 — 2026-10-04T19:40:35.442Z\n\n## Scheduled run 005 — 2026-10-04T21:41:08.572Z\n');
  const state = classifyObservation(null, time, now);
  assert.equal(state.latestReportAt, '2026-10-04T21:41:08.572Z');
  assert.equal(state.state, 'NO_RECENT_REPORT');
  assert.equal(state.chatSummarySource, 'unavailable');
});
test('missing run still has an explicit answer-unavailable summary', () => {
  const state = classifyObservation(null, null, now);
  assert.equal(state.state, 'NO_RECENT_REPORT');
  assert.match(state.chatSummary, /No published chat answer/);
  assert.match(renderRecord({ ...state, event: 'inspect', observedAt: new Date(now).toISOString() }), /Short chat summary/);
});
test('started run without a finish ages into a reporting gap', () => {
  const recent = { ...receipt, event: 'started', result: 'working' };
  assert.equal(classifyObservation(recent, null, now).state, 'WORK_REPORTED');
  assert.equal(classifyObservation(recent, null, now + 46 * 60000).state, 'NO_RECENT_REPORT');
});
test('old replies stay visible but are explicitly historical', () => {
  const state = classifyObservation(receipt, null, now + 46 * 60000);
  assert.equal(state.summaryIsCurrent, false);
  assert.equal(state.chatSummary, input.chat_summary);
  assert.equal(state.state, 'NO_RECENT_REPORT');
});
test('a failed reported run is not converted into task PASS', () => {
  const state = classifyObservation(receipt, null, now);
  assert.equal(state.state, 'FINISHED_REPORTED');
  assert.equal(state.lastReportedResult, 'failed');
  assert.match(state.explanation, /not direct inspection/);
});
test('future receipt cannot imply fresh worker activity', () => {
  assert.equal(classifyObservation({ ...receipt, observedAt: '2026-10-05T23:00:00Z' }, null, now).state, 'NO_RECENT_REPORT');
});
test('renderer escapes formatting and mentions in agent text', () => {
  const text = renderRecord({ ...receipt, state: 'FINISHED_REPORTED', chatSummary: '[click](javascript:bad) @someone', summaryIsCurrent: true });
  assert.match(text, /\\@someone/);
  assert.match(text, /\\\[click/);
});

function runRecord(input, fakeGh, actorId = '44531296') {
  const folder = mkdtempSync(join(tmpdir(), 'monitor-log-test-'));
  try {
    mkdirSync(join(folder, 'docs'));
    writeFileSync(join(folder, 'docs/monitor-log.md'), '## Scheduled run 005 — 2026-10-04T21:41:08.572Z\n');
    writeFileSync(join(folder, 'event.json'), JSON.stringify({ inputs: input }));
    writeFileSync(join(folder, 'gh'), '#!/bin/sh\n' + fakeGh + '\n', { mode: 0o700 });
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('./log.mjs', import.meta.url)), 'record'], {
      cwd: folder, encoding: 'utf8',
      env: { ...process.env, PATH: folder + ':' + process.env.PATH, GITHUB_ACTOR_ID: actorId, GITHUB_REPOSITORY: 'Known-Enough/known-enough', GITHUB_REF: 'refs/heads/main', GITHUB_RUN_ID: '123', GITHUB_EVENT_PATH: join(folder, 'event.json'), GITHUB_STEP_SUMMARY: join(folder, 'step.md') },
    });
    return { child, record: JSON.parse(readFileSync(join(folder, 'monitor-result/record.json'), 'utf8')), summary: readFileSync(join(folder, 'step.md'), 'utf8') };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
test('API failure preserves a fallback artifact and chat-unavailable summary', () => {
  const { child, record, summary } = runRecord({ event: 'inspect' }, 'exit 1');
  assert.equal(child.status, 1);
  assert.equal(record.state, 'LOGGER_ERROR');
  assert.match(record.explanation, /OBSERVATION_OR_PUBLICATION_FAILED/);
  assert.match(summary, /No published chat answer/);
});
test('independent check records absence even when B never started', () => {
  const { child, record, summary } = runRecord({ event: 'inspect' }, 'printf \'%s\' \'{"workflow_runs":[]}\'');
  assert.equal(child.status, 0);
  assert.equal(record.state, 'NO_RECENT_REPORT');
  assert.match(summary, /Short chat summary/);
});
test('rejected private summary is not copied into artifacts or console', () => {
  const { child, record, summary } = runRecord({ ...input, chat_summary: 'password=private-canary' }, 'exit 1', '143764700');
  assert.equal(child.status, 1);
  assert.match(record.explanation, /PRIVATE_OR_UNSAFE_SUMMARY/);
  assert.doesNotMatch(summary + child.stdout + child.stderr, /private-canary/);
});
