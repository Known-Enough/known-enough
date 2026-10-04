import { validateAuthorization } from './config.mjs';
export const emptyTotals = () => ({ runs: 0, reservedTokens: 0, reservedCostMicros: 0, messages: 0 });
/** Legacy seven-day grants gain only tighter caps, never more time or authority. */
export function cumulativeLimits(authorization) {
    const a = validateAuthorization(authorization);
    if (a.mode === 'standing') return Object.fromEntries(Object.keys(emptyTotals()).map(key => [key, Number.MAX_SAFE_INTEGER]));
    const runs = Math.min(28, a.maxRunsPerDay * 7);
    return {
        runs: a.maxRunsTotal ?? runs,
        reservedTokens: a.maxTokensTotal ?? Math.min(7000000, runs * a.maxTokensPerRun),
        reservedCostMicros: a.maxCostMicrosTotal ?? Math.min(7000000, runs * a.maxCostMicrosPerRun),
        messages: a.maxSignupMessagesTotal ?? Math.min(56, a.maxSignupMessagesPerDay * 7)
    };
}
export function reserveTotal(prior, authorization, delta) {
    const limits = cumulativeLimits(authorization);
    if (!prior || Object.keys(prior).sort().join() !== Object.keys(limits).sort().join() ||
        Object.keys(delta).some(key => !Object.hasOwn(limits, key)))
        throw new Error('CUMULATIVE_BUDGET_NOT_INITIALIZED');
    const result = {};
    for (const key of Object.keys(limits)) {
        const change = delta[key] ?? 0;
        if (!Number.isSafeInteger(prior[key]) || prior[key] < 0 || !Number.isSafeInteger(change) || change < 0 ||
            !Number.isSafeInteger(prior[key] + change) || prior[key] + change > limits[key])
            throw new Error('CUMULATIVE_BUDGET_EXHAUSTED');
        result[key] = prior[key] + change;
    }
    return result;
}
const key = name => ({ PK: { S: name }, SK: { S: 'STATE' } });
const condition = (table, name, item) => ({
    ConditionCheck: {
        TableName: table, Key: key(name), ConditionExpression: item ? '#v=:v' : 'attribute_not_exists(PK)',
        ...(item ? { ExpressionAttributeNames: { '#v': 'version' }, ExpressionAttributeValues: { ':v': item.version } } : {})
    }
});
/** Existing totals survive every reinstall/re-authorization; migration cannot erase usage. */
export function authorizationTransaction(table, auth, lease, total, authorization) {
    validateAuthorization(authorization);
    if (lease && JSON.parse(lease.payload.S).status !== 'CLEAN')
        throw new Error('ACTIVE_LEASE_AUTHORIZATION_UPDATE_BLOCKED');
    if (!total && lease)
        throw new Error('CUMULATIVE_BUDGET_MIGRATION_REQUIRES_RECONCILIATION');
    if (total)
        reserveTotal(JSON.parse(total.payload.S), authorization, {});
    return {
        TransactItems: [
            condition(table, 'LEASE', lease),
            {
                Put: {
                    TableName: table, Item: { ...key('AUTH'), payload: { S: JSON.stringify(authorization) },
                        version: { N: String(Number(auth?.version.N ?? 0) + 1) } },
                    ConditionExpression: auth ? '#v=:v' : 'attribute_not_exists(PK)',
                    ...(auth ? { ExpressionAttributeNames: { '#v': 'version' }, ExpressionAttributeValues: { ':v': auth.version } } : {})
                }
            },
            ...(total ? [condition(table, 'TOTAL', total)] : [
                {
                    Put: {
                        TableName: table,
                        Item: { ...key('TOTAL'), payload: { S: JSON.stringify(emptyTotals()) }, version: { N: '1' } },
                        ConditionExpression: 'attribute_not_exists(PK)'
                    }
                }
            ])
        ]
    };
}
