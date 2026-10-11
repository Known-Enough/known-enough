import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function primaryPublicationMode(item) {
  if (item === undefined) return 'LEGACY';
  if (!item || item.PK?.S !== 'MIGRATION#CONTROL' || item.SK?.S !== 'STATE'
    || typeof item.payload?.S !== 'string' || typeof item.revision?.N !== 'string') throw new Error('PRIMARY_STORAGE_MODE_UNVERIFIED');
  const c = JSON.parse(item.payload.S);
  if (!c || Object.keys(c).sort().join('|') !== 'account|active|planHash|region|revision|schemaVersion|table'
    || c.schemaVersion !== 1 || c.account !== '092954139775' || c.region !== 'us-east-1' || c.table !== 'KnownEnoughPartitions'
    || !Number.isSafeInteger(c.revision) || c.revision < 0 || item.revision.N !== String(c.revision)
    || typeof c.active !== 'boolean' || !(c.planHash === null || /^[a-f0-9]{64}$/.test(c.planHash))) throw new Error('PRIMARY_STORAGE_MODE_UNVERIFIED');
  // Inactive migration also owns the private deployment/recovery package; never replace it with QA's legacy archive.
  return 'OPERATIONS';
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const sourceSha = process.argv[2];
    if (!/^[a-f0-9]{40}$/.test(sourceSha) || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== sourceSha) throw new Error();
    const identity = JSON.parse(execFileSync('aws', ['sts','get-caller-identity','--region','us-east-1','--output','json','--no-cli-pager'], { encoding: 'utf8', timeout: 15000 }));
    if (identity.Account !== '092954139775' || !identity.Arn?.startsWith('arn:aws:sts::092954139775:assumed-role/KnownEnoughGithubPartitionMigration/')) throw new Error();
    const client = new DynamoDBClient({ region: 'us-east-1', endpoint: 'https://dynamodb.us-east-1.amazonaws.com', maxAttempts: 1 });
    const result = await client.send(new GetItemCommand({ TableName: 'KnownEnoughPartitions', Key: { PK: { S: 'MIGRATION#CONTROL' }, SK: { S: 'STATE' } }, ConsistentRead: true }), { abortSignal: globalThis.AbortSignal.timeout(10000) });
    writeFileSync(process.argv[3], JSON.stringify({ sourceSha, mode: primaryPublicationMode(result.Item) }) + '\n', { mode: 0o600, flag: 'wx' });
  } catch { console.error('PRIMARY_STORAGE_MODE_UNVERIFIED'); process.exitCode = 1; }
}
