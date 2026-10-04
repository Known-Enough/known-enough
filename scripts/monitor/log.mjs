import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = 'Known-Enough/known-enough';
const WORKFLOW = 'b-monitor-log.yml';
const B_ID = 143764700;
const AGE_LIMIT_MS = 45 * 60 * 1000;
const EVENTS = ['started', 'progress', 'finished'];
const RESULTS = ['working', 'completed', 'blocked', 'failed'];
const NO_ANSWER = 'No published chat answer is available. Current worker activity and the reason for the missing report are unknown.';

export function validateReceipt(value, actorId) {
  if (Number(actorId) !== B_ID) throw new Error('B_IDENTITY_REQUIRED');
  if (!value || !EVENTS.includes(value.event) || !RESULTS.includes(value.result)) throw new Error('INVALID_LIFECYCLE');
  if (!/^[A-Z]+\d{2}$/.test(value.task)) throw new Error('INVALID_TASK');
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value.scheduled_at) || !Number.isFinite(Date.parse(value.scheduled_at))) throw new Error('INVALID_SCHEDULED_TIME');
  if (!/^[0-9a-f]{40}$/.test(value.source_sha) || /^0+$/.test(value.source_sha)) throw new Error('INVALID_SOURCE');
  if (value.event !== 'finished' && value.result !== 'working') throw new Error('INVALID_WORKING_STATE');
  if (value.event === 'finished' && value.result === 'working') throw new Error('INVALID_FINISHED_STATE');
  const summary = value.chat_summary;
  if (typeof summary !== 'string' || summary.length < 8 || summary.length > 800 || [...summary].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new Error('INVALID_CHAT_SUMMARY');
  if (/Bearer\s|(?:ghp_|github_pat_|AKIA)[A-Za-z0-9]|-----BEGIN|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:password|secret|token)\s*[:=]|<\/?[A-Za-z]|https?:\/\/\S+\?/i.test(summary)) throw new Error('PRIVATE_OR_UNSAFE_SUMMARY');
  return { event: value.event, result: value.result, task: value.task, scheduledAt: value.scheduled_at, sourceSha: value.source_sha, chatSummary: summary, chatSummarySource: value.event === 'finished' ? 'agent-published-answer-summary' : 'agent-published-progress' };
}

