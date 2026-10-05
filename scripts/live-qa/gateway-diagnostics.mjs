/** Public numeric configuration only; no URLs, headers, IDs or raw AWS errors. */
export function safeGatewayThrottle(stage) {
    const settings = stage?.DefaultRouteSettings;
    const rate = settings?.ThrottlingRateLimit;
    const burst = settings?.ThrottlingBurstLimit;
    if (!Number.isFinite(rate) || rate < 0 || rate > 1000000 || !Number.isInteger(burst) || burst < 0 || burst > 1000000) return null;
    return { rate, burst };
}
export const GATEWAY_OBSERVATION_STATUSES = ['OBSERVED', 'INVALID_TARGET', 'INVALID_SETTINGS', 'ACCESS_DENIED', 'AWS_READ_FAILED'];
export function collectGatewayThrottle(target, execute, record = () => {}) {
    const match = /^https:\/\/([a-z0-9]+)\.execute-api\.us-east-1\.amazonaws\.com$/.exec(target?.ApiUrl ?? '');
    if (!match) { record('INVALID_TARGET'); return null; }
    try { const result = safeGatewayThrottle(execute('apigatewayv2', 'get-stage', { ApiId: match[1], StageName: '$default' })); record(result ? 'OBSERVED' : 'INVALID_SETTINGS'); return result; }
    catch (error) { record(['AccessDenied', 'AccessDeniedException'].includes(error?.awsCode) ? 'ACCESS_DENIED' : 'AWS_READ_FAILED'); return null; }
}
