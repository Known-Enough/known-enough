import { withSharedMcp } from '../../apps/api/src/mcp-server.ts';
import { createPartitionManagedDriver, createPartitionGroupSession } from '@deal-table/adapters/partition-request';
import { partitionDeploymentOptions } from '../../apps/api/src/partition-deployment.ts';
import { createSignupIntake, isSignupIntakeEvent } from '../../apps/api/src/signup-intake.ts';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { createPartitionReleaseHandler } from '../../apps/api/src/partition-release.ts';
import { loadLifecyclePackage } from './lifecycle-package.ts';
import { loadJobsPackage } from './jobs-package.ts';
import { createKe13bLambdaHandler, gatewayFailure, readKe13bConfig, type HttpApiEvent, type HttpApiResult } from '../../apps/api/src/ke13b-lambda.ts';
let intake: ReturnType<typeof createSignupIntake> | undefined;
let selected: ((event: HttpApiEvent) => Promise<HttpApiResult>) | undefined;
export async function handler(event: HttpApiEvent): Promise<unknown> {
  const trigger = isSignupIntakeEvent(event);
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
      let lifecycle;
      try { lifecycle = loadLifecyclePackage(readFileSync(join(directory, 'lifecycle-private.json'))); }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
      let jobs;
      try { jobs = loadJobsPackage(readFileSync(join(directory, 'jobs-private.json'))); }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
      const release = JSON.parse(readFileSync(join(directory, 'release-private.json'), 'utf8'));
      const manifestBytes = readFileSync(join(directory, 'manifest-private.json'));
      const trusted = partitionDeploymentOptions(configurationBytes, manifestBytes, release);
      const driver = createPartitionManagedDriver(trusted.managed);
      intake = createSignupIntake({ userPoolId: trusted.identity.userPoolId, participantClientId: trusted.identity.participantClientId,
        session: createPartitionGroupSession(driver.groups, { emailKey: trusted.emailKey, ...(trusted.sharedTestEmailHashes ? { sharedTestEmailHashes: trusted.sharedTestEmailHashes } : {}) }) });
      selected = withSharedMcp(createPartitionReleaseHandler({ configurationBytes,
        ...(lifecycle ? { lifecycle } : {}),
        ...(jobs ? { jobs: { sourceSha: jobs.sourceSha } } : {}),
        manifestBytes, release,
        legacy: createKe13bLambdaHandler(config), readSource: async signal => {
          const result = await client.send(new GetItemCommand({ TableName: 'KnownEnoughGroupsStage',
            Key: { PK: { S: 'NP#GROUPS' }, SK: { S: 'STATE' } }, ConsistentRead: true }), { abortSignal: signal });
          if (!result.Item) return null;
          const item = result.Item;
          if (item.PK?.S !== 'NP#GROUPS' || item.SK?.S !== 'STATE' || typeof item.version?.N !== 'string'
            || !/^[1-9][0-9]*$/.test(item.version.N) || typeof item.payload?.S !== 'string') throw new Error('PARTITION_RELEASE_INVALID');
          return { version: Number(item.version.N), payload: Buffer.from(item.payload.S) };
        } }), config.allowedOrigin);
    }
    if (trigger) return await intake!(event);
    return await selected(event);
  } catch (error) { if (trigger) {
    // Keep Cognito's existing sanitized trigger failure; its logs must not serialize intake details.
    // eslint-disable-next-line preserve-caught-error
    throw new Error('SIGNUP_INTAKE_UNAVAILABLE');
  }
    return gatewayFailure(event, 503, process.env.KE13B_ALLOWED_ORIGIN, 'RUNTIME_INIT', error); }
}
