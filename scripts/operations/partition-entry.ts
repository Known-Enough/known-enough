import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { createPartitionReleaseHandler } from '../../apps/api/src/partition-release.ts';
import { createKe13bLambdaHandler, readKe13bConfig, type HttpApiEvent, type HttpApiResult } from '../../apps/api/src/ke13b-lambda.ts';
let selected: ((event: HttpApiEvent) => Promise<HttpApiResult>) | undefined;
export async function handler(event: HttpApiEvent): Promise<HttpApiResult> {
  try {
    if (!selected) {
      const directory = dirname(fileURLToPath(import.meta.url));
      const configurationBytes = readFileSync(join(directory, 'configuration-private.json'));
      const configuration = JSON.parse(configurationBytes.toString('utf8'));
      const config = readKe13bConfig();
      if (config.models || config.region !== 'us-east-1' || config.tableName !== 'KnownEnoughStage'
        || config.userPoolId !== configuration.userPoolId || config.participantClientId !== configuration.participantClientId
        || config.displayClientId !== configuration.displayClientId || config.allowedOrigin !== configuration.allowedOrigin
        || config.groups?.tableName !== 'KnownEnoughGroupsStage' || config.groups.emailKey !== configuration.emailKey
        || config.groups.cognitoDomain !== configuration.cognitoDomain) throw new Error('PARTITION_RELEASE_INVALID');
      const client = new DynamoDBClient({ region: 'us-east-1', endpoint: 'https://dynamodb.us-east-1.amazonaws.com', maxAttempts: 1 });
      selected = createPartitionReleaseHandler({ configurationBytes,
        manifestBytes: readFileSync(join(directory, 'manifest-private.json')),
        release: JSON.parse(readFileSync(join(directory, 'release-private.json'), 'utf8')),
        legacy: createKe13bLambdaHandler(config), readSource: async signal => {
          const result = await client.send(new GetItemCommand({ TableName: 'KnownEnoughGroupsStage',
            Key: { PK: { S: 'NP#GROUPS' }, SK: { S: 'STATE' } }, ConsistentRead: true }), { abortSignal: signal });
          if (!result.Item) return null;
          const item = result.Item;
          if (item.PK?.S !== 'NP#GROUPS' || item.SK?.S !== 'STATE' || typeof item.version?.N !== 'string'
            || !/^[1-9][0-9]*$/.test(item.version.N) || typeof item.payload?.S !== 'string') throw new Error('PARTITION_RELEASE_INVALID');
          return { version: Number(item.version.N), payload: Buffer.from(item.payload.S) };
        } });
    }
    return await selected(event);
  } catch { return { statusCode: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'retry-after': '3' },
    body: JSON.stringify({ ok: false, error: { code: 'RETRYABLE_SERVER_ERROR', httpStatus: 503 } }), isBase64Encoded: false }; }
}
