import { GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { reserveTotal } from './cumulative.mjs';
import { authorizationActive } from './config.mjs';
import { reserveAttempt } from './fixture-core.mjs';
const key = name => ({ PK: { S: name }, SK: { S: 'STATE' } });
function update(table, name, prior, value) {
    return {
        Update: {
            TableName: table, Key: key(name),
            UpdateExpression: 'SET payload=:p, #v=:n', ConditionExpression: '#v=:v',
            ExpressionAttributeNames: { '#v': 'version' },
            ExpressionAttributeValues: { ':p': { S: JSON.stringify(value) },
                ':n': { N: String(Number(prior.version) + 1) }, ':v': { N: prior.version } }
        }
    };
}
export function budgetedTransport(transport, client, table, now = Date.now) {
    return {
        send: async (command, options) => {
            const read = async (name) => {
                const result = await client.send(new GetItemCommand({ TableName: table, Key: key(name), ConsistentRead: true }));
                if (!result.Item)
                    throw new Error('MODEL_BUDGET_BLOCKED');
                return { value: JSON.parse(result.Item.payload.S), version: result.Item.version.N };
            };
            const auth = await read('AUTH');
            const lease = await read('LEASE');
            const total = await read('TOTAL');
            const reserved = reserveAttempt(lease.value, auth.value, now(), Buffer.byteLength(JSON.stringify(command.input)), command.input.inferenceConfig?.maxTokens ?? 2048);
            const cumulative = reserveTotal(total.value, auth.value, {
                reservedTokens: reserved.reservedTokens - lease.value.reservedTokens,
                reservedCostMicros: reserved.reservedCostMicros - lease.value.reservedCostMicros
            });
            // Per-run and cumulative reservations commit together before any provider call.
            await client.send(new TransactWriteItemsCommand({
                TransactItems: [
                    {
                        ConditionCheck: {
                            TableName: table, Key: key('AUTH'), ConditionExpression: '#v=:v',
                            ExpressionAttributeNames: { '#v': 'version' }, ExpressionAttributeValues: { ':v': { N: auth.version } }
                        }
                    },
                    update(table, 'LEASE', lease, reserved), update(table, 'TOTAL', total, cumulative)
                ]
            }));
            if (!authorizationActive(auth.value, now()) || reserved.expiresAt <= now())
                throw new Error('MODEL_BUDGET_BLOCKED');
            return transport.send(command, options);
        }
    };
}
