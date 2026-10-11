import { randomUUID, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { verifySource } from './verify.mjs';
const execute = promisify(execFile);
export async function archiveDirectoryReadProof(send, nonce) {
  if (typeof send !== 'function' || typeof nonce !== 'string' || !/^[a-f0-9-]{36}$/.test(nonce)) throw new Error('ARCHIVE_PROBE_INVALID');
  const hash = createHash('sha256').update(nonce).digest('hex');
  const checks = [ ['ownedSyntheticHeader', `GROUP#ops01-probe-${nonce}`, 'HEADER'],
    ['ownedSyntheticInvitationDirectory', `INVITATION#${hash}`, 'TARGET'],
    ['ownedSyntheticDecisionDirectory', `DECISION#ops01-probe-${nonce}`, 'GROUP'] ];
  const reports = []; const signal = globalThis.AbortSignal.timeout(20_000);
  for (const [capability, PK, SK] of checks) {
    try {
      const response = await send(new GetItemCommand({ TableName: 'KnownEnoughPartitions',
        Key: { PK: { S: PK }, SK: { S: SK } }, ConsistentRead: true }), { abortSignal: signal });
      reports.push({ capability, result: response.Item === undefined ? 'READ_ALLOWED' : 'UNEXPECTED_COLLISION' });
    } catch (error) {
      const code = ['AccessDeniedException','AccessDenied','CredentialsProviderError','TimeoutError','RequestTimeout'].includes(error?.name) ? error.name : 'UNCLASSIFIED';
      reports.push({ capability, result: 'READ_FAILED', code });
    }
  }
  return { result: reports.every(row => row.result === 'READ_ALLOWED') ? 'ARCHIVE_DIRECTORY_ACCESS_PASS' : 'ARCHIVE_DIRECTORY_ACCESS_INCOMPLETE',
    requests: reports.length, mutations: 0, reports };
}
async function main() {
  const sourceSha = verifySource(process.env);
  const { stdout } = await execute('aws', ['sts','get-caller-identity','--region','us-east-1','--output','json','--no-cli-pager'], { timeout: 10_000, maxBuffer: 4096 });
  const identity = JSON.parse(stdout);
  if (identity.Account !== '092954139775' || !identity.Arn?.startsWith('arn:aws:sts::092954139775:assumed-role/KnownEnoughGithubGroupArchive/')) throw new Error('ARCHIVE_PROBE_IDENTITY_INVALID');
  const client = new DynamoDBClient({ region:'us-east-1',endpoint:'https://dynamodb.us-east-1.amazonaws.com',maxAttempts:1 });
  const result = await archiveDirectoryReadProof(client.send.bind(client),randomUUID());
  console.log(JSON.stringify({ sourceSha,account:'092954139775',region:'us-east-1',...result,participantAction:'NOT_EXECUTED',email:'NOT_SENT',deployment:'UNCHANGED' }));
  if (result.result !== 'ARCHIVE_DIRECTORY_ACCESS_PASS') process.exitCode=1;
}
if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch { console.error(JSON.stringify({result:'ARCHIVE_PROBE_NOT_VERIFIED',mutations:0}));process.exitCode=1; }
}
