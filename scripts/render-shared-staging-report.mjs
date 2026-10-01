import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const manifest = JSON.parse(readFileSync(new URL('../tests/live/targets.json', import.meta.url), 'utf8'));
const awsPath = resolve(process.env.STAGING_INSPECTION_JSON ?? 'staging-inspection.json');
const playwrightPath = resolve(process.env.PLAYWRIGHT_RESULT_JSON ?? 'public-playwright.json');
const outputPath = resolve(process.env.SHARED_STAGING_REPORT_PATH ?? 'shared-staging-report.md');
const awsOutcome = process.env.AWS_INSPECTOR_OUTCOME ?? 'skipped';
const publicOutcome = process.env.PUBLIC_TEST_OUTCOME ?? 'skipped';
const runOnMain = process.env.RUN_ON_MAIN === 'true';
const githubUrl = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
const repository = process.env.GITHUB_REPOSITORY ?? 'Known-Enough/known-enough';
const runId = process.env.GITHUB_RUN_ID ?? 'unknown';
const runNumber = process.env.GITHUB_RUN_NUMBER ?? 'unknown';
const commit = process.env.GITHUB_SHA ?? 'unknown';
const actor = process.env.GITHUB_ACTOR ?? 'unknown';
const runUrl = `${githubUrl}/${repository}/actions/runs/${runId}`;

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function markdownCell(value) {
  return String(value ?? 'unknown').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function flattenSuites(suites, output = []) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      const test = spec.tests?.[0];
      const result = test?.results?.at(-1);
      let status = 'blocked';
      if (result?.status === 'passed') status = 'passed';
      else if (['failed', 'timedOut', 'interrupted'].includes(result?.status)) status = 'failed';
      else if (result?.status === 'skipped' || test?.status === 'skipped') status = 'blocked';
      else if (test?.status === 'expected' && test?.expectedStatus === 'passed') status = 'passed';
      output.push({ title: spec.title, status, file: spec.file });
    }
    flattenSuites(suite.suites, output);
  }
  return output;
}

function prettyStatus(status) {
  return ({ passed: 'PASS', failed: 'FAIL', blocked: 'BLOCKED' })[status] ?? 'BLOCKED';
}

const inventory = readJson(awsPath);
const playwright = readJson(playwrightPath);
const testResults = flattenSuites(playwright?.suites);
const targetIds = ['stage0-static-preview', 'amplify-connected-staging'];
const targetUrls = {
  'stage0-static-preview': 'https://d23eowhnwtqts3.cloudfront.net/',
  'amplify-connected-staging': 'https://main.d143q5ravxp5av.amplifyapp.com/',
};
const targetSummary = targetIds.map(id => {
  const results = testResults.filter(test => test.title.startsWith(`${id}:`));
  const passed = results.filter(test => test.status === 'passed').length;
  const failed = results.filter(test => test.status === 'failed').length;
  const blocked = results.filter(test => test.status === 'blocked').length;
  const status = results.length === 0 || blocked > 0 ? 'blocked' : failed > 0 ? 'failed' : 'passed';
  return { id, url: targetUrls[id], status, passed, failed, blocked, tests: results };
});
const passedTests = testResults.filter(test => test.status === 'passed').length;
const failedTests = testResults.filter(test => test.status === 'failed').length;
const blockedTests = testResults.filter(test => test.status === 'blocked').length;
const harnessTests = testResults.filter(test => !targetIds.some(id => test.title.startsWith(`${id}:`)));
const testSuiteStatus = !runOnMain || publicOutcome !== 'success' || testResults.length !== 10
  ? (failedTests > 0 || publicOutcome === 'failure' ? 'failed' : 'blocked')
  : failedTests > 0 || blockedTests > 0 ? 'failed' : 'passed';

const inspectionReadStatus = !runOnMain || awsOutcome !== 'success' || inventory?.collection?.status !== 'passed'
  ? 'failed'
  : 'passed';
const reportStatus = testSuiteStatus === 'passed' && inspectionReadStatus === 'passed' ? 'passed' : 'failed';

