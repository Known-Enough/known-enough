import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export const SAFE_AWS_ERROR_CODES = new Set([
    'AccessDenied', 'AccessDeniedException', 'NoSuchEntity', 'NoSuchBucket',
    'ResourceNotFoundException', 'ValidationException', 'InvalidParameterValueException',
    'InvalidParameterException', 'InvalidRequestException', 'PreconditionFailedException',
    'ResourceConflictException', 'ExpiredToken', 'ExpiredTokenException',
    'UnrecognizedClientException', 'ServiceException', 'TooManyRequestsException'
]);
/** Never print SDK/CLI diagnostics, raw responses or command bodies. */
export function aws(service, operation, input = {}) {
    const body = service === 's3api' && operation === 'put-object' ? input.Body : null;
    const data = { ...input };
    if (body)
        delete data.Body;
    let privateUpload;
    try {
        const binaryArgs = [];
        if (service === 'lambda' && operation === 'update-function-code' && Object.hasOwn(data, 'ZipFile')) {
            if (typeof data.ZipFile !== 'string' || !data.ZipFile.length)
                throw new Error('INVALID_LAMBDA_UPLOAD_BYTES');
            const zip = Buffer.from(data.ZipFile, 'base64');
            if (zip.toString('base64') !== data.ZipFile)
                throw new Error('INVALID_LAMBDA_UPLOAD_BYTES');
            privateUpload = mkdtempSync(join(tmpdir(), 'known-enough-aws-upload-'));
            const file = join(privateUpload, 'function.zip');
            writeFileSync(file, zip, { mode: 0o600, flag: 'wx' });
            delete data.ZipFile;
            binaryArgs.push('--zip-file', 'fileb://' + file);
        }
        const result = spawnSync('aws', [
            service, operation, ...(body ? ['--body', body] : []), ...binaryArgs,
            '--region', 'us-east-1', '--cli-input-json', JSON.stringify(data), '--output', 'json', '--no-cli-pager'
        ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 120000, env: { ...process.env, AWS_MAX_ATTEMPTS: '1', AWS_PAGER: '' } });
        if (result.error)
            throw new Error('AWS_CLI_PROCESS_LAUNCH_FAILED');
        if (result.status !== 0) {
            const error = new Error(`AWS_OPERATION_FAILED:${service}:${operation}`);
            const code = /An error occurred \(([^)]+)\)/.exec(result.stderr ?? '')?.[1];
            if (SAFE_AWS_ERROR_CODES.has(code)) error.awsCode = code;
            if (service === 'amplify' && ['AccessDenied', 'AccessDeniedException'].includes(code)) {
                const app = input.appId ?? input.AppId;
                const resource = /(arn:aws:amplify:us-east-1:092954139775:apps\/[a-z0-9]+\/branches\/main(?:\/(?:deployments|jobs)\/[A-Za-z0-9_*-]+)?)(?=[\s"']|$)/.exec(result.stderr ?? '')?.[1];
                if (/^[a-z0-9]{1,32}$/.test(app ?? '') && resource?.startsWith(`arn:aws:amplify:us-east-1:092954139775:apps/${app}/branches/main`)) error.deniedResource = resource;
            }
            error.noUpdates = /No updates are to be performed/.test(result.stderr ?? '');
            error.missing = /NoSuchBucket|NoSuchEntity|Not Found|ResourceNotFoundException|does not exist|SecretNotFound|NotFoundException/.test(result.stderr ?? '');
            throw error;
        }
        try {
            return result.stdout.trim() ? JSON.parse(result.stdout) : {};
        }
        catch {
            throw new Error('INVALID_AWS_RESPONSE');
        }
    } finally {
        if (privateUpload) rmSync(privateUpload, { recursive: true, force: true });
    }
}
export function awsSkeleton(service, operation) {
    const result = spawnSync('aws', [service, operation, '--generate-cli-skeleton', 'input'], { encoding: 'utf8', timeout: 15000 });
    if (result.status)
        throw new Error('AWS_SKELETON_UNAVAILABLE');
    return JSON.parse(result.stdout);
}
export function preservationInput(snapshot, skeleton) {
    return Object.fromEntries(Object.keys(skeleton).filter(key => Object.hasOwn(snapshot, key)).map(key => [key, structuredClone(snapshot[key])]));
}
export function assertIdentity(result, config) {
    if (result.Account !== config.account || !result.Arn?.startsWith(`arn:aws:`))
        throw new Error('WRONG_AWS_ACCOUNT');
}
