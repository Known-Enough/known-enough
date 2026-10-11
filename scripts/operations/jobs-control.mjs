import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { DynamoDBClient, GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { ControlSchema, TotalsSchema } from '../../packages/adapters/src/durable-model-jobs.ts';
import { createDynamoModelJobStore } from '../../packages/adapters/src/dynamo-model-jobs.ts';
import { validateAuthorization } from '../live-qa/config.mjs';
import { verifySource } from './verify.mjs';
const execute=promisify(execFile);
const key=PK=>({PK:{S:PK},SK:{S:'STATE'}});
const fail=code=>{throw Object.assign(new Error(code),{safeCode:code});};
const positive=value=>typeof value==='string'&&/^[1-9][0-9]*$/.test(value)&&Number.isSafeInteger(Number(value))&&Number(value)<Number.MAX_SAFE_INTEGER;
function decoded(item,PK,kind,schema){
 if(!item||item.PK?.S!==PK||item.SK?.S!=='STATE'||!positive(item[kind]?.N)||typeof item.payload?.S!=='string'
  ||Object.keys(item).sort().join('|')!==['PK','SK',kind,'payload'].sort().join('|'))return fail('JOB_CONTROL_RECORD_INVALID');
 const value=schema(JSON.parse(item.payload.S));
 if(JSON.stringify(value)!==item.payload.S||kind==='revision'&&String(value.revision)!==item.revision.N)return fail('JOB_CONTROL_RECORD_INVALID');
 return value;
}
/** At most one conditional empty-control write. This helper has no enable, TOTAL-write or provider path. */
export async function initializeDisabledControl(send,sourceSha){
 if(typeof send!=='function'||!/^[a-f0-9]{40}$/.test(sourceSha)||/^0+$/.test(sourceSha))return fail('JOB_CONTROL_SOURCE_INVALID');
 const read=async(TableName,PK)=>(await send(new GetItemCommand({TableName,Key:key(PK),ConsistentRead:true}),
  {abortSignal:globalThis.AbortSignal.timeout(10000)})).Item??null;
 const prior=await read('KnownEnoughOperationsJournal','OPERATIONS#MODEL_JOBS');
 const auth=await read('KnownEnoughQaControl','AUTH');
 const authority=decoded(auth,'AUTH','version',validateAuthorization);
 if(authority.mode!=='standing'||!authority.approved||!authority.retentionReviewed||!authority.invocationLoggingDisabled)return fail('JOB_CONTROL_STANDING_AUTH_INVALID');
 const totals=await read('KnownEnoughQaControl','TOTAL');decoded(totals,'TOTAL','version',value=>TotalsSchema.parse(value));
 let control;let writeAcknowledged=false;let writeRequested=false;
 if(prior){control=decoded(prior,'OPERATIONS#MODEL_JOBS','revision',value=>ControlSchema.parse(value));}
 else{
  control=ControlSchema.parse({schemaVersion:1,revision:1,enabled:false,sourceSha,active:[],slots:[]});
  const candidate={...key('OPERATIONS#MODEL_JOBS'),revision:{N:'1'},payload:{S:JSON.stringify(control)}};
  writeRequested=true;
  try{await send(new TransactWriteItemsCommand({TransactItems:[{Put:{TableName:'KnownEnoughOperationsJournal',Item:candidate,
    ConditionExpression:'attribute_not_exists(PK)'}}],ClientRequestToken:randomUUID()}),{abortSignal:globalThis.AbortSignal.timeout(20000)});writeAcknowledged=true;}
  catch{/* An uncertain or racing conditional write is never reissued; reconcile the exact disabled bytes. */}
  let observed;try{observed=await read('KnownEnoughOperationsJournal','OPERATIONS#MODEL_JOBS');}catch{return fail('JOB_CONTROL_WRITE_UNKNOWN');}
  if(!isDeepStrictEqual(observed,candidate))return fail('JOB_CONTROL_WRITE_UNKNOWN');
 }
 const after=await read('KnownEnoughQaControl','TOTAL');
 return {result:prior?'JOB_CONTROL_PRESENT_UNCHANGED':'JOB_CONTROL_DISABLED_READBACK_PASS',writeRequested,writeAcknowledged,
  state:control.enabled?'ENABLED':'DISABLED',sourceMatches:control.sourceSha===sourceSha,active:control.active.length,slots:control.slots.length,
  totalsUnchangedDuringCheck:isDeepStrictEqual(totals,after),totalWrites:0,providerCalls:0,runtimePublication:'NOT_EXECUTED'};
}
async function main(){const sourceSha=verifySource(process.env);
 const {stdout}=await execute('aws',['sts','get-caller-identity','--region','us-east-1','--output','json','--no-cli-pager'],{timeout:15000,maxBuffer:8192});
 const identity=JSON.parse(stdout);if(identity.Account!=='092954139775'||!identity.Arn?.startsWith('arn:aws:sts::092954139775:assumed-role/KnownEnoughGithubModelJobOperations/'))return fail('JOB_CONTROL_ROLE_INVALID');
 const client=new DynamoDBClient({region:'us-east-1',endpoint:'https://dynamodb.us-east-1.amazonaws.com',maxAttempts:1});
 const result=await initializeDisabledControl(client.send.bind(client),sourceSha);
 let nativeStoreRead='NOT_EXECUTED';let nativeDeliveryCount=null;
 if(result.sourceMatches){
  const store=createDynamoModelJobStore({verifiedTarget:{account:'092954139775',region:'us-east-1'},sourceSha});
  const snapshot=await store.read(randomUUID());const deliveries=await store.deliveries();
  if(snapshot.job!==null||snapshot.control.enabled!==(result.state==='ENABLED')||snapshot.control.active.length!==deliveries.length)return fail('JOB_CONTROL_NATIVE_READ_CHANGED');
  nativeStoreRead='PASS';nativeDeliveryCount=deliveries.length;
 }
 console.log(JSON.stringify({sourceSha,account:'092954139775',region:'us-east-1',...result,nativeStoreRead,nativeDeliveryCount}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await main();}catch(error){const code=error.safeCode??(['AccessDeniedException','TransactionCanceledException'].includes(error?.name)?error.name:'UNCLASSIFIED');
  console.error(JSON.stringify({result:'JOB_CONTROL_NOT_VERIFIED',code,totalWrites:0,providerCalls:0}));process.exitCode=1;}
}