const lines = [
  '# Shared staging check report',
  '',
  `**Execution:** ${prettyStatus(reportStatus)} · **Run:** [#${markdownCell(runNumber)}](${runUrl}) · **Commit:** [${markdownCell(commit.slice(0, 12))}](${githubUrl}/${repository}/commit/${commit}) · **Triggered by:** @${markdownCell(actor)}`,
  '',
  `Observed at ${new Date().toISOString()}. The AWS job used the GitHub OIDC staging-inspector role from this main-branch run; it did not use a developer AWS profile.`,
  '',
  '## Public website checks',
  '',
  `**${prettyStatus(testSuiteStatus)}:** ${passedTests} passed, ${failedTests} failed, ${blockedTests} blocked of 10 expected checks. The suite only loads public pages/assets and performs the existing unauthenticated API denial probe.`,
  '',
  '| Target | Availability and pinned assets | Checks |',
  '| --- | --- | --- |',
  ...targetSummary.map(target => `| ${target.id} ([site](${target.url})) | ${prettyStatus(target.status)} | ${target.passed} passed, ${target.failed} failed, ${target.blocked} blocked |`),
  '',
  '### Manifest and harness checks',
  '',
  ...(harnessTests.length
    ? harnessTests.map(test => `- ${prettyStatus(test.status)} — ${markdownCell(test.title)}`)
    : ['- BLOCKED — the manifest validation result was not collected.']),
  '',
  ...manifest.targets.map(target => `- **${target.id} manifest version:** source commit \`${target.frontend.sourceCommit}\`, last recorded ${target.frontend.lastVerifiedAt}.`),
  '',
  ...targetSummary.flatMap(target => [
    `### ${target.id} checks`,
    '',
    ...(target.tests.length
      ? target.tests.map(test => `- ${prettyStatus(test.status)} — ${markdownCell(test.title)}`)
      : ['- BLOCKED — no Playwright result was collected for this target.']),
    '',
  ]),
  '## Deployed versions and AWS inspection',
  '',
  `**AWS metadata collection:** ${prettyStatus(inspectionReadStatus)}. ${inventory?.identity ? `Verified account ${inventory.identity.account}, role ${inventory.identity.role}.` : 'The dedicated GitHub AWS identity was not verified.'}`,
  '',
];

if (inventory?.amplify?.latestSuccessfulJob) {
  const job = inventory.amplify.latestSuccessfulJob;
  lines.push(`- **Amplify main:** successful job ${markdownCell(job.JobId)}; reported source commit ${job.CommitId || 'not supplied for this manual artifact deployment'}; public content is checked against the manifest hashes above.`);
} else {
  lines.push('- **Amplify main:** latest successful job metadata was not available.');
}

if (inventory?.lambda) {
  lines.push(`- **Lambda ${inventory.lambda.functionName}:** ${inventory.lambda.state}/${inventory.lambda.lastUpdateStatus}, ${inventory.lambda.runtime}, SHA-256 \`${inventory.lambda.codeSha256Hex}\`; manifest SHA-256 \`${inventory.lambda.manifestCodeSha256}\`; deployed source commit remains ${inventory.lambda.sourceCommit ?? 'unknown'}.`);
  lines.push(`- **Model guard readback:** mode \`${inventory.lambda.modelMode ?? 'unavailable'}\`, paid calls approved \`${inventory.lambda.paidCallsApproved ?? 'unavailable'}\`, inline Nova Lite grant ${inventory.lambda.runtimeInlineBedrockGrant === true ? 'present' : 'not found'}.`);
} else {
  lines.push('- **Lambda:** metadata was not collected.');
}

if (inventory?.observedAt) lines.push(`- **AWS readback time:** ${markdownCell(inventory.observedAt)}.`);

