import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DynamoDBClient, GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { ControlSchema, TotalsSchema } from '../../packages/adapters/src/durable-model-jobs.ts';
import { validateAuthorization } from '../live-qa/config.mjs';
import { verifySource } from './verify.mjs';
const key = PK => ({ PK: { S: PK }, SK: { S: 'STATE' } });
const validSource = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) && !/^0+$/.test(value);
const invalid = code => { throw Object.assign(new Error(code), { safeCode: code }); };
function decode(item, PK, field, parse) {
  if (!item || item.PK?.S !== PK || item.SK?.S !== 'STATE' || typeof item.payload?.S !== 'string'
    || !/^[1-9][0-9]*$/.test(item[field]?.N ?? '') || !Number.isSafeInteger(Number(item[field].N))
    || Object.keys(item).sort().join('|') !== ['PK','SK',field,'payload'].sort().join('|')) return invalid('JOB_SOURCE_RECORD_INVALID');
  const value = parse(JSON.parse(item.payload.S));
  if (JSON.stringify(value) !== item.payload.S || field === 'revision' && String(value.revision) !== item.revision.N) return invalid('JOB_SOURCE_RECORD_INVALID');
  return value;
}
/** Only an explicitly observed empty DISABLED control can move; no TOTAL writes or enable/provider path. */
export async function transitionDisabledJobSource(send, fromSource, sourceSha) {
  if (typeof send !== 'function' || !validSource(fromSource) || !validSource(sourceSha)) return invalid('JOB_SOURCE_INVALID');
  const read = async (TableName, PK) => (await send(new GetItemCommand({TableName,Key:key(PK),ConsistentRead:true}),
    {abortSignal:globalThis.AbortSignal.timeout(10000)})).Item;
  const prior = await read('KnownEnoughOperationsJournal','OPERATIONS#MODEL_JOBS');
  const control = decode(prior,'OPERATIONS#MODEL_JOBS','revision',value=>ControlSchema.parse(value));
  if (control.enabled || control.active.length || control.slots.length) return invalid('JOB_SOURCE_NOT_DISABLED_EMPTY');
  if (control.sourceSha !== fromSource && control.sourceSha !== sourceSha) return invalid('JOB_SOURCE_UNEXPECTED');
  const auth = await read('KnownEnoughQaControl','AUTH');
  const authority = decode(auth,'AUTH','version',validateAuthorization);
  if (authority.mode !== 'standing' || !authority.approved || !authority.retentionReviewed || !authority.invocationLoggingDisabled) return invalid('JOB_SOURCE_AUTHORITY_INVALID');
  const totals = await read('KnownEnoughQaControl','TOTAL'); decode(totals,'TOTAL','version',value=>TotalsSchema.parse(value));
  let writeRequested = false;
  if (control.sourceSha !== sourceSha) {
    const next = ControlSchema.parse({...control,revision:control.revision+1,sourceSha});
    const candidate = {...key('OPERATIONS#MODEL_JOBS'),revision:{N:String(next.revision)},payload:{S:JSON.stringify(next)}};
    writeRequested = true;
    try {
      await send(new TransactWriteItemsCommand({ClientRequestToken:randomUUID(),TransactItems:[
        {Put:{TableName:'KnownEnoughOperationsJournal',Item:candidate,ConditionExpression:'#r = :r AND #p = :p',
          ExpressionAttributeNames:{'#r':'revision','#p':'payload'},ExpressionAttributeValues:{':r':prior.revision,':p':prior.payload}}},
        {ConditionCheck:{TableName:'KnownEnoughQaControl',Key:key('AUTH'),ConditionExpression:'#v = :v AND #p = :p',
          ExpressionAttributeNames:{'#v':'version','#p':'payload'},ExpressionAttributeValues:{':v':auth.version,':p':auth.payload}}}
      ]}),{abortSignal:globalThis.AbortSignal.timeout(20000)});
    } catch { /* Reconcile the exact result. Never reissue an unknown control transaction. */ }
    if (!isDeepStrictEqual(await read('KnownEnoughOperationsJournal','OPERATIONS#MODEL_JOBS'),candidate)) return invalid('JOB_SOURCE_CHANGE_UNCONFIRMED');
  }
  return {sourceSha,result:writeRequested?'JOB_SOURCE_DISABLED_READBACK_PASS':'JOB_SOURCE_ALREADY_MATCHES',writeRequested,
    state:'DISABLED',active:0,slots:0,totalWrites:0,totalsUnchangedDuringCheck:isDeepStrictEqual(totals,await read('KnownEnoughQaControl','TOTAL')),providerCalls:0};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const sourceSha = verifySource(process.env);
    const identity = JSON.parse(execFileSync('aws',['sts','get-caller-identity','--region','us-east-1','--output','json','--no-cli-pager'],{encoding:'utf8',timeout:15000}));
    if (identity.Account !== '092954139775' || !identity.Arn?.startsWith('arn:aws:sts::092954139775:assumed-role/KnownEnoughGithubModelJobOperations/')) invalid('JOB_SOURCE_IDENTITY_INVALID');
    const client = new DynamoDBClient({region:'us-east-1',endpoint:'https://dynamodb.us-east-1.amazonaws.com',maxAttempts:1});
    console.log(JSON.stringify(await transitionDisabledJobSource(client.send.bind(client),process.env.PREVIOUS_JOB_SOURCE,sourceSha)));
  } catch(error) { console.error(JSON.stringify({result:'BLOCKED',code:error.safeCode??'JOB_SOURCE_UNVERIFIED',providerCalls:0,totalWrites:0}));process.exitCode=1; }
}
