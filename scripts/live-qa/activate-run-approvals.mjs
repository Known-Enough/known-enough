import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { aws } from './aws.mjs';
import { digest } from './config.mjs';
import { approvalContext } from './github-allowance.mjs';

const functionName = 'known-enough-qa-fixtures';
const bucket = 'known-enough-qa-artifacts-092954139775';
const fail = () => { throw new Error('RUN_APPROVAL_ACTIVATION_BLOCKED'); };
export async function activateRunApprovals(directory, call = aws, wait = ms => new Promise(resolve => globalThis.setTimeout(resolve, ms))) {
    const identity = call('sts', 'get-caller-identity');
    if (identity.Account !== '092954139775' || !identity.Arn?.startsWith('arn:aws:sts::092954139775:assumed-role/KnownEnoughGithubQaRelease/')) fail();
    const controlKey = name => ({ TableName: 'KnownEnoughQaControl', Key: { PK: { S: name }, SK: { S: 'STATE' } }, ConsistentRead: true });
    const auth = JSON.parse(call('dynamodb', 'get-item', controlKey('AUTH')).Item.payload.S);
    const lease = JSON.parse(call('dynamodb', 'get-item', controlKey('LEASE')).Item.payload.S);
    if (!auth.approved || !Number.isFinite(Date.parse(auth.expiresAt)) || Date.parse(auth.expiresAt) <= Date.now() || lease.status !== 'CLEAN') fail();
    const manifest = JSON.parse(readFileSync(directory + '/package.json', 'utf8'));
    const sha = digest(readFileSync(directory + '/broker.zip'));
    if (manifest.artifacts.broker.sha256 !== sha || manifest.artifacts.broker.entry !== 'broker.handler') fail();
    const current = call('lambda', 'get-function-configuration', { FunctionName: functionName });
    if (current.State !== 'Active' || current.LastUpdateStatus !== 'Successful' || current.Handler !== 'broker.handler'
        || current.Environment?.Variables?.QA_CONTROL_TABLE !== 'KnownEnoughQaControl') fail();
    const prior = Buffer.from(current.CodeSha256, 'base64').toString('hex');
    if (!/^[a-f0-9]{64}$/.test(prior)) fail();
    writeFileSync(directory + '/broker-before-private.json', JSON.stringify(current), { mode: 0o600 });
    if (prior !== sha) {
        // Existing releases preserve each prior ZIP under its digest for rollback.
        call('s3api', 'head-object', { Bucket: bucket, Key: prior + '/broker.zip' });
        call('s3api', 'put-object', { Bucket: bucket, Key: sha + '/broker.zip', Body: directory + '/broker.zip', ChecksumSHA256: Buffer.from(sha, 'hex').toString('base64') });
        call('lambda', 'update-function-code', { FunctionName: functionName, RevisionId: current.RevisionId, S3Bucket: bucket, S3Key: sha + '/broker.zip' });
    }
    for (let i = 0; i < 90; i++) {
        const after = call('lambda', 'get-function-configuration', { FunctionName: functionName });
        if (after.LastUpdateStatus === 'Failed') fail();
        if (after.State === 'Active' && after.LastUpdateStatus === 'Successful') {
            if (after.CodeSha256 !== Buffer.from(sha, 'hex').toString('base64') || after.Handler !== current.Handler
                || !isDeepStrictEqual(after.Environment, current.Environment)) fail();
            const receipt = { status: 'GITHUB_RUN_APPROVALS_ACTIVATED', sourceCommit: manifest.sourceCommit,
                brokerSha256: sha, previousSha256: prior, rollbackKey: prior + '/broker.zip', testStarted: false, cloudWrites: prior !== sha };
            writeFileSync(directory + '/activation.json', JSON.stringify(receipt), { mode: 0o600 });
            return receipt;
        }
        await wait(1000);
    }
    fail();
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        approvalContext({ repository: process.env.GITHUB_REPOSITORY, repositoryId: process.env.GITHUB_REPOSITORY_ID,
            ref: process.env.GITHUB_REF, event: process.env.GITHUB_EVENT_NAME, actor: process.env.GITHUB_ACTOR,
            actorId: process.env.GITHUB_ACTOR_ID, triggeringActor: process.env.GITHUB_TRIGGERING_ACTOR });
        console.log(JSON.stringify(await activateRunApprovals(process.argv[2])));
    } catch {
        console.error(JSON.stringify({ status: 'BLOCKED', code: 'RUN_APPROVAL_ACTIVATION_BLOCKED' }));
        process.exitCode = 1;
    }
}