if (inventory?.api) {
  const routes = inventory.api.routes ?? [];
  lines.push(`- **API Gateway ${inventory.api.apiId}:** ${routes.length} routes observed: ${routes.map(route => `\`${route.routeKey}\` (${route.authorizationType})`).join(', ') || 'none'}.`);
}

if (inventory?.tables) {
  const group = inventory.tables.group;
  lines.push(`- **Existing decision table:** ${inventory.tables.existing?.exists ? `${inventory.tables.existing.name} (${inventory.tables.existing.TableStatus})` : 'missing'}.`);
  lines.push(`- **Required group table:** ${group?.exists ? `${group.name} (${group.TableStatus})` : `${group?.name ?? 'KnownEnoughGroupsStage'} is missing`}.`);
}

if (inventory?.cognito) {
  const pool = inventory.cognito.pool;
  const participant = inventory.cognito.participantClient;
  const display = inventory.cognito.displayClient;
  lines.push(`- **Cognito ${pool.id}:** self-signup admin-only=${pool.allowAdminCreateUserOnly}; auto-verified attributes=${(pool.autoVerifiedAttributes ?? []).join(', ') || 'none'}; sender=${pool.emailSendingAccount ?? 'unavailable'}.`);
  lines.push(`- **Participant client:** scopes ${(participant?.allowedOAuthScopes ?? []).join(', ') || 'none'}; code flow ${(participant?.allowedOAuthFlows ?? []).includes('code') ? 'enabled' : 'not enabled'}; client secret ${participant?.hasClientSecret === true ? 'present' : 'absent'}.`);
  lines.push(`- **Display client:** scopes ${(display?.allowedOAuthScopes ?? []).join(', ') || 'none'}; code flow ${(display?.allowedOAuthFlows ?? []).includes('code') ? 'enabled' : 'not enabled'}; client secret ${display?.hasClientSecret === true ? 'present' : 'absent'}.`);
}

const blockedChecks = (inventory?.checks ?? []).filter(check => check.status === 'blocked');
const failedChecks = (inventory?.checks ?? []).filter(check => check.status === 'failed');
lines.push('', '## Check results', '', '| Check | Status | Observation |', '| --- | --- | --- |');
for (const check of inventory?.checks ?? []) {
  lines.push(`| ${markdownCell(check.name)} | ${prettyStatus(check.status)} | ${markdownCell(check.detail)} |`);
}
if (!inventory?.checks?.length) lines.push('| AWS inspection | BLOCKED | No AWS inspection artifact was collected. |');

lines.push('', '## Missing features and blocked work', '');
if (inspectionReadStatus !== 'passed') {
  lines.push('- AWS feature readiness could not be checked because metadata collection failed. Missing observations are not proof that features are ready.');
}
if (blockedChecks.length) {
  for (const check of blockedChecks) lines.push(`- **${markdownCell(check.name)}:** ${markdownCell(check.detail)}`);
} else if (inspectionReadStatus === 'passed') {
  lines.push('- No AWS feature checks are blocked in this observation.');
}
if (failedChecks.length) {
  lines.push('', '## Failed AWS checks', '');
  for (const check of failedChecks) lines.push(`- **${markdownCell(check.name)}:** ${markdownCell(check.detail)}`);
}

lines.push(
  '',
  '## Scope',
  '',
  '- No authenticated participant account, group record, Cognito signup, email, Lambda invocation, deployment, or paid model request was used.',
  '- This workflow has only staging metadata read permissions. NP05 deployment permissions and signup/email and paid-model budgets remain separate.',
  '- This run is successful when the public suite passes and the GitHub OIDC inventory is collected. Blocked product operations remain visible above and do not count as executed or accepted.',
  '',
);

const report = `${lines.join('\n')}\n`;
writeFileSync(outputPath, report, { mode: 0o600 });
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, report);
process.stdout.write(`SHARED_STAGING_REPORT=${prettyStatus(reportStatus)}; public=${prettyStatus(testSuiteStatus)}; aws=${prettyStatus(inspectionReadStatus)}; blocked_features=${blockedChecks.length}; report=${outputPath}\n`);
if (reportStatus !== 'passed') process.exitCode = 1;
