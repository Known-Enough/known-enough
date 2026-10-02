import { spawnSync } from 'node:child_process';
/** Never print SDK/CLI diagnostics, raw responses or command bodies. */
export function aws(service, operation, input = {}) {
    const body = service === 's3api' && operation === 'put-object' ? input.Body : null;
    const data = { ...input };
    if (body)
        delete data.Body;
    const result = spawnSync('aws', [
        service, operation, ...(body ? ['--body', body] : []), '--region', 'us-east-1', '--cli-input-json', JSON.stringify(data), '--output', 'json', '--no-cli-pager'
    ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 120000, env: { ...process.env, AWS_MAX_ATTEMPTS: '1', AWS_PAGER: '' } });
    if (result.status !== 0) {
        const error = new Error(`AWS_OPERATION_FAILED:${service}:${operation}`);
        error.noUpdates = /No updates are to be performed/.test(result.stderr ?? '');
        error.missing = /NoSuchBucket|Not Found|ResourceNotFoundException|does not exist|SecretNotFound|NotFoundException/.test(result.stderr ?? '');
        throw error;
    }
    try {
        return result.stdout.trim() ? JSON.parse(result.stdout) : {};
    }
    catch {
        throw new Error('INVALID_AWS_RESPONSE');
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