export function latestLegacyTime(markdown) {
  const values = [...markdown.matchAll(/^## Scheduled run \d+ — (\S+)/gm)].map(match => match[1]).filter(value => Number.isFinite(Date.parse(value)));
  return values.at(-1) ?? null;
}

export function classifyObservation(receipt, legacyTime, now) {
  const lastTime = receipt?.observedAt ?? legacyTime;
  const age = lastTime ? now - Date.parse(lastTime) : Infinity;
  const fresh = Number.isFinite(age) && age >= -300000 && age <= AGE_LIMIT_MS;
  return {
    state: fresh && receipt ? (receipt.event === 'finished' ? 'FINISHED_REPORTED' : 'WORK_REPORTED') : 'NO_RECENT_REPORT',
    latestReportAt: lastTime ?? null,
    lastReportedResult: receipt?.result ?? null,
    task: receipt?.task ?? null,
    chatSummary: receipt?.chatSummary ?? NO_ANSWER,
    chatSummarySource: receipt?.chatSummarySource ?? 'unavailable',
    summaryIsCurrent: Boolean(fresh && receipt),
    receiptRunUrl: receipt?.runUrl ?? null,
    explanation: fresh && receipt
      ? 'This is an agent-published report, not direct inspection of the Codex chat or proof that the task passed.'
      : 'No lifecycle report was published within 45 minutes. This detects a reporting gap; it does not establish that the worker stopped or why.',
  };
}

function quoteMarkdown(value) {
  return String(value).replace(/[\\`*_{}[\]()<>#|!@]/g, '\\$&').replace(/[\r\n]+/g, ' ');
}

export function renderRecord(record) {
  return [
    '# B monitor log',
    '',
    '**Status:** ' + record.state,
    '',
    'Recorded at: ' + record.observedAt + ' (UTC).',
    'Event: ' + record.event + '.',
    'Latest worker report: ' + (record.latestReportAt ?? 'unavailable') + '.',
    'Task: ' + (record.task ?? 'unknown') + '.',
    'Last reported outcome: ' + (record.lastReportedResult ?? record.result ?? 'unknown') + '.',
    '',
    '**Short chat summary:** ' + quoteMarkdown(record.chatSummary ?? NO_ANSWER),
    '',
    'Summary source: ' + (record.chatSummarySource ?? 'unavailable') + '.',
    'Current summary: ' + (record.summaryIsCurrent ? 'yes' : 'no; absent or historical') + '.',
    '',
    quoteMarkdown(record.explanation ?? 'Lifecycle event received from the verified B GitHub account.'),
    '',
    ...(record.receiptRunUrl ? ['[Worker report](' + record.receiptRunUrl + ')', ''] : []),
    'No AWS credentials, AI calls, emails, deployments or test dispatch are used by this logging workflow.',
    '',
  ].join('\n');
}

function ghJson(args) {
  return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024 }));
}

function latestReceipt() {
  const data = ghJson(['api', 'repos/' + REPO + '/actions/workflows/' + WORKFLOW + '/runs?per_page=100']);
  const candidates = data.workflow_runs.filter(run => run.actor?.id === B_ID && run.head_branch === 'main' && run.event === 'workflow_dispatch' && run.status === 'completed' && run.conclusion === 'success' && EVENTS.some(event => run.display_title === 'B monitor: ' + event)).slice(0, 6);
  for (const run of candidates) {
    const folder = mkdtempSync(join(tmpdir(), 'b-monitor-receipt-'));
    try {
      execFileSync('gh', ['run', 'download', String(run.id), '--repo', REPO, '--name', 'b-monitor-record', '--dir', folder], { timeout: 20000, stdio: ['pipe', 'pipe', 'pipe'] });
      const value = JSON.parse(readFileSync(join(folder, 'record.json'), 'utf8'));
      if (value.schemaVersion !== 1 || value.actorId !== B_ID || value.runUrl !== run.html_url || !Number.isFinite(Date.parse(value.observedAt))) throw new Error('INVALID_STORED_RECEIPT');
      validateReceipt({ event: value.event, result: value.result, task: value.task, scheduled_at: value.scheduledAt, source_sha: value.sourceSha, chat_summary: value.chatSummary }, value.actorId);
      return value;
    } catch {
      // Old/expired artifacts are unavailable evidence, never a fabricated PASS.
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }
  return null;
}

function save(record) {
  mkdirSync('monitor-result', { recursive: true });
  writeFileSync('monitor-result/record.json', JSON.stringify(record, null, 2) + '\n');
  writeFileSync('monitor-result/summary.md', renderRecord(record));
}

function recordWorkflow() {
  const now = new Date();
  const base = { schemaVersion: 1, event: 'inspect', state: 'LOGGER_ERROR', observedAt: now.toISOString(), actorId: Number(process.env.GITHUB_ACTOR_ID), runUrl: 'https://github.com/' + REPO + '/actions/runs/' + process.env.GITHUB_RUN_ID, chatSummary: NO_ANSWER, chatSummarySource: 'unavailable', summaryIsCurrent: false };
  save(base); // Write a fallback BEFORE any API, parsing or observation can fail.
  try {
    if (process.env.GITHUB_REPOSITORY !== REPO || process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('WRONG_REPOSITORY_OR_BRANCH');
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const input = event.inputs ?? {};
    let record;
    if (!input.event || input.event === 'inspect') {
      const legacy = latestLegacyTime(readFileSync('docs/monitor-log.md', 'utf8'));
      record = { ...base, ...classifyObservation(latestReceipt(), legacy, now.getTime()), legacyReportAt: legacy };
    } else {
      const receipt = validateReceipt(input, process.env.GITHUB_ACTOR_ID);
      if (Date.parse(receipt.scheduledAt) > now.getTime() + 300000) throw new Error('FUTURE_SCHEDULED_TIME');
      record = { ...base, ...receipt, state: receipt.event === 'finished' ? 'FINISHED_REPORTED' : 'WORK_REPORTED', summaryIsCurrent: true, latestReportAt: now.toISOString() };
    }
    save(record);
    console.log(JSON.stringify({ status: record.state, runUrl: record.runUrl, chatSummarySource: record.chatSummarySource }));
  } catch (error) {
    const safe = /^[A-Z_]+$/.test(error.message) ? error.message : 'OBSERVATION_OR_PUBLICATION_FAILED';
    save({ ...base, explanation: safe + '. The GitHub job and fallback artifact record the logging failure; no worker answer is invented.' });
    process.exitCode = 1;
  } finally {
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, readFileSync('monitor-result/summary.md'));
  }
}

function publishReceipt(args) {
  const [event, path] = args;
  if (!EVENTS.includes(event) || !path) throw new Error('USAGE_PUBLISH_EVENT_JSON_FILE');
  const actor = ghJson(['api', 'user']);
  const value = { ...JSON.parse(readFileSync(path, 'utf8')), event };
  validateReceipt(value, actor.id);
  execFileSync('gh', ['workflow', 'run', WORKFLOW, '--repo', REPO, '--ref', 'main', '--json'], { input: JSON.stringify(value), timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'] });
  console.log('Log publication requested. Verify its GitHub run before claiming publication succeeded.');
  console.log('CHAT_SUMMARY=' + value.chat_summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === 'record') recordWorkflow();
  else if (process.argv[2] === 'publish') {
    try {
      publishReceipt(process.argv.slice(3));
    } catch (error) {
      console.error(/^[A-Z_]+$/.test(error.message) ? error.message : 'LOG_PUBLICATION_FAILED');
      process.exitCode = 1;
    }
  }
  else {
    console.error('Usage: node scripts/monitor/log.mjs record | publish started|progress|finished private-summary.json');
    process.exitCode = 1;
  }
}
