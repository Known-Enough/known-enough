import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
