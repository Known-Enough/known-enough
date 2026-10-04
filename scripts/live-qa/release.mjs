import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { digest, authorizationActive } from './config.mjs';
import { aws, assertIdentity, SAFE_AWS_ERROR_CODES } from './aws.mjs';
import { buildPackage } from './package.mjs';
import { webArtifact, publishWeb } from './install.mjs';
import { validateTarget } from './runner-core.mjs';
export const PRIMARY = {
    Account: '092954139775', Region: 'us-east-1', ApiUrl: 'https://u94iyvt6p9.execute-api.us-east-1.amazonaws.com', FrontendUrl: 'https://main.d143q5ravxp5av.amplifyapp.com/', PoolId: 'us-east-1_V9OMjd0zx', CognitoDomain: 'https://known-enough-092954139775.auth.us-east-1.amazoncognito.com', ParticipantClientId: '3accf7paalvon2m8ue8okfi853', DisplayClientId: '481ru24906sv26f30i569gq8g0', AmplifyAppId: 'd143q5ravxp5av'
};
const delay = ms => new Promise(r => globalThis.setTimeout(r, ms));
/** Publish only known operation codes and public main-branch Amplify identifiers. */
export function releaseFailure(error) {
    const seen = new Set();
    let failure = { code: 'QA_RELEASE_BLOCKED_OR_FAILED' };
    const guards = new Set(['QA_RELEASE_FAILED', 'PRIMARY_CODE_RELEASE_FAILED',
        'AWS_CLI_PROCESS_LAUNCH_FAILED', 'INVALID_AWS_RESPONSE', 'BUILT_ARTIFACT_BYTES_CHANGED',
        'WEB_BYTES_CHANGED', 'QA_NOT_READY_FOR_RELEASE', 'QA_CODE_UPDATE_FAILED',
        'QA_CODE_READBACK_MISMATCH', 'QA_CODE_UPDATE_TIMEOUT', 'QA_ROLLBACK_DRIFT',
        'INSTALLED_PUBLICATION_ENVELOPE_EXPIRED', 'QA_TARGET_LEASE_OR_CLEANUP_BLOCKED']);
    while (error && !seen.has(error) && seen.size < 8) {
        seen.add(error);
        const operation = /^AWS_OPERATION_FAILED:(sts:get-caller-identity|dynamodb:get-item|s3api:put-object|lambda:(?:get-function-configuration|update-function-code)|amplify:(?:create-deployment|start-deployment|get-job))$/.test(error.message ?? '');
        if (operation || guards.has(error.message)) {
            failure = { code: error.message };
            if (operation && SAFE_AWS_ERROR_CODES.has(error.awsCode)) failure.awsCode = error.awsCode;
            if (operation && error.message.startsWith('AWS_OPERATION_FAILED:amplify:') && ['AccessDenied', 'AccessDeniedException'].includes(error.awsCode) && /^arn:aws:amplify:us-east-1:092954139775:apps\/[a-z0-9]+\/branches\/main(?:\/(?:deployments|jobs)\/[A-Za-z0-9_*-]+)?$/.test(error.deniedResource ?? '')) failure.deniedResource = error.deniedResource;
        }
        error = error.cause;
    }
    return failure;
}
export function sourceHead() {
    const r = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
    if (r.status || !/^[a-f0-9]{40}$/.test(r.stdout.trim()))
        throw new Error('SOURCE_UNAVAILABLE');
    return r.stdout.trim();
}
export function webFiles() {
    const files = [];
    const root = resolve('apps/web/dist');
    const walk = path => {
        for (const entry of readdirSync(path, { withFileTypes: true })) {
            const p = resolve(path, entry.name);
            if (entry.isDirectory())
                walk(p);
            else
                files.push({ path: p.slice(root.length).replace('/index.html', '/'), sha256: digest(readFileSync(p)) });
        }
    };
    walk(root);
    return files.sort((a, b) => a.path.localeCompare(b.path));
}
export async function prepare(targetFile, directory, workflowRunId) {
    const target = validateTarget(JSON.parse(readFileSync(targetFile, 'utf8')));
    if (!/^\d+$/.test(workflowRunId) || !directory.startsWith('/tmp/'))
        throw new Error('INVALID_BUILD_CONTEXT');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const sourceCommit = sourceHead();
    const clean = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
    if (clean.status || clean.stdout.trim())
        throw new Error('CLEAN_IMMUTABLE_BUILD_REQUIRED');
    const packageManifest = await buildPackage(directory, sourceCommit);
    await webArtifact(PRIMARY, directory);
    const primaryFiles = webFiles();
    const webSha256 = await webArtifact(target, directory);
    const qaFiles = webFiles();
    const expected = {
        schemaVersion: 1, sourceCommit, workflowRunId, targetApi: target.ApiUrl, targetFrontend: target.FrontendUrl, artifacts: { ...packageManifest.artifacts, web: { sha256: webSha256 } }, webFiles: qaFiles, primary: { ...PRIMARY, files: primaryFiles, backendSha256: packageManifest.artifacts.api.sha256 }
    };
    writeFileSync(directory + '/expected.json', JSON.stringify(expected, null, 2) + '\n', { mode: 0o600 });
    writeFileSync(directory + '/target.json', JSON.stringify(target), { mode: 0o600 });
    return expected;
}
export function assertCleanLease(item) {
    if (item && JSON.parse(item.payload.S).status !== 'CLEAN')
        throw new Error('QA_TARGET_LEASE_OR_CLEANUP_BLOCKED');
}
async function ready(name, sha) {
    for (let i = 0; i < 90; i++) {
        const value = aws('lambda', 'get-function-configuration', { FunctionName: name });
        if (value.LastUpdateStatus === 'Failed')
            throw new Error('QA_CODE_UPDATE_FAILED');
        if (value.State === 'Active' && value.LastUpdateStatus === 'Successful') {
            if (value.CodeSha256 !== Buffer.from(sha, 'hex').toString('base64'))
                throw new Error('QA_CODE_READBACK_MISMATCH');
            return value.RevisionId;
        }
        await delay(1000);
    }
    throw new Error('QA_CODE_UPDATE_TIMEOUT');
}
export function assertInstalledEnvelope(value, now = Date.now()) {
    if (!authorizationActive(value, now))
        throw new Error('INSTALLED_PUBLICATION_ENVELOPE_EXPIRED');
}
function envelope(target) {
    const item = aws('dynamodb', 'get-item', { TableName: target.ControlTable, Key: { PK: { S: 'AUTH' }, SK: { S: 'STATE' } }, ConsistentRead: true }).Item;
    assertInstalledEnvelope(item ? JSON.parse(item.payload.S) : null);
    assertCleanLease(aws('dynamodb', 'get-item', { TableName: target.ControlTable, Key: { PK: { S: 'LEASE' }, SK: { S: 'STATE' } }, ConsistentRead: true }).Item);
}
export async function publish(directory) {
    const expected = JSON.parse(readFileSync(directory + '/expected.json', 'utf8'));
    const target = validateTarget(JSON.parse(readFileSync(directory + '/target.json', 'utf8')));
    if (sourceHead() !== expected.sourceCommit)
        throw new Error('EXPECTED_BUILD_SOURCE_CHANGED');
    const identity = aws('sts', 'get-caller-identity');
    assertIdentity(identity, { account: PRIMARY.Account });
    if (!identity.Arn.startsWith('arn:aws:sts::092954139775:assumed-role/KnownEnoughGithubQaRelease/'))
        throw new Error('QA_RELEASE_WORKLOAD_REQUIRED');
    envelope(target);
    const changes = [];
    const bucket = 'known-enough-qa-artifacts-092954139775';
    try {
        for (const name of ['api', 'broker']) {
            const body = readFileSync(directory + '/' + name + '.zip');
            if (digest(body) !== expected.artifacts[name].sha256)
                throw new Error('BUILT_ARTIFACT_BYTES_CHANGED');
            aws('s3api', 'put-object', {
                Bucket: bucket, Key: expected.artifacts[name].sha256 + '/' + name + '.zip', Body: directory + '/' + name + '.zip', ChecksumSHA256: Buffer.from(expected.artifacts[name].sha256, 'hex').toString('base64')
            });
        }
        for (const [functionName, artifact] of [
            [target.ApiFunction, 'api'], [target.BrokerFunction, 'broker'], ['known-enough-qa-pre-signup', 'broker'], ['known-enough-qa-custom-message', 'broker']
        ]) {
            const prior = aws('lambda', 'get-function-configuration', { FunctionName: functionName });
            if (prior.LastUpdateStatus !== 'Successful' || prior.State !== 'Active')
                throw new Error('QA_NOT_READY_FOR_RELEASE');
            const previousSha256 = Buffer.from(prior.CodeSha256, 'base64').toString('hex');
            if (previousSha256 === expected.artifacts[artifact].sha256)
                continue;
            const changed = aws('lambda', 'update-function-code', { FunctionName: functionName, RevisionId: prior.RevisionId, S3Bucket: bucket, S3Key: expected.artifacts[artifact].sha256 + '/' + artifact + '.zip' });
            const change = { functionName, artifact, previousSha256, revision: changed.RevisionId };
            changes.push(change);
            change.revision = await ready(functionName, expected.artifacts[artifact].sha256);
        }
        if (digest(readFileSync(directory + '/web.zip')) !== expected.artifacts.web.sha256)
            throw new Error('WEB_BYTES_CHANGED');
        const jobId = await publishWeb(aws, target, directory);
        const receipt = { ...expected, jobId };
        writeFileSync(directory + '/receipt.json', JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
        return { status: 'PUBLISHED', sourceCommit: expected.sourceCommit, jobId };
    }
    catch (error) {
        let rollback = 'PASS';
        for (const change of changes.reverse()) {
            try {
                const current = aws('lambda', 'get-function-configuration', { FunctionName: change.functionName });
                if (current.RevisionId !== change.revision)
                    throw new Error('QA_ROLLBACK_DRIFT', { cause: error });
                aws('lambda', 'update-function-code', { FunctionName: change.functionName, RevisionId: current.RevisionId, S3Bucket: bucket, S3Key: change.previousSha256 + '/' + change.artifact + '.zip' });
                await ready(change.functionName, change.previousSha256);
            }
            catch {
                rollback = 'BLOCKED';
            }
        }
        writeFileSync(directory + '/release-failure.json', JSON.stringify({ status: 'FAIL', rollback, frontend: 'INSPECT_OR_FORWARD_REPAIR_REQUIRED', failure: releaseFailure(error) }), { mode: 0o600 });
        throw new Error('QA_RELEASE_FAILED', { cause: error });
    }
}
export function primaryCodeGuard(current) {
    if (current.State !== 'Active' || current.LastUpdateStatus !== 'Successful' || current.Handler !== 'api.handler' || current.Environment?.Variables?.KE14_MODEL_MODE !== 'DISABLED' || current.Environment?.Variables?.KE14_PAID_CALLS_APPROVED !== 'false' || current.Environment?.Variables?.NP_GROUPS_ENABLED !== 'true' || current.Environment?.Variables?.NP_GROUP_TABLE_NAME !== 'KnownEnoughGroupsStage')
        throw new Error('PRIMARY_INITIAL_SETUP_OR_NP00_HOLD');
}
export async function publishPrimary(directory) {
    const expected = JSON.parse(readFileSync(directory + '/receipt.json', 'utf8'));
    const target = validateTarget(JSON.parse(readFileSync(directory + '/target.json', 'utf8')));
    if (sourceHead() !== expected.sourceCommit || target.PrimaryReleaseRoleArn !== 'arn:aws:iam::092954139775:role/KnownEnoughGithubPrimaryRelease')
        throw new Error('PRIMARY_ROLE_OR_SOURCE_NOT_INSTALLED');
    const identity = aws('sts', 'get-caller-identity');
    if (!identity.Arn?.startsWith('arn:aws:sts::092954139775:assumed-role/KnownEnoughGithubPrimaryRelease/'))
        throw new Error('PRIMARY_RELEASE_WORKLOAD_REQUIRED');
    envelope(target);
    const name = 'known-enough-stage-api', bucket = 'known-enough-qa-artifacts-092954139775';
    const current = aws('lambda', 'get-function-configuration', { FunctionName: name });
    primaryCodeGuard(current);
    const prior = Buffer.from(current.CodeSha256, 'base64').toString('hex');
    const expectedSha = expected.artifacts.api.sha256;
    let revision = current.RevisionId;
    try {
        if (prior !== expectedSha) {
            const changed = aws('lambda', 'update-function-code', { FunctionName: name, RevisionId: revision, S3Bucket: bucket, S3Key: expectedSha + '/api.zip' });
            revision = changed.RevisionId;
            revision = await ready(name, expectedSha);
        }
        const result = { status: 'PASS', sourceCommit: expected.sourceCommit, backendSha256: expectedSha };
        writeFileSync(directory + '/primary-release.json', JSON.stringify(result) + '\n', { mode: 0o600 });
        return result;
    }
    catch (error) {
        const observed = aws('lambda', 'get-function-configuration', { FunctionName: name });
        if (observed.RevisionId === revision && prior !== expectedSha) {
            aws('lambda', 'update-function-code', { FunctionName: name, RevisionId: revision, S3Bucket: bucket, S3Key: prior + '/api.zip' });
            await ready(name, prior);
        }
        throw new Error('PRIMARY_CODE_RELEASE_FAILED', { cause: error });
    }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        if (process.argv[2] === 'prepare')
            console.log(JSON.stringify({ status: 'PREPARED', sourceCommit: (await prepare(process.argv[3], process.argv[4], process.env.GITHUB_RUN_ID)).sourceCommit }));
        else if (process.argv[2] === 'primary')
            console.log(JSON.stringify(await publishPrimary(process.argv[3])));
        else if (process.argv[2] === 'publish')
            console.log(JSON.stringify(await publish(process.argv[3])));
        else
            throw new Error('MODE_REQUIRED');
    }
    catch (error) {
        console.error(JSON.stringify({ status: 'QA_RELEASE_BLOCKED_OR_FAILED', failure: releaseFailure(error) }));
        process.exitCode = 1;
    }
}
