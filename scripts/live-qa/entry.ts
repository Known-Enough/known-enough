import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { createAuthorizedBedrockTransport } from '../../packages/adapters/src/bedrock-models.ts';
import { createKe13bLambdaHandler, readKe13bConfig, type HttpApiEvent } from '../../apps/api/src/ke13b-lambda.ts';
import { budgetedTransport } from './budget.mjs';
let handler: ReturnType<typeof createKe13bLambdaHandler> | undefined;
export async function qaHandler(event: HttpApiEvent) {
  try {
    const method=event.requestContext?.http?.method;if(!method)throw new Error('QA_EVENT_INVALID');
    if(method!=='OPTIONS'){const result=await new DynamoDBClient({region:'us-east-1',maxAttempts:1}).send(new GetItemCommand({TableName:process.env.QA_CONTROL_TABLE!,Key:{PK:{S:'LEASE'},SK:{S:'STATE'}},ConsistentRead:true}));const lease=result.Item?.payload?.S?JSON.parse(result.Item.payload.S):null;if(lease?.status!=='ACTIVE'||lease.expiresAt<=Date.now())throw new Error('QA_LEASE_BLOCKED');}
    if (!handler) {
      const config = readKe13bConfig();
      if (config.models) config.models.provider = { mode: 'INJECTED', transport: budgetedTransport(createAuthorizedBedrockTransport({ paidCallsApproved: true, invocationLoggingDisabled: true, retentionReviewed: true }), new DynamoDBClient({ region: config.region, maxAttempts: 1 }), process.env.QA_CONTROL_TABLE!) };
      handler = createKe13bLambdaHandler(config);
    }
    return await handler(event);
  } catch { return { statusCode: 503, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: false, error: { code: 'QA_NOT_READY' } }), isBase64Encoded: false }; }
}
export { handler } from '../../apps/api/src/ke13b-lambda.ts';
