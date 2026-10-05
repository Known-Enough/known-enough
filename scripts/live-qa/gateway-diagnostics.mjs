/** Public numeric configuration only; no URLs, headers, IDs or raw AWS errors. */
export function safeGatewayThrottle(stage) {
    const settings = stage?.DefaultRouteSettings;
    const rate = settings?.ThrottlingRateLimit;
    const burst = settings?.ThrottlingBurstLimit;
    if (!Number.isFinite(rate) || rate < 0 || rate > 1000000 || !Number.isInteger(burst) || burst < 0 || burst > 1000000) return null;
    return { rate, burst };
}
export function collectGatewayThrottle(target, execute) {
    const match = /^https:\/\/([a-z0-9]+)\.execute-api\.us-east-1\.amazonaws\.com$/.exec(target?.ApiUrl ?? '');
    if (!match) return null;
    try { return safeGatewayThrottle(execute('apigatewayv2', 'get-stage', { ApiId: match[1], StageName: '$default' })); }
    catch { return null; }
}
