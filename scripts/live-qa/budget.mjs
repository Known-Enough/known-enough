import { GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { reserveAttempt } from './fixture-core.mjs';
const key = name => ({ PK: { S: name }, SK: { S: 'STATE' } });
export function budgetedTransport(transport, client, table, now = Date.now) {
  return { send: async (command, options) => {
    const read = async name => { const result = await client.send(new GetItemCommand({ TableName: table, Key: key(name), ConsistentRead: true })); if (!result.Item) throw new Error('MODEL_BUDGET_BLOCKED'); return { value: JSON.parse(result.Item.payload.S), version: result.Item.version.N }; };
    const auth = await read('AUTH'); const lease = await read('LEASE');
    const reserved = reserveAttempt(lease.value, auth.value, now(), Buffer.byteLength(JSON.stringify(command.input)), command.input.inferenceConfig?.maxTokens ?? 2048);
    await client.send(new TransactWriteItemsCommand({ TransactItems: [{ConditionCheck:{TableName:table,Key:key('AUTH'),ConditionExpression:'#v=:v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':{N:auth.version}}}},{Update:{ TableName: table, Key: key('LEASE'), UpdateExpression: 'SET payload=:p, #v=:n', ConditionExpression: '#v=:v', ExpressionAttributeNames: { '#v':'version' }, ExpressionAttributeValues: { ':p':{S:JSON.stringify(reserved)}, ':n':{N:String(Number(lease.version)+1)}, ':v':{N:lease.version} } }}] }));
    if (Date.parse(auth.value.expiresAt) <= now() || reserved.expiresAt <= now()) throw new Error('MODEL_BUDGET_BLOCKED');
    return transport.send(command, options);
  } };
}
