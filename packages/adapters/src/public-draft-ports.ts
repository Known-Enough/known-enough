import { DynamoDBClient, GetItemCommand, type TransactWriteItem } from '@aws-sdk/client-dynamodb';
import { createAuthorizedBedrockTransport } from './bedrock-models.ts';
import { createDynamoModelJobStore, JOB_TARGET, type PublicDraftCommit, type JobPin } from './dynamo-model-jobs.ts';
import { DurableJobError } from './durable-model-jobs.ts';
export type PublicDraftAtomicItem = TransactWriteItem;
/** Exact existing project tables/provider, one-attempt SDK. No environment or HTTP activation. */
export function createManagedPublicDraftPorts(sourceSha: string) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new DurableJobError('INVALID');
  const client = new DynamoDBClient({ region: JOB_TARGET.region, maxAttempts: 1, endpoint: 'https://dynamodb.us-east-1.amazonaws.com' });
  return {
    transport: createAuthorizedBedrockTransport({ paidCallsApproved: true, invocationLoggingDisabled: true, retentionReviewed: true }),
    store: (publicDraftCommit: PublicDraftCommit) => createDynamoModelJobStore({ verifiedTarget: { account: JOB_TARGET.account, region: JOB_TARGET.region }, sourceSha, publicDraftCommit }),
    authority: async (): Promise<JobPin> => {
      const result = await client.send(new GetItemCommand({ TableName: JOB_TARGET.budget, Key: { PK: { S: 'AUTH' }, SK: { S: 'STATE' } }, ConsistentRead: true }), { abortSignal: AbortSignal.timeout(5000) });
      const item = result.Item;
      if (!item || item.PK?.S !== 'AUTH' || item.SK?.S !== 'STATE' || typeof item.payload?.S !== 'string' || !/^[1-9][0-9]*$/.test(item.version?.N ?? '')) throw new DurableJobError('DISABLED');
      return { table: JOB_TARGET.budget, key: { PK: 'AUTH', SK: 'STATE' }, attribute: 'version', revision: Number(item.version!.N), payload: item.payload.S };
    },
  };
}
