import { collectGatewayThrottle } from './gateway-diagnostics.mjs';
import { modelFailuresFromLogs, safeModelFailures } from './model-failure-diagnostics.mjs';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { aws } from './aws.mjs';
import { requireRunId } from './config.mjs';
import { validateTarget, validateReceipt, validateWorkload, qualificationReport } from './runner-core.mjs';
export function invokeBroker(target, runId, action, extra = {}, execute = spawnSync) {
    requireRunId(runId);
    const directory = mkdtempSync(resolve(tmpdir(), 'ke-qa-invoke-'));
    try {
        const file = directory + '/result.json';
        const r = execute('aws', [
            'lambda', 'invoke', '--function-name', target.BrokerFunction, '--region', 'us-east-1', '--payload', Buffer.from(JSON.stringify({ runId, action, ...extra })).toString('base64'), file, '--output', 'json', '--no-cli-pager', '--cli-connect-timeout', '10', '--cli-read-timeout', '210'
        ], { encoding: 'utf8', timeout: 225000, env: { ...process.env, AWS_MAX_ATTEMPTS: '1', AWS_PAGER: '' } });
        if (r.status !== 0 || r.signal || r.error || JSON.parse(r.stdout).FunctionError)
            throw new Error('QA_BROKER_UNAVAILABLE');
        const data = JSON.parse(readFileSync(file, 'utf8'));
        if (data.status !== 'PASS' && data.status !== 'WAITING')
            throw new Error('QA_FIXTURE_OR_BUDGET_BLOCKED');
        return data;
    }
    finally {
        rmSync(directory, { recursive: true, force: true });
    }
}
function collectLogPrivacy(startedAt) {
    let next;
    let total = 0;
    const failures=[];
    do {
        const logs = aws('logs', 'filter-log-events', { logGroupName: '/aws/lambda/known-enough-qa-api', startTime: startedAt, limit: 1000, ...(next ? { nextToken: next } : {}) });
        if ((logs.events ?? []).some(e => /QA_PRIVATE_CANARY_|Bearer [a-zA-Z0-9_.-]+|Qa7!/.test(e.message ?? '')))
            throw new Error('QA_LOG_PRIVACY_FAILURE');
        failures.push(...modelFailuresFromLogs(logs.events));
        total += (logs.events ?? []).length;
        next = logs.nextToken;
        if (total > 10000)
            throw new Error('QA_LOG_WINDOW_INCOMPLETE');
    } while (next);
    return {privacy:'PASS',modelFailures:safeModelFailures(failures)};
}
async function play(env) {
    return new Promise(resolveDone => {
        const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config=playwright.live-qa.config.ts'], { env: { ...process.env, ...env }, stdio: 'ignore' });
        child.on('close', (code, signal) => resolveDone({ code, signal }));
        child.on('error', () => resolveDone({ code: null, signal: null }));
    });
}
export async function runQualification(targetFile, receiptFile, runId, output) {
    requireRunId(runId);
    const directory = mkdtempSync(resolve(tmpdir(), 'ke-qa-run-'));
    const startedAt = Date.now();
    const state = { runId, preflight: 'BLOCKED', fixtures: 'BLOCKED', cleanup: 'BLOCKED', tests: [], sourceCommit: null };
    let target;
    try {
        target = validateTarget(JSON.parse(readFileSync(targetFile, 'utf8')));
        const sourceCommit = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
        const receipt = validateReceipt(target, JSON.parse(readFileSync(receiptFile, 'utf8')), sourceCommit);
        state.sourceCommit = receipt.sourceCommit;
        validateWorkload(aws('sts', 'get-caller-identity'), process.env.AWS_PROFILE);
        const deployed = aws('lambda', 'get-function-configuration', { FunctionName: target.ApiFunction });
        if (deployed.State !== 'Active' || deployed.LastUpdateStatus !== 'Successful' || deployed.CodeSha256 !== Buffer.from(receipt.artifacts.api.sha256, 'hex').toString('base64') || deployed.Environment?.Variables?.NP_GROUP_TABLE_NAME !== target.GroupTable || deployed.Environment?.Variables?.COGNITO_USER_POOL_ID !== target.PoolId)
            throw new Error('QA_RELEASE_READBACK_MISMATCH');
        state.preflight = 'PASS';
        const migration = invokeBroker(target, runId, 'migrate-standing');
        if (migration.authorizationMode !== 'standing' || migration.usagePreserved !== true)
            throw new Error('STANDING_MIGRATION_READBACK_FAILED');
        invokeBroker(target, runId, 'start');
        state.fixtures = 'PASS';
        const secrets = aws('secretsmanager', 'get-secret-value', { SecretId: target.LoginSecret });
        const login = JSON.parse(secrets.SecretString);
        if (login.runId !== runId || login.users?.length !== 10)
            throw new Error('QA_LOGIN_MANIFEST_MISMATCH');
        writeFileSync(directory + '/login.json', JSON.stringify(login), { mode: 0o600 });
        const testsFile = directory + '/tests.json';
        const processResult = await play({
            QA_TARGET_FILE: resolve(targetFile), QA_LOGIN_FILE: directory + '/login.json', QA_RUN_ID: runId, QA_RESULTS_FILE: testsFile, QA_PRIVATE_OUTPUT: directory + '/browser'
        });
        state.processExitCode = processResult.code;
        state.processSignal = processResult.signal;
        try {
            const results = JSON.parse(readFileSync(testsFile, 'utf8'));
            state.tests = results.tests;
            state.reportStatus = results.status;
            state.globalErrors = results.globalErrors;
            state.failedTests = results.failedTests;
        }
        catch { /* Missing tests remain blocked. */
        }
        const stats = invokeBroker(target, runId, 'stats');
        state.attempts = stats.attempts;
        state.signupMessages = stats.signupMessages;
    }
    catch { /* Static classification only: never publish AWS diagnostics, owner values or credentials. */
    }
    finally {
        if (target && state.preflight === 'PASS') {
            try {
                const result = invokeBroker(target, runId, 'cleanup');
                state.cleanup = result.cleanup;
                const privacy=collectLogPrivacy(startedAt);
                state.privacy = privacy.privacy;
                state.modelFailures = privacy.modelFailures;
            }
            catch { /* Cleanup failure blocks qualification and the next lease. */
            }
        }
        rmSync(directory, { recursive: true, force: true });
    }
    if (target && state.preflight === 'PASS') state.gatewayThrottle = collectGatewayThrottle(target, aws);
    const report = qualificationReport(state);
    writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    return report;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        const report = await runQualification(process.argv[2], process.argv[3], process.argv[4], process.argv[5]);
        console.log(JSON.stringify({ status: report.status, lanes: report.lanes, counts: report.counts }));
        if (report.status !== 'PASS')
            process.exitCode = 1;
    }
    catch {
        console.error('QA_RUN_BLOCKED');
        process.exitCode = 1;
    }
}
